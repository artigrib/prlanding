#!/usr/bin/env node
// Mint a forge invite token LOCALLY (never on the server, never in CI):
//   node backend/api/scripts/forge-token.mjs <label>
// Prints the token (give it to the invitee over a private channel) and the "label:sha256" entry to add to
// the GitHub environment secret FORGE_INVITE_TOKENS (environment "production"; entries separated by commas).
// Only the hash goes to the server. Revoke an invitee by removing their entry and re-running the deploy.
import { createHash, randomBytes } from 'node:crypto';

const label = (process.argv[2] || '').toLowerCase();
if (!/^[a-z0-9_-]{1,32}$/.test(label)) {
  console.error('usage: node backend/api/scripts/forge-token.mjs <label>   (label: a-z 0-9 _ -, max 32)');
  process.exit(2);
}
const token = 'pr_forge_' + randomBytes(24).toString('base64url');
const hash = createHash('sha256').update(token, 'utf8').digest('hex');
console.log(`token (for the invitee only):           ${token}`);
console.log(`FORGE_INVITE_TOKENS entry (server):     ${label}:${hash}`);
