// Pairing codes and session handles.
//
// Pairing code: 8 characters from the RFC 8628 §6.1 base-20 alphabet (no vowels, no look-alikes),
// ≈34.6 bits. Shown to the user as XXXX-XXXX; input is normalised (case, dashes, spaces).
// Session handle: "s_" + 128 random bits, base64url.

import { randomBytes, randomInt, timingSafeEqual, createHash } from 'node:crypto';

export const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LEN = 8;

export function newCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** Normalise user input to the canonical 8-char form, or null if it cannot be a code. */
export function normalizeCode(input: string): string | null {
  if (typeof input !== 'string' || input.length > 32) return null;
  const s = input.toUpperCase().replace(/[\s\-_.]/g, '');
  if (s.length !== CODE_LEN) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export const formatCode = (c: string): string => c.slice(0, 4) + '-' + c.slice(4);

/** Number of positions at which two equal-length codes differ. */
export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export const SESSION_RE = /^s_[A-Za-z0-9_-]{22}$/;
export const newSessionHandle = (): string => 's_' + randomBytes(16).toString('base64url');
export const newId = (prefix: string): string => prefix + randomBytes(9).toString('base64url');

/** Constant-time string compare (for secrets used as lookup keys we index by hash, see below). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Maps are keyed by a hash of the secret so a Map lookup does not leak timing about the secret itself. */
export const keyOf = (secret: string): string => createHash('sha256').update(secret).digest('base64url');
