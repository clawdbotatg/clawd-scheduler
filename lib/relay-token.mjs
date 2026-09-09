// Relay (live.slop.computer) token hygiene for the showtime automation.
//
// Why this exists (2026-09-08 @kain and 2026-09-09 @me_jango): showtime-arm
// preferred SLOP_AUTOMATION_TOKEN and fell back to SLOP_TOKEN only when the
// variable was EMPTY — never when it was DEAD. The automation token (a 7-day
// host token, renewed by hand) lapsed on 09-07, every fanout POST 401'd, the
// log printed a blank (`r.statusText` is '' on HTTP/2), the go-live legs then
// ran against a pipe carrying nothing, and Austin had to fan out + go live by
// hand mid-show. Twice.
//
// Contract: NEVER trust a token by its variable name. Probe every candidate in
// .env against GET /admin/fanouts and use the first that answers 200. Keep a
// rolling automation token alive by minting its successor (GET /v1/agent-token,
// +7 days) before it lapses — as long as the launchd job runs once a day, the
// chain never breaks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELAY = 'https://live.slop.computer';
const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = path.join(HERE, '.env');
const readEnv = () => (fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '');

// Every relay-token-looking line in .env, freshest-first: SLOP_TOKEN (the
// active episode's, rewritten by schedule-next on every scheduling run), the
// automation token, then per-slug tokens in reverse file order (later = newer).
export function candidateTokens(envFile = readEnv()) {
  const rows = [...envFile.matchAll(/^(SLOP_AUTOMATION_TOKEN(?:_STATIC)?|SLOP_TOKEN(?:_[A-Z0-9_]+)?)=\s*['"]?([0-9a-f]{64})['"]?\s*$/gm)]
    .map(([, name, token]) => ({ name, token }));
  const rank = (n) => (n === 'SLOP_TOKEN' ? 0 : n === 'SLOP_AUTOMATION_TOKEN' ? 1 : 2);
  const seen = new Set();
  return rows
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => rank(a.name) - rank(b.name) || b.i - a.i)
    .filter((r) => (seen.has(r.token) ? false : (seen.add(r.token), true)));
}

// 200 on the fanout admin route = this token can drive the fanouts. Anything
// else (401, 5xx, timeout) = unusable for showtime, whatever its name says.
export async function fanoutTokenOk(token, { timeoutMs = 8000 } = {}) {
  try {
    const r = await fetch(`${RELAY}/admin/fanouts`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs),
    });
    return r.status === 200;
  } catch { return false; }
}

// First candidate that verifies, or null. `log` gets one line per probe.
export async function pickFanoutToken({ log = () => {}, envFile } = {}) {
  const cands = candidateTokens(envFile);
  if (!cands.length) { log('relay token: no SLOP_TOKEN*/SLOP_AUTOMATION_TOKEN in .env'); return null; }
  for (const c of cands) {
    const ok = await fanoutTokenOk(c.token);
    log(`relay token ${c.name}: ${ok ? '✓ live' : '✗ dead'}`);
    if (ok) return c;
  }
  return null;
}

// Mint a successor of a live host token (+7 days). Verified against the fanout
// route before it is returned — a token we cannot use is not a renewal.
export async function mintSuccessor(token) {
  const r = await fetch(`${RELAY}/v1/agent-token`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
  });
  if (r.status !== 200) throw new Error(`agent-token → ${r.status}`);
  const j = await r.json();
  if (!/^[0-9a-f]{64}$/.test(j.token || '')) throw new Error('agent-token: no token in reply');
  if (!(await fanoutTokenOk(j.token))) throw new Error('minted token does not pass /admin/fanouts');
  return { token: j.token, expiresAt: j.expiresAt ? new Date(j.expiresAt) : null };
}

function setEnvVar(name, value) {
  let s = readEnv();
  const line = `${name}=${value}`;
  if (new RegExp(`^${name}=`, 'm').test(s)) s = s.replace(new RegExp(`^${name}=.*$`, 'm'), line);
  else s = `${s.replace(/\n*$/, '\n')}${line}\n`;
  fs.writeFileSync(ENV_PATH, s);
}

