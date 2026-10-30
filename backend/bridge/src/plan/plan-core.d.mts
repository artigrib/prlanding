// Types for the generated copy of assets/plan/plan-core.mjs (see tools/build.mjs). Hand-written: keep in sync.
export type Range = [number, number];
export interface Plan {
  robot: string; robot_id: string; print: string; options: Record<string, string>;
  config: { id: string; name: string; name_cs: string; arms: string[] };
  seller_of_record: string; affiliate_links: boolean;
  groups: Array<Record<string, any> & { supplier: string; name: string; lines: Array<Record<string, any>>; landed_eur: Range; eta_days: Range }>;
  totals: { goods_eur: Range; landed_eur: Range; landed_czk: Range; includes: string; fx_czk_per_eur: number };
  eta_days: Range; checked: { oldest: string; newest: string };
  warnings: Array<Record<string, any>>; variants: Array<Record<string, any>>;
  checks: Array<Record<string, any>>; tools_note: string | null; tools_note_cs: string | null;
  notes: Array<Record<string, any>>; safety: Array<Record<string, any>>;
  tools: Array<Record<string, any>>; build_time: Record<string, any>; arrivals: Array<Record<string, any>>;
  alternative: Record<string, any> | null; alternatives: Array<Record<string, any>>;
  kits: KitComparison | null;
}
export interface KitComparison {
  config: string; print: string; best: string | null;
  kits: Array<Record<string, any> & { id: string; landed_eur: Range; missing_eur: Range; total_eur: Range; eligible: boolean; blockers: string[]; variant: { ok: boolean; codes_named: boolean; problems: Array<Record<string, any>> } }>;
  recommendation: { choice: 'kit' | 'parts'; reason: 'kit_cheaper_or_equal' | 'parts_cheaper' | 'no_eligible_kit' | 'no_kit'; kit: string | null; parts_eur: Range; kit_total_eur?: Range; difference_eur?: number; basis: string };
}
export interface VariantCheck {
  expected: { label: string; codes: string[]; voltage_v: number | null; gear_ratios: string[]; need?: string; need_cs?: string };
  found: { codes: string[]; voltages: number[]; ratios: string[]; signals?: string[]; problems?: string[] };
  verdict: 'match' | 'likely' | 'check_selection' | 'mismatch' | 'inconsistent' | 'unknown';
  ok: boolean; mismatches: Array<Record<string, any>>; warnings: Array<Record<string, any>>; advice: string; advice_cs: string;
  known_kit?: { id: string; name: string; status: string; checked: string; configs: string[] } | null;
}
export const CONFIGS: string[];
export const PRINT: string[];
export function buildPlan(data: any, opts?: { robot?: string; config?: string; print?: string; [option: string]: string | undefined }): Plan;
export function checkPartVariant(data: any, text: string, expect: string): VariantCheck;
export function checkPartSpec(data: any, text: string, expect: string): VariantCheck;
export function partChecks(data: any): Array<Record<string, any>>;
export function parseListing(text: string): VariantCheck['found'];
export function checkData(data: any, schema?: any): string[];
export function validateSchema(schema: any, data: any): string[];
export function requiredVariants(data: any, arms: string[]): Array<Record<string, any>>;
export function buildTime(data: any, arms: number, print?: string): Record<string, any>;
export function toEur(data: any, price: number | null, currency: string): number | null;
export function compareKits(data: any, plan: Plan): KitComparison;
export function kitLanded(data: any, kit: any): { eur: Range; basis: 'eu_oss' | 'domestic' | 'ioss' | 'import_vat'; status: string };
export function kitVariantCheck(data: any, kit: any, arms: string[]): { ok: boolean; codes_named: boolean; problems: Array<Record<string, any>> };
export function kitsFromEur(data: any, configs?: string[]): number | null;
export function checkKitListing(data: any, text: string, config: string): VariantCheck;
export function parseKitListing(text: string): { ratios: Record<string, number>; codes: Record<string, number>; voltages: number[] };
export function screwTable(data: any, arms: string[]): Record<string, any>;
export const IOSS_LIMIT_EUR: number;
export const KIT_BLOCKERS: string[];
export const STATUSES: string[];
export const REVIEW_SIGNALS: string[];
