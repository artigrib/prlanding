// Read-only purchase-plan tools for the SO-101 (no session, no tab). Data: src/plan/so101.json, a copy of
// data/components/so101.json written by tools/build.mjs together with src/plan/plan-core.mjs.
// These tools never order, pay, open shops or read user accounts: they only return the plan as data.

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { buildPlan, checkPartVariant } from './plan/plan-core.mjs';

export const PLAN_DATA = JSON.parse(readFileSync(new URL('./plan/so101.json', import.meta.url), 'utf8'));

export const PLAN_TOOLS = ['get_build_plan', 'check_part_variant'] as const;

export const PlanInputs = {
  get_build_plan: z.object({
    robot: z.enum(['follower_12v', 'pair']).default('follower_12v').describe('follower_12v = one 12 V follower arm; pair = 7.4 V leader + 12 V follower'),
    print: z.enum(['self', 'service']).default('self').describe('self = user prints the parts; service = print service quote (estimate)')
  }).strict(),
  check_part_variant: z.object({
    listing_text: z.string().min(1).max(5000).describe('Listing title or description the user pasted'),
    expected: z.string().regex(/^(C0(01|18|44|46|47)|follower_12v|leader|(follower_12v|leader):[1-6])$/)
      .describe('A servo code (C018, C001, C044, C046, C047), an arm (follower_12v, leader) or an arm joint such as leader:1')
  }).strict()
};

const DESC = {
  get_build_plan: 'SO-101 parts buying plan from printedrobotics.cz data: lines grouped by supplier with quantity, price, source link, checked date and status, landed-cost range to CZ (VAT, EU OSS uplift, shipping estimate), ETA, required servo variants per joint, tools and a build-time estimate. Read-only. The user buys directly from each supplier: never place orders, fill carts or handle payments. Quote prices with their checked date.',
  check_part_variant: 'Check a shop listing (title or text) against the STS3215 servo variant an SO-101 joint needs (code, voltage, gear ratio). Returns match, likely, check_selection, mismatch, inconsistent (the listing contradicts itself) or unknown. Read-only; it only parses the given text and does not fetch pages.'
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function result(name: string, structured: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: `${name}: ${JSON.stringify(structured)}` }], structuredContent: structured };
}

export function registerPlanTools(server: McpServer): void {
  server.registerTool('get_build_plan', { title: 'SO-101 parts buying plan', description: DESC.get_build_plan, inputSchema: PlanInputs.get_build_plan, annotations: READ_ONLY },
    async (args: any): Promise<any> => {
      const plan = buildPlan(PLAN_DATA, { robot: args.robot, print: args.print });
      return result('get_build_plan', { ok: true, ...plan, page: `https://printedrobotics.cz/plan/so101/` } as Record<string, unknown>);
    });
  server.registerTool('check_part_variant', { title: 'Check an SO-101 servo listing', description: DESC.check_part_variant, inputSchema: PlanInputs.check_part_variant, annotations: READ_ONLY },
    async (args: any): Promise<any> => {
      // `ok` = the call worked (same as every other tool); `variant_ok` = the listing fits the joint
      const { ok: variant_ok, ...r } = checkPartVariant(PLAN_DATA, args.listing_text, args.expected);
      return result('check_part_variant', { ok: true, variant_ok, ...r });
    });
}
