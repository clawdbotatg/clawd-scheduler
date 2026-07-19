// YouTube Data API v3 client for the slop pipeline — the cookie-free path.
// Auth = OAuth refresh token (one-time consent by the channel owner), so no
// Google browser session is ever needed and the clone-fork logout saga
// (2026-07) can't recur. Secrets live in the gitignored .env:
//   YT_CLIENT_ID / YT_CLIENT_SECRET  — OAuth Desktop client (console.cloud.google.com)
//   YT_REFRESH_TOKEN                 — minted by yt-oauth-setup.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import './config.js'; // side-effect: loads .env

const CHANNEL_ID = 'UC_HI2i2peo1A-STdG22GFsA'; // the slop YouTube channel (austin@concurrence.io)

export function haveCreds() {
  return !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN);
}

let _tok = null, _tokExp = 0;
export async function accessToken() {
  if (!haveCreds()) throw new Error('no YT API creds in .env (YT_CLIENT_ID/YT_CLIENT_SECRET/YT_REFRESH_TOKEN) — run yt-oauth-setup.mjs');
  if (_tok && Date.now() < _tokExp - 60_000) return _tok;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YT_CLIENT_ID,
      client_secret: process.env.YT_CLIENT_SECRET,
      refresh_token: process.env.YT_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`token refresh failed: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  _tok = j.access_token; _tokExp = Date.now() + (j.expires_in || 3600) * 1000;
  return _tok;
}

async function api(method, path, body, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = r.status === 204 ? {} : await r.json();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j.error?.errors || j).slice(0, 300)}`);
  return j;
}

/** Sanity check the token is bound to the right channel; returns {id,title}. */
export async function whoAmI() {
  const j = await api('GET', 'channels', null, { part: 'snippet', mine: 'true' });
  const c = j.items?.[0];
  if (!c) throw new Error('token has no channel');
  return { id: c.id, title: c.snippet.title, isSlopChannel: c.id === CHANNEL_ID };
}

/** Upcoming broadcasts → [{id,title,scheduledStart,privacy}] */
export async function listUpcomingBroadcasts() {
  const j = await api('GET', 'liveBroadcasts', null, { part: 'snippet,status', broadcastStatus: 'upcoming', maxResults: '50' });
  return (j.items || []).map((b) => ({
    id: b.id,
    title: b.snippet.title,
    scheduledStart: b.snippet.scheduledStartTime, // ISO UTC
    privacy: b.status.privacyStatus,
  }));
}

/** "Jul 20, 2026" + "2:00 PM" in America/Denver -> ISO UTC instant. */
export function denverToISO(date, time, tz = process.env.SLOP_TZ || 'America/Denver') {
  const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const dm = date.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s+(\d{4})$/);
  const tm = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!dm || !tm) throw new Error(`bad date/time: "${date}" "${time}"`);
  const y = +dm[3], mo = MONTHS[dm[1]], d = +dm[2];
  const hh = (+tm[1] % 12) + (/pm/i.test(tm[3]) ? 12 : 0), mm = +tm[2];
  const want = Date.UTC(y, mo - 1, d, hh, mm);
  let t = want;
  for (let i = 0; i < 3; i++) { // converge on the tz offset (handles DST)
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(t));
    const g = (k) => +p.find((x) => x.type === k).value;
    t += want - Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  }
  return new Date(t).toISOString();
}

/** Create a public scheduled broadcast; returns the broadcast id. */
export async function createBroadcast({ title, description, startISO }) {
  const j = await api('POST', 'liveBroadcasts', {
    snippet: { title: title.slice(0, 100), description: (description || '').slice(0, 4900), scheduledStartTime: startISO },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    contentDetails: { enableAutoStart: false, enableAutoStop: false },
  }, { part: 'snippet,status,contentDetails' });
  return j.id;
}

// YouTube caps thumbnails at 2 MB; the published card PNG is ~2.5 MB, so downscale
// to a JPEG first (sips is always present on macOS). Returns the temp jpeg path.
function thumbForUpload(filePath) {
  const LIMIT = 2 * 1024 * 1024;
  if (/\.jpe?g$/i.test(filePath) && fs.statSync(filePath).size < LIMIT) return { path: filePath, cleanup: false, mime: 'image/jpeg' };
  const out = filePath.replace(/\.[a-z]+$/i, '') + '.ytthumb.jpg';
  // 1280-wide JPEG (YouTube's recommended thumbnail width) — lands well under 2 MB.
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', '1280', filePath, '--out', out], { stdio: 'pipe' });
  return { path: out, cleanup: true, mime: 'image/jpeg' };
}

export async function setThumbnail(videoId, filePath) {
  const t = thumbForUpload(filePath);
  try {
    const bytes = fs.readFileSync(t.path);
    const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': t.mime, 'Content-Length': String(bytes.length) },
      body: bytes,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`thumbnails.set → ${r.status}: ${JSON.stringify(j.error?.errors || j).slice(0, 300)}`);
    return true;
  } finally {
    if (t.cleanup) { try { fs.unlinkSync(t.path); } catch {} }
  }
}
