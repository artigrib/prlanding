// Validates an analytics batch from assets/track.js against the versioned schema (schema.json, a copy of
// analytics/schema.json). Unknown events and unknown/invalid properties are DROPPED, never stored.
// The output record contains no IP, no user agent, no free text: only the allow-listed fields below.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

type Rule =
  | { type: 'string'; enum?: string[]; pattern?: string }
  | { type: 'integer'; min?: number; max?: number }
  | { type: 'boolean' };

interface RawSchema {
  version: number;
  limits: { maxEventsPerBatch: number; maxBodyBytes: number };
  types: Record<string, Rule>;
  common: Record<string, string | Rule>;
  events: Record<string, { description?: string; props: Record<string, string | Rule> }>;
}

type Check = (v: unknown) => string | number | boolean | undefined;

export interface Schema {
  version: number;
  maxEvents: number;
  maxBodyBytes: number;
  events: Map<string, Map<string, Check>>;
  common: Map<string, Check>;
}

export type PropValue = string | number | boolean;

/** One accepted event, as written to every sink. */
export interface EventRecord {
  schema_version: number;
  received_at: number; // ms, server clock
  time: number; // ms, client clock clamped to +-24 h of the server clock
  event: string;
  anon_id: string; // random UUID generated in the browser after consent
  session_id: number; // ms timestamp of the session start (Amplitude convention)
  seq: number;
  insert_id: string; // stable dedupe key for retries
  path: string;
  lang: string;
  country: string; // ISO 3166-1 alpha-2 from a trusted proxy header, or ''
  device: 'mobile' | 'tablet' | 'desktop';
  props: Record<string, PropValue>;
}

export interface RequestContext {
  now: number;
  country: string;
  device: EventRecord['device'];
}

export interface BatchResult {
  ok: boolean; // false = the envelope itself is invalid (400)
  events: EventRecord[];
  dropped: number; // events dropped as unknown/invalid
}

function compile(rule: Rule): Check {
  if (rule.type === 'string') {
    const re = rule.pattern ? new RegExp(rule.pattern) : null;
    const set = rule.enum ? new Set(rule.enum) : null;
    return (v) => (typeof v === 'string' && (!set || set.has(v)) && (!re || re.test(v)) ? v : undefined);
  }
  if (rule.type === 'integer') {
    const lo = rule.min ?? Number.MIN_SAFE_INTEGER;
    const hi = rule.max ?? Number.MAX_SAFE_INTEGER;
    return (v) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
  }
  if (rule.type === 'boolean') return (v) => (typeof v === 'boolean' ? v : undefined);
  throw new Error('schema: unknown rule type');
}

export function compileSchema(raw: RawSchema): Schema {
  const ref = (r: string | Rule): Check => {
    if (typeof r === 'string') {
      const t = raw.types[r];
      if (!t) throw new Error(`schema: unknown type ${r}`);
      return compile(t);
    }
    return compile(r);
  };
  const common = new Map(Object.entries(raw.common).map(([k, r]) => [k, ref(r)] as const));
  const events = new Map<string, Map<string, Check>>();
  for (const [name, def] of Object.entries(raw.events)) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(name)) throw new Error(`schema: bad event name ${name}`);
    const props = new Map(Object.entries(def.props).map(([k, r]) => [k, ref(r)] as const));
    for (const k of props.keys()) if (common.has(k)) throw new Error(`schema: ${name}.${k} shadows a common prop`);
    events.set(name, props);
  }
  return {
    version: raw.version,
    maxEvents: raw.limits.maxEventsPerBatch,
    maxBodyBytes: raw.limits.maxBodyBytes,
    events,
    common,
  };
}

export function loadSchema(file: URL | string = new URL('../schema.json', import.meta.url)): Schema {
  return compileSchema(JSON.parse(readFileSync(file, 'utf8')) as RawSchema);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY = 86_400_000;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Body: {"v":1,"aid":"<uuid v4>","sid":<ms>,"events":[{"e":"<name>","t":<ms>,"n":<seq>,"p":{...}}]}
 */
export function validateBatch(schema: Schema, body: unknown, ctx: RequestContext): BatchResult {
  const bad: BatchResult = { ok: false, events: [], dropped: 0 };
  if (!isObj(body) || body.v !== 1) return bad;
  const aid = body.aid;
  if (typeof aid !== 'string' || !UUID.test(aid)) return bad;
  const sidRaw = body.sid;
  const sid = typeof sidRaw === 'number' && Number.isInteger(sidRaw) && sidRaw > 0 && sidRaw < ctx.now + DAY ? sidRaw : -1;
  if (sid < 0) return bad;
  if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > schema.maxEvents) return bad;

  const out: EventRecord[] = [];
  let dropped = 0;
  for (const raw of body.events) {
    const props = isObj(raw) && typeof raw.e === 'string' ? schema.events.get(raw.e) : undefined;
    if (!isObj(raw) || !props) {
      dropped++;
      continue;
    }
    const p = isObj(raw.p) ? raw.p : {};
    const clean: Record<string, PropValue> = {};
    for (const [k, check] of props) {
      if (!Object.hasOwn(p, k)) continue;
      const v = check(p[k]);
      if (v !== undefined) clean[k] = v;
    }
    const path = schema.common.get('path')!(p.path);
    const lang = schema.common.get('lang')!(p.lang);
    const t = typeof raw.t === 'number' && Number.isFinite(raw.t) && Math.abs(raw.t - ctx.now) < DAY ? Math.round(raw.t) : ctx.now;
    const seq = typeof raw.n === 'number' && Number.isInteger(raw.n) && raw.n >= 0 && raw.n < 1e7 ? raw.n : 0;
    out.push({
      schema_version: schema.version,
      received_at: ctx.now,
      time: t,
      event: raw.e as string,
      anon_id: aid,
      session_id: sid,
      seq,
      insert_id: createHash('sha256').update(`${aid}|${sid}|${seq}|${raw.e as string}|${t}`).digest('hex').slice(0, 32),
      path: typeof path === 'string' ? path : '',
      lang: typeof lang === 'string' ? lang : '',
      country: ctx.country,
      device: ctx.device,
      props: clean,
    });
  }
  return { ok: true, events: out, dropped };
}

/** Coarse device class from the User-Agent (the UA itself is never stored). */
export function deviceClass(ua: string | undefined): EventRecord['device'] {
  const s = ua ?? '';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(s)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(s)) return 'mobile';
  return 'desktop';
}

export const BOT_UA = /bot\b|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|pingdom|uptime/i;

/** Country code from a proxy header: exactly two letters, XX/T1/ZZ (unknown/Tor) dropped. */
export function countryFrom(value: string | string[] | undefined): string {
  const v = (Array.isArray(value) ? value[0] : value ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'ZZ' ? v : '';
}
