// ONE-TIME OAuth consent for the YouTube Data API (the cookie-free YouTube path).
// Prereq: YT_CLIENT_ID + YT_CLIENT_SECRET in .env (an OAuth "Desktop app" client
// from console.cloud.google.com, created under the channel-owner account).
//
//   node yt-oauth-setup.mjs
//     → prints an accounts.google.com URL. Open it in the browser profile that
//       owns the channel (austin@concurrence.io — real Canary Profile 3), click
//       Allow. The local loopback server catches the redirect, exchanges the
//       code, VERIFIES the token is bound to the slop channel, and writes
//       YT_REFRESH_TOKEN into .env.
//
// Loopback binds 127.0.0.1 only and tears itself down (never 0.0.0.0 — house rule).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './lib/config.js'; // loads .env

const ID = process.env.YT_CLIENT_ID, SECRET = process.env.YT_CLIENT_SECRET;
if (!ID || !SECRET) { console.error('✗ put YT_CLIENT_ID and YT_CLIENT_SECRET in .env first (Desktop-app OAuth client).'); process.exit(1); }

const PORT = Number(process.env.YT_OAUTH_PORT || 8917);
const REDIRECT = `http://127.0.0.1:${PORT}/cb`;
const SCOPE = 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.upload';

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE,
  access_type: 'offline', prompt: 'consent',
});

const code = await new Promise((resolve, reject) => {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (u.pathname !== '/cb') { res.writeHead(404).end(); return; }
    const c = u.searchParams.get('code'), err = u.searchParams.get('error');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(c ? '<h2>✓ slop scheduler authorized — you can close this tab.</h2>' : `<h2>✗ ${err || 'no code'}</h2>`);
    srv.close();
    c ? resolve(c) : reject(new Error(err || 'no code in redirect'));
  });
  srv.listen(PORT, '127.0.0.1', () => {
    console.log(`listening on ${REDIRECT}\n`);
    console.log('OPEN THIS in the browser signed in as the CHANNEL account (austin@concurrence.io):\n');
    console.log(authUrl + '\n');
  });
  setTimeout(() => { srv.close(); reject(new Error('timed out after 15 min')); }, 15 * 60 * 1000);
});

const r = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ code, client_id: ID, client_secret: SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
});
const tok = await r.json();
if (!tok.refresh_token) { console.error('✗ no refresh_token in response:', JSON.stringify(tok).slice(0, 300)); process.exit(1); }

// Verify BEFORE persisting: is this token bound to the slop channel?
process.env.YT_REFRESH_TOKEN = tok.refresh_token;
const { whoAmI } = await import('./lib/yt-api.mjs');
const me = await whoAmI();
console.log(`token is bound to channel: "${me.title}" (${me.id})`);
if (!me.isSlopChannel) {
  console.error('✗ WRONG ACCOUNT — that is not the slop channel. Re-run and approve as austin@concurrence.io. Token NOT saved.');
  process.exit(1);
}

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
let env = ''; try { env = fs.readFileSync(envPath, 'utf8'); } catch {}
env = env.split('\n').filter((l) => !l.startsWith('YT_REFRESH_TOKEN=')).join('\n');
if (env && !env.endsWith('\n')) env += '\n';
fs.writeFileSync(envPath, env + `YT_REFRESH_TOKEN=${tok.refresh_token}\n`);
console.log(`\n✓ YT_REFRESH_TOKEN saved to .env — YouTube is now cookie-free. Try: node schedule-youtube-api.mjs --check`);
