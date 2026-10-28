// Prompt-injection hygiene: whatever the tab sends is untrusted. Only numbers, booleans, null and
// short identifier-like strings (enums, ids) survive; all prose the model sees is generated here.

import { ERROR_CODES, type ErrorCode } from './schemas.ts';

const KEY_RE = /^[a-z][a-z0-9_]{0,47}$/;
const STR_RE = /^[A-Za-z0-9_.:+-]{0,32}$/;
const MAX_DEPTH = 6;
const MAX_ARRAY = 200;
const MAX_KEYS = 64;
export const MAX_STRUCTURED_BYTES = 32 * 1024;

export interface SanitizeReport { dropped: number }

export function sanitizeValue(v: unknown, depth = 0, rep: SanitizeReport = { dropped: 0 }): unknown {
  if (v === null) return null;
  switch (typeof v) {
    case 'number': return Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : (rep.dropped++, null);
    case 'boolean': return v;
    case 'string': return STR_RE.test(v) ? v : (rep.dropped++, null);
    case 'object': {
      if (depth >= MAX_DEPTH) { rep.dropped++; return null; }
      if (Array.isArray(v)) {
        if (v.length > MAX_ARRAY) rep.dropped++;
        return v.slice(0, MAX_ARRAY).map((x) => sanitizeValue(x, depth + 1, rep));
      }
      const out: Record<string, unknown> = {};
      let n = 0;
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (!KEY_RE.test(k) || ++n > MAX_KEYS) { rep.dropped++; continue; }
        out[k] = sanitizeValue(x, depth + 1, rep);
      }
      return out;
    }
    default:
      rep.dropped++;
      return null;
  }
}

export function sanitizeStructured(v: unknown): { value: Record<string, unknown>; dropped: number } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const rep = { dropped: 0 };
  const value = sanitizeValue(v, 0, rep) as Record<string, unknown>;
  if (JSON.stringify(value).length > MAX_STRUCTURED_BYTES) return null;
  return { value, dropped: rep.dropped };
}

export function sanitizeErrorCode(code: unknown): ErrorCode {
  return typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code) ? (code as ErrorCode) : 'TAB_ERROR';
}

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
export const MAX_IMAGE_BYTES = 768 * 1024;

/** Validate an image coming from the tab: JPEG/PNG only, real magic bytes, size-capped. */
export function sanitizeImage(img: unknown): { mimeType: 'image/jpeg' | 'image/png'; data: string; bytes: number } | null {
  if (!img || typeof img !== 'object') return null;
  const { mimeType, data } = img as { mimeType?: unknown; data?: unknown };
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') return null;
  if (typeof data !== 'string' || data.length < 16 || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || data.length % 4 !== 0 || !B64_RE.test(data)) return null;
  const head = Buffer.from(data.slice(0, 16), 'base64');
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if ((mimeType === 'image/jpeg' && !isJpeg) || (mimeType === 'image/png' && !isPng)) return null;
  const bytes = Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  return { mimeType, data, bytes };
}

/** Client name shown in the tab's Allow dialog: short, safe charset. */
export function sanitizeClientName(name: unknown): string {
  if (typeof name !== 'string') return 'MCP client';
  const s = name.replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 32);
  return s || 'MCP client';
}
