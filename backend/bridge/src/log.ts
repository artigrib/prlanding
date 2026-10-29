// Structured logs: event names and counts only. Never codes, session handles, IPs, args or images.

let quiet = process.env.BRIDGE_LOG === '0';
export const setQuiet = (q: boolean): void => { quiet = q; };

export function log(event: string, fields: Record<string, number | string | boolean> = {}): void {
  if (quiet) return;
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + '\n');
}
