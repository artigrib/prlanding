// Read-only purchase-plan tools: get_build_plan and check_part_variant (no session, no tab).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createBridge, type Bridge } from '../src/http.ts';
import { testConfig } from './helpers.ts';
import { PLAN_DATA, PLAN_DATA_SVRN, PlanInputs } from '../src/plan-tools.ts';
import { buildPlan, checkPartVariant } from '../src/plan/plan-core.mjs';

let b: Bridge; let port: number; let client: Client;
before(async () => {
  b = createBridge(testConfig());
  port = await b.listen();
  client = new Client({ name: 'unit-plan', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
});
after(async () => { await client?.close(); await b?.close(); });

test('bridge copies of the data and the plan core match the site sources (run node tools/build.mjs)', () => {
  const src = (p: string) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
  const here = (p: string) => readFileSync(new URL('../src/plan/' + p, import.meta.url), 'utf8');
  assert.equal(here('so101.json'), src('data/components/so101.json'));
  assert.equal(here('svrn.json'), src('data/components/svrn.json'));
  assert.ok(here('plan-core.mjs').endsWith(src('assets/plan/plan-core.mjs')));
});

test('core: plan totals and variant check through the bridge copy', () => {
  assert.deepEqual(buildPlan(PLAN_DATA, { robot: 'follower_12v', print: 'self' }).totals.landed_eur, [205, 223]);
  assert.deepEqual(buildPlan(PLAN_DATA, { robot: 'pair', print: 'self' }).totals.landed_eur, [386, 412]);
  assert.equal(checkPartVariant(PLAN_DATA, 'STS3215 C001 7.4V 1/191', 'leader:2').verdict, 'inconsistent');
  assert.deepEqual(buildPlan(PLAN_DATA_SVRN, { robot: 'robot_only', module: 'flipper', print: 'self' }).totals.landed_eur, [103, 106]);
  assert.deepEqual(buildPlan(PLAN_DATA_SVRN, { robot: 'starter', module: 'flipper', print: 'self' }).totals.landed_eur, [241, 248]);
  assert.equal(checkPartVariant(PLAN_DATA_SVRN, 'Malenki Nano 1-2S', 'svrn:esc').verdict, 'mismatch');
});

test('input schemas are strict', () => {
  assert.equal(PlanInputs.get_build_plan.safeParse({ robot: 'pair', print: 'self' }).success, true);
  assert.equal(PlanInputs.get_build_plan.safeParse({ robot: 'pair', checkout: true }).success, false);
  assert.equal(PlanInputs.check_part_variant.safeParse({ listing_text: 'x', expected: 'leader:7' }).success, false);
  assert.equal(PlanInputs.check_part_variant.safeParse({ listing_text: '', expected: 'C018' }).success, false);
  assert.equal(PlanInputs.get_build_plan.safeParse({ robot: 'svrn', config: 'starter', module: 'grabber', print: 'service' }).success, true);
  assert.equal(PlanInputs.get_build_plan.safeParse({ robot: 'pair', module: 'flipper' }).success, false, 'module applies only to svrn');
  assert.equal(PlanInputs.get_build_plan.safeParse({ robot: 'svrn', module: 'spinner' }).success, false);
  for (const e of ['svrn:esc', 'svrn:motor', 'svrn:servo', 'svrn:lipo']) assert.equal(PlanInputs.check_part_variant.safeParse({ listing_text: 'x', expected: e }).success, true);
  assert.equal(PlanInputs.check_part_variant.safeParse({ listing_text: 'x', expected: 'svrn:wheel' }).success, false);
});

test('MCP: tools are listed read-only and return structured plans', async () => {
  const tools = (await client.listTools()).tools;
  for (const name of ['get_build_plan', 'check_part_variant']) {
    const t = tools.find((x) => x.name === name);
    assert.ok(t, name);
    assert.equal(t!.annotations?.readOnlyHint, true);
    assert.equal(t!.annotations?.openWorldHint, false);
  }
  const r: any = await client.callTool({ name: 'get_build_plan', arguments: { robot: 'pair', print: 'service' } });
  assert.equal(r.isError, undefined, JSON.stringify(r).slice(0, 300));
  const s = r.structuredContent;
  assert.equal(s.ok, true);
  assert.equal(s.affiliate_links, false);
  assert.match(s.seller_of_record, /not the seller/);
  assert.ok(s.groups.some((g: any) => g.supplier === 'print_service'));
  assert.equal(s.variants.length, 2);
  const d: any = await client.callTool({ name: 'get_build_plan', arguments: {} });
  assert.equal(d.structuredContent.robot, 'follower_12v');
  const v: any = await client.callTool({ name: 'check_part_variant', arguments: { listing_text: 'Feetech STS3215-C018 12V 1:345', expected: 'follower_12v:1' } });
  assert.equal(v.structuredContent.ok, true);
  assert.equal(v.structuredContent.variant_ok, true);
  assert.equal(v.structuredContent.verdict, 'match');
  const bad: any = await client.callTool({ name: 'check_part_variant', arguments: { listing_text: 'x', expected: 'gripper' } });
  assert.equal(bad.isError, true);
});

test('MCP: SVRN plan (config, module) and part checks', async () => {
  const r: any = await client.callTool({ name: 'get_build_plan', arguments: { robot: 'svrn', config: 'starter', module: 'wedge' } });
  assert.equal(r.isError, undefined, JSON.stringify(r).slice(0, 300));
  const s = r.structuredContent;
  assert.equal(s.robot, 'svrn');
  assert.equal(s.config.id, 'starter');
  assert.deepEqual(s.options, { module: 'wedge' });
  assert.equal(s.page, 'https://printedrobotics.cz/plan/svrn/');
  assert.match(s.seller_of_record, /not the seller/);
  assert.ok(s.safety.some((x: any) => x.id === 'lipo_shipping' && x.level === 'verify'));
  assert.ok(s.groups.flatMap((g: any) => g.lines).some((l: any) => l.component === 'svrn.ctrl.malenki_nano_hv'));
  assert.ok(!s.groups.flatMap((g: any) => g.lines).some((l: any) => l.component === 'svrn.servo'), 'wedge: no servo');
  const d: any = await client.callTool({ name: 'get_build_plan', arguments: { robot: 'svrn' } });
  assert.deepEqual([d.structuredContent.config.id, d.structuredContent.options.module], ['robot_only', 'flipper']);
  const v: any = await client.callTool({ name: 'check_part_variant', arguments: { listing_text: 'MG90S servo 4.8-6V', expected: 'svrn:servo' } });
  assert.equal(v.structuredContent.ok, true);
  assert.equal(v.structuredContent.variant_ok, false);
  assert.equal(v.structuredContent.verdict, 'mismatch');
  const l: any = await client.callTool({ name: 'check_part_variant', arguments: { listing_text: 'Gens ace LiPo 2S 7.4V 300mAh JST-SYP', expected: 'svrn:lipo' } });
  assert.equal(l.structuredContent.verdict, 'match');
  const bad: any = await client.callTool({ name: 'get_build_plan', arguments: { robot: 'follower_12v', module: 'flipper' } });
  assert.equal(bad.isError, true);
});
