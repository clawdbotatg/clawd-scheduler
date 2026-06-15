// Central config for the SLOP.COMPUTER episode pipeline.
// Single source of truth for per-episode derivation, so the step scripts don't
// each hardcode their own copy (drift = bugs).
//
// IMPORTANT: the relay bearer token is PER-ROOM, not global, and is a SECRET —
// never hardcode or commit it. All secrets/personal config live in a gitignored
// `.env` at the repo root (see `.env.example`). Get a room's token from its invite
// link via `node copy-skill.js '<inviteUrl>'` (prints .../skill?token=<ROOM_TOKEN>);
// put it in `.env` as SLOP_TOKEN, or pass --token to slop-episode.mjs per run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleToSlug } from './slugify.js';

// Zero-dependency .env loader (repo root). Does not override already-set env vars.
try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env — fine */ }

export const TOKEN = process.env.SLOP_TOKEN || '';
export const BASE = process.env.SLOP_BASE || 'https://live.slop.computer';
export const COHOST = process.env.SLOP_COHOST || 'clawdbotatg';

// CDP ports for the two logged-in clones (see SLOP-WORKFLOW.md / memory).
export const PORTS = {
  social: Number(process.env.SLOP_PORT_SOCIAL || 9223), // Chrome: ethereum.org Google + X
  youtube: Number(process.env.SLOP_PORT_YT || 9224),    // Canary: YouTube channel
};

export const authHeaders = (extra = {}) => ({ Authorization: `Bearer ${TOKEN}`, ...extra });

// Everything derivable about an episode from just the guest's @handle.
export function episode(handle) {
  const h = String(handle).replace(/^@/, '');
  const slug = handleToSlug(h);
  return {
    handle: h,                                  // port_dev
    at: `@${h}`,                                // @port_dev
    slug,                                       // port-dev
    title: `Slop.Computer with @${h} (and co-host @${COHOST})`,
    pfp: `/tmp/${h}-pfp.jpg`,                    // get-pfp.js output
    card: `/tmp/${slug}card.png`,               // publish-card.mjs output (note: slug)
    stateUrl: `${BASE}/v1/state?slug=${slug}`,
  };
}

// Live research dossier socials-description (the YouTube/X description body).
export async function fetchSocialsDesc(slug) {
  const r = await (await fetch(`${BASE}/v1/state?slug=${slug}`, { headers: authHeaders() })).json();
  return r?.researchState?.result?.socialsDesc || '';
}
