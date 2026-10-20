// ONE-TIME OAuth consent for the Google Calendar API (the cookie-free calendar
// path). Reuses the YouTube OAuth client (YT_CLIENT_ID/YT_CLIENT_SECRET in .env).
//
//   node cal-oauth-setup.mjs
//     → prints an accounts.google.com URL. Open it signed in as CAL_LOGIN
//       (austin@concurrence.io — the client is org-internal there; ethereum.org
//       gets 403 org_internal), click Allow. The loopback server catches the
//       redirect, exchanges the code, VERIFIES the token can edit CAL_ID (the
//       ethereum.org calendar, shared to CAL_LOGIN), and writes CAL_REFRESH_TOKEN.
//
// Loopback binds 127.0.0.1 only and tears itself down (never 0.0.0.0 — house rule).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './lib/config.js'; // loads .env
import { CAL_ID, CAL_LOGIN } from './lib/cal-api.mjs';

const ID = process.env.YT_CLIENT_ID, SECRET = process.env.YT_CLIENT_SECRET;
if (!ID || !SECRET) { console.error('✗ put YT_CLIENT_ID and YT_CLIENT_SECRET in .env first (Desktop-app OAuth client).'); process.exit(1); }

const PORT = Number(process.env.CAL_OAUTH_PORT || 8918);
const REDIRECT = `http://127.0.0.1:${PORT}/cb`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE,
  access_type: 'offline', prompt: 'consent', login_hint: CAL_LOGIN,
});

const code = await new Promise((resolve, reject) => {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (u.pathname !== '/cb') { res.writeHead(404).end(); return; }
    const c = u.searchParams.get('code'), err = u.searchParams.get('error');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(c ? '<h2>✓ slop scheduler can edit the calendar — you can close this tab.</h2>' : `<h2>✗ ${err || 'no code'}</h2>`);
    srv.close();
    c ? resolve(c) : reject(new Error(err || 'no code in redirect'));
  });
  srv.listen(PORT, '127.0.0.1', () => {
    console.log(`listening on ${REDIRECT}\n`);
    console.log(`OPEN THIS signed in as ${CAL_LOGIN}:\n`);
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

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
let env = ''; try { env = fs.readFileSync(envPath, 'utf8'); } catch {}
env = env.split('\n').filter((l) => !l.startsWith('CAL_REFRESH_TOKEN=')).join('\n');
if (env && !env.endsWith('\n')) env += '\n';
fs.writeFileSync(envPath, env + `CAL_REFRESH_TOKEN=${tok.refresh_token}\n`);
console.log('✓ CAL_REFRESH_TOKEN saved to .env');

// Probe AFTER saving: a 403 here is fixable without re-consenting
// (enable the Calendar API on the project, or fix the share), then re-check with
// node -e "import('./lib/cal-api.mjs').then(async m=>console.log(await m.whoAmICal()))"
process.env.CAL_REFRESH_TOKEN = tok.refresh_token;
const { whoAmICal } = await import('./lib/cal-api.mjs');
const me = await whoAmICal();
console.log(`token's access to ${me.id}: ${me.role}`);
if (!me.canEdit) { console.error(`✗ cannot edit ${CAL_ID} yet — enable the Calendar API on the OAuth project and share ${CAL_ID} to ${CAL_LOGIN} with "Make changes", then re-check (no new consent needed).`); process.exit(1); }
console.log('✓ calendar is now cookie-free.');
