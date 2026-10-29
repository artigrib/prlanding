// Types for the generated copy of assets/plan/plan-core.mjs (see tools/build.mjs). Hand-written: keep in sync.
export type Range = [number, number];
export interface Plan {
  robot: string; print: string;
  config: { id: string; name: string; name_cs: string; arms: string[] };
  seller_of_record: string; affiliate_links: boolean;
  groups: Array<Record<string, any> & { supplier: string; name: string; lines: Array<Record<string, any>>; landed_eur: Range; eta_days: Range }>;
  totals: { goods_eur: Range; landed_eur: Range; landed_czk: Range; includes: string; fx_czk_per_eur: number };
  eta_days: Range; checked: { oldest: string; newest: string };
  warnings: Array<Record<string, any>>; variants: Array<Record<string, any>>;
  tools: Array<Record<string, any>>; build_time: Record<string, any>; arrivals: Array<Record<string, any>>;
  alternative: Record<string, any> | null;
}
export interface VariantCheck {
  expected: { label: string; codes: string[]; voltage_v: number; gear_ratios: string[] };
  found: { codes: string[]; voltages: number[]; ratios: string[] };
  verdict: 'match' | 'likely' | 'check_selection' | 'mismatch' | 'inconsistent' | 'unknown';
  ok: boolean; mismatches: Array<Record<string, any>>; warnings: Array<Record<string, any>>; advice: string; advice_cs: string;
}
export const CONFIGS: string[];
export const PRINT: string[];
export function buildPlan(data: any, opts?: { robot?: string; print?: string }): Plan;
export function checkPartVariant(data: any, text: string, expect: string): VariantCheck;
export function parseListing(text: string): VariantCheck['found'];
export function checkData(data: any, schema?: any): string[];
export function validateSchema(schema: any, data: any): string[];
export function requiredVariants(data: any, arms: string[]): Array<Record<string, any>>;
export function buildTime(data: any, arms: number, print?: string): Record<string, any>;
export function toEur(data: any, price: number | null, currency: string): number | null;
export const STATUSES: string[];