export function automationExpiry(envFile = readEnv()) {
  const m = envFile.match(/^SLOP_AUTOMATION_TOKEN_EXPIRES=(.+)$/m);
  const d = m ? new Date(m[1].trim()) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

// Keep SLOP_AUTOMATION_TOKEN alive: if it is dead, or expires within
// `renewWithinDays`, mint a successor from any live token and write it (+ its
// expiry) into .env. Returns {status, ...}; never throws (the caller is the
// showtime watcher — token upkeep must not break arming).
export async function ensureAutomationToken({ log = () => {}, renewWithinDays = 3 } = {}) {
  try {
    const env = readEnv();
    const cur = (env.match(/^SLOP_AUTOMATION_TOKEN=\s*['"]?([0-9a-f]{64})/m) || [])[1];
    const exp = automationExpiry(env);
    const curOk = cur ? await fanoutTokenOk(cur) : false;
    const soon = exp ? exp.getTime() - Date.now() < renewWithinDays * 86_400_000 : true;
    if (curOk && !soon) { log(`automation token live, expires ${exp.toISOString().slice(0, 10)} — no renewal needed`); return { status: 'fresh', expiresAt: exp }; }
    const src = curOk ? { name: 'SLOP_AUTOMATION_TOKEN', token: cur } : await pickFanoutToken({ log, envFile: env });
    if (!src) { log('🚨 automation token dead and NO live relay token in .env — only Austin\'s SIWE on live.slop.computer/admin can bootstrap one'); return { status: 'no-source' }; }
    const fresh = await mintSuccessor(src.token);
    setEnvVar('SLOP_AUTOMATION_TOKEN', fresh.token);
    if (fresh.expiresAt) setEnvVar('SLOP_AUTOMATION_TOKEN_EXPIRES', fresh.expiresAt.toISOString());
    log(`automation token renewed from ${src.name} → expires ${fresh.expiresAt ? fresh.expiresAt.toISOString().slice(0, 10) : '?'} (verified on /admin/fanouts)`);
    return { status: 'renewed', expiresAt: fresh.expiresAt, from: src.name };
  } catch (e) {
    log(`automation token upkeep failed: ${String(e.message || e).slice(0, 120)}`);
    return { status: 'error', error: String(e.message || e) };
  }
}

// Fanout control with proof. POST start|stop for both destinations, then read
// the state back and require `desired` to match. Retries (with re-probing the
// token pool) until `deadlineMs`. Returns true only when the relay CONFIRMS.
export async function fanoutControl(action, { token, log = () => {}, deadlineMs = Date.now() + 45_000, ids = ['youtube', 'twitter'] } = {}) {
  const want = action === 'start';
  let tok = token;
  for (let attempt = 1; ; attempt++) {
    if (!tok) tok = (await pickFanoutToken({ log }))?.token;
    if (tok) {
      for (const id of ids) {
        try {
          const r = await fetch(`${RELAY}/admin/fanouts/${id}/${action}`, {
            method: 'POST', headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(15000),
          });
          const body = (await r.text().catch(() => '')).slice(0, 120);
          log(`fanout ${id} ${action}: ${r.ok ? 'ok' : `HTTP ${r.status} ${body}`}`);
          if (r.status === 401 || r.status === 403) tok = null; // token died under us — re-probe next round
        } catch (e) { log(`fanout ${id} ${action}: ${String(e.message || e).slice(0, 100)}`); }
      }
    }
    const state = tok ? await fanoutState(tok).catch(() => null) : null;
    const confirmed = state && ids.every((id) => state.find((f) => f.id === id)?.desired === want);
    if (confirmed) { log(`fanouts ${action}: CONFIRMED by relay (${ids.map((id) => `${id}=${state.find((f) => f.id === id)?.running ? 'running' : 'desired'}`).join(' ')})`); return true; }
    if (Date.now() >= deadlineMs) { log(`🚨 fanouts ${action}: NOT confirmed after ${attempt} attempts`); return false; }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

export async function fanoutState(token) {
  const r = await fetch(`${RELAY}/admin/fanouts`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
  if (r.status !== 200) throw new Error(`/admin/fanouts → ${r.status}`);
  return (await r.json()).fanouts || [];
}
