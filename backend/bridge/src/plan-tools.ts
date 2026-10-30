// Read-only purchase-plan tools for the SO-101 and Project SVRN (no session, no tab). Data: src/plan/so101.json and
// src/plan/svrn.json, copies of data/components/*.json written by tools/build.mjs together with src/plan/plan-core.mjs.
// These tools never order, pay, open shops or read user accounts: they only return the plan as data.

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { buildPlan, checkPartVariant } from './plan/plan-core.mjs';

const load = (f: string) => JSON.parse(readFileSync(new URL('./plan/' + f, import.meta.url), 'utf8'));
export const PLAN_DATA = load('so101.json');
export const PLAN_DATA_SVRN = load('svrn.json');

export const PLAN_TOOLS = ['get_build_plan', 'check_part_variant'] as const;

export const PlanInputs = {
  get_build_plan: z.object({
    robot: z.enum(['pair_74v', 'pair', 'follower_74v', 'follower_12v', 'svrn']).default('pair_74v').describe('SO-101: pair_74v = 7.4 V leader + 7.4 V follower (standard, default), pair = 7.4 V leader + 12 V follower, follower_74v / follower_12v = one follower arm only (no leader: after calibration it can only replay recorded motion). svrn = Project SVRN 150 g combat robot'),
    print: z.enum(['self', 'service']).default('self').describe('self = user prints the parts; service = print service quote (estimate)'),
    config: z.enum(['robot_only', 'starter']).optional().describe('svrn only: robot_only (default) or starter = robot + FlySky transmitter + LiPo charger'),
    module: z.enum(['flipper', 'wedge', 'grabber']).optional().describe('svrn only: front module (default flipper); flipper and grabber add a servo')
  }).strict().refine((a) => a.robot === 'svrn' || (a.config === undefined && a.module === undefined), { message: 'config and module apply only to robot "svrn"' }),
  check_part_variant: z.object({
    listing_text: z.string().min(1).max(5000).describe('Listing title or description the user pasted'),
    expected: z.string().regex(/^(C0(01|18|44|46|47)|follower_74v|follower_12v|leader|(follower_74v|follower_12v|leader):[1-6]|svrn:(esc|motor|servo|lipo))$/)
      .describe('SO-101: a servo code (C018, C001, C044, C046, C047), an arm (follower_74v, follower_12v, leader) or an arm joint such as leader:1. SVRN: svrn:esc (Malenki HV), svrn:motor (N10), svrn:servo (8.4 V / 2S), svrn:lipo (2S JST-SYP)')
  }).strict()
};

const DESC = {
  get_build_plan: 'Parts buying plan from printedrobotics.cz data for the SO-101 arm or the Project SVRN combat robot (robot "svrn", with config and module): lines grouped by supplier with quantity, price, source link, checked date, status and buyer-review signals, landed-cost range to CZ (VAT, EU OSS uplift, shipping estimate), ETA, required servo variants (SO-101) or part checks (SVRN), screws per arm (SO-101, from the official assembly steps; whether they come with the servos is unverified), ready-made kit alternatives with a landed estimate and what is still needed, notes to verify, safety (SVRN: LiPo handling, charging, storage, shipping; not a toy, adult supervision), tools and a build-time estimate. Read-only. The user buys directly from each supplier: never place orders, fill carts or handle payments. Quote prices with their checked date and relay the safety items for SVRN.',
  check_part_variant: 'Check a shop listing (title or text) against what a part needs. SO-101: the STS3215 servo variant of a joint (code, voltage, gear ratio). SVRN: svrn:esc (Malenki HV for 4x N10), svrn:motor (N10, one rpm), svrn:servo (rated for 8.4 V, the Malenki has no BEC), svrn:lipo (2S, JST-SYP). Returns match, likely, check_selection, mismatch, inconsistent (the listing contradicts itself) or unknown. Read-only; it only parses the given text and does not fetch pages.'
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function result(name: string, structured: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: `${name}: ${JSON.stringify(structured)}` }], structuredContent: structured };
}

export function registerPlanTools(server: McpServer): void {
  server.registerTool('get_build_plan', { title: 'Parts buying plan (SO-101, Project SVRN)', description: DESC.get_build_plan, inputSchema: PlanInputs.get_build_plan, annotations: READ_ONLY },
    async (args: any): Promise<any> => {
      if (args.robot === 'svrn') {
        const plan = buildPlan(PLAN_DATA_SVRN, { robot: args.config || 'robot_only', module: args.module || 'flipper', print: args.print });
        return result('get_build_plan', { ok: true, ...plan, robot: 'svrn', page: `https://printedrobotics.cz/plan/svrn/` } as Record<string, unknown>);
      }
      const plan = buildPlan(PLAN_DATA, { robot: args.robot, print: args.print });
      return result('get_build_plan', { ok: true, ...plan, page: `https://printedrobotics.cz/plan/so101/` } as Record<string, unknown>);
    });
  server.registerTool('check_part_variant', { title: 'Check a part listing (SO-101 servo, SVRN parts)', description: DESC.check_part_variant, inputSchema: PlanInputs.check_part_variant, annotations: READ_ONLY },
    async (args: any): Promise<any> => {
      // `ok` = the call worked (same as every other tool); `variant_ok` = the listing fits the joint / part
      const data = String(args.expected).startsWith('svrn:') ? PLAN_DATA_SVRN : PLAN_DATA;
      const { ok: variant_ok, ...r } = checkPartVariant(data, args.listing_text, args.expected);
      return result('check_part_variant', { ok: true, variant_ok, ...r });
    });
}
