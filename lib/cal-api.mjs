// Google Calendar API client — the cookie-free calendar path (same idea as
// lib/yt-api.mjs). The clone's Google session is dead for good (Chrome 153
// device-bound sessions), so the browser path can't save the invite.
// Secrets in the gitignored .env:
//   YT_CLIENT_ID / YT_CLIENT_SECRET  — the same OAuth Desktop client as YouTube
//   CAL_REFRESH_TOKEN                — minted by cal-oauth-setup.mjs
// Every write passes sendUpdates=none — the API's "Don't send". Never email the guest.
//
// The OAuth client is internal to concurrence.io (ethereum.org logins get 403
// org_internal), so the token belongs to austin@concurrence.io, and Austin's
// ethereum.org calendar is shared to it with "Make changes and see all event
// details" (2026-10-20). Every call targets CAL_ID, never "primary".
import './config.js'; // side-effect: loads .env

export const CAL_ID = 'austin.griffith@ethereum.org';  // the calendar the episodes live on
export const CAL_LOGIN = 'austin@concurrence.io';      // the account that approves the token

export function haveCalCreds() {
  return !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.CAL_REFRESH_TOKEN);
}

let _tok = null, _tokExp = 0;
export async function calToken() {
  if (!haveCalCreds()) throw new Error('no calendar API creds in .env (CAL_REFRESH_TOKEN) — run cal-oauth-setup.mjs');
  if (_tok && Date.now() < _tokExp - 60_000) return _tok;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YT_CLIENT_ID,
      client_secret: process.env.YT_CLIENT_SECRET,
      refresh_token: process.env.CAL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`calendar token refresh failed: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  _tok = j.access_token; _tokExp = Date.now() + (j.expires_in || 3600) * 1000;
  return _tok;
}

async function api(method, path, body, params = {}) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await calToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`calendar ${method} ${path}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

// Can this token see the episodes calendar's event details? (A shared calendar
// isn't in the token's calendarList until subscribed, so probe the events
// themselves; free/busy-only sharing returns events with no summary.)
export async function whoAmICal() {
  const j = await api('GET', `calendars/${encodeURIComponent(CAL_ID)}/events`, null, { maxResults: '20', timeMin: new Date().toISOString(), singleEvents: 'true' }).catch((e) => ({ err: e.message }));
  if (j.err) return { id: CAL_ID, role: `none (${j.err.slice(0, 120)})`, canEdit: false };
  const details = (j.items || []).some((e) => e.summary);
  return { id: CAL_ID, role: details ? `reads details (accessRole ${j.accessRole})` : `free/busy only (accessRole ${j.accessRole})`, canEdit: details && ['writer', 'owner'].includes(j.accessRole) };
}

// Events on one Denver day (YYYY/M/D) — single instances, ordered by start.
export async function eventsOnDay(day) {
  const [y, m, d] = day.split('/').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = `${y}-${pad(m)}-${pad(d)}`;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ymd2 = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
  const j = await api('GET', `calendars/${encodeURIComponent(CAL_ID)}/events`, null, {
    timeMin: `${ymd}T00:00:00+14:00`, timeMax: `${ymd2}T00:00:00-12:00`, // wide; filtered to the Denver day below
    singleEvents: 'true', orderBy: 'startTime', maxResults: '100', timeZone: 'America/Denver',
  });
  return (j.items || []).filter((e) => (e.start?.dateTime || '').startsWith(ymd));
}

export async function patchEvent(id, fields) {
  return api('PATCH', `calendars/${encodeURIComponent(CAL_ID)}/events/${encodeURIComponent(id)}`, fields, { sendUpdates: 'none' });
}

export async function getEvent(id) {
  return api('GET', `calendars/${encodeURIComponent(CAL_ID)}/events/${encodeURIComponent(id)}`);
}

// Next SLOP episode whose location is still a TODO placeholder (next 60 days).
// → { title, date: 'Oct 22, 2026', time: '9:30 AM', email, name, id } or null.
// The guest is the one attendee who isn't Austin; the booking form also puts
// their email in the description, so that's the fallback.
export async function nextEpisodeNeedingLink() {
  const j = await api('GET', `calendars/${encodeURIComponent(CAL_ID)}/events`, null, {
    timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + 60 * 864e5).toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeZone: 'America/Denver',
  });
  const ev = (j.items || []).find((e) => /slop/i.test(e.summary || '') && !/^(prepare|wrap up):/i.test(e.summary || '')
    && /TODO/i.test(e.location || '') && e.start?.dateTime);
  if (!ev) return null;
  const [y, mo, d, hh, mm] = ev.start.dateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/).slice(1).map(Number);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1];
  const time = `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  const guest = (ev.attendees || []).find((a) => !a.self && !/griffith|concurrence|buidlguidl/i.test(a.email || ''));
  const email = guest?.email || ((ev.description || '').match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0] || null;
  return { id: ev.id, title: ev.summary, date: `${MON} ${d}, ${y}`, time, email, name: guest?.displayName || null };
}
