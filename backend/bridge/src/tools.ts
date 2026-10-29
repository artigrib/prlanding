// MCP tool surface. One McpServer per request (stateless serving); all state lives in the Registry
// and is reached through the explicit `session` handle argument.

import { AsyncLocalStorage } from 'node:async_hooks';
import { CLIENT_INFO_META_KEY, McpServer } from '@modelcontextprotocol/server';
import { BridgeError, type Registry, type TabResult } from './rooms.ts';
import {
  ANNOTATIONS, checkLimits, DESCRIPTIONS, ERROR_TEXT, GRIPPER_LIMITS_PCT, Inputs, JOINT_LIMITS_DEG, MISSIONS, ROBOT,
  TAB_TOOLS, UNITS, type ToolName
} from './schemas.ts';
import { registerPlanTools } from './plan-tools.ts';

/** Request-scoped data the HTTP layer knows but the SDK context does not (client IP). */
export const requestScope = new AsyncLocalStorage<{ ip: string }>();

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
interface ToolResult { content: Content[]; structuredContent?: Record<string, unknown>; isError?: boolean; [k: string]: unknown }

const INSTRUCTIONS = [
  'Controls the printedrobotics.cz SO-101 robot-arm simulation running in the user\'s browser tab.',
  'Start with connect(code) using the 8-character code the user reads from the simulation panel; the user must click Allow in the tab.',
  'Pass the returned session to every other tool. Units are in field names: degrees (_deg), percent (_pct), millimetres (_mm), seconds (_s).',
  'Prefer get_state/get_scene (numbers) over snapshot (image). Motions wait until finished. For a sequence (a dance, a wave, a shape) use run_trajectory: one call, one smooth motion. The page enforces all limits; STOP in the page can only be released by the user.',
  'The person may be a child or a class watching a projector. Reply in their language (Czech by default), short and plain.',
  'Before each motion say in one short sentence what you will do and why; after a failure say what went wrong.',
  'Be honest: you see the scene only through snapshot and the numbers from get_state/get_scene, not the person or their screen.',
  'You are an AI program controlling a simulated arm, not the robot, and you have no feelings about the task.',
  'Often offer to let the person do the next step themselves instead of doing everything for them.'
].join(' ');

export function errorResult(e: unknown): ToolResult {
  const be = e instanceof BridgeError ? e : new BridgeError('INTERNAL');
  const t = ERROR_TEXT[be.code];
  const error: Record<string, unknown> = { code: be.code, message: t.message, retryable: t.retryable };
  if (t.hint) error.hint = t.hint;
  if (be.details && Object.keys(be.details).length) error.details = be.details;
  const text = `${be.code}: ${t.message}${t.hint ? ' ' + t.hint : ''}${error.details ? ' details=' + JSON.stringify(error.details) : ''}`;
  return { isError: true, content: [{ type: 'text', text }], structuredContent: { ok: false, error } };
}

function okResult(tool: string, r: TabResult): ToolResult {
  const structured: Record<string, unknown> = { ok: true, ...r.structured };
  if (r.dropped) {
    const meta = (structured.meta && typeof structured.meta === 'object' ? structured.meta : {}) as Record<string, unknown>;
    structured.meta = { ...meta, sanitized_fields: r.dropped };
  }
  const content: Content[] = [];
  if (r.image) content.push({ type: 'image', data: r.image.data, mimeType: r.image.mimeType });
  content.push({ type: 'text', text: `${tool}: ${JSON.stringify(structured)}` });
  return { content, structuredContent: structured };
}

/** Replace mission data from the tab with the server's fixed catalogue (no tab-authored prose reaches the model). */
function decorateMissions(tool: string, args: Record<string, unknown>, r: TabResult): TabResult {
  const s = r.structured;
  if (tool === 'list_missions' && Array.isArray(s.missions)) {
    s.missions = s.missions
      .filter((m: any) => m && typeof m.id === 'string' && m.id in MISSIONS)
      .map((m: any) => ({ ...m, ...MISSIONS[m.id] }));
  }
  if (tool === 'start_mission' && typeof args.mission_id === 'string' && args.mission_id in MISSIONS) {
    s.goal = MISSIONS[args.mission_id];
  }
  return r;
}

function clientName(ctx: any, server: McpServer): string {
  const meta = ctx?.mcpReq?._meta;
  const fromMeta = meta && typeof meta === 'object' ? (meta as any)[CLIENT_INFO_META_KEY] : undefined;
  const info = fromMeta ?? server.server.getClientVersion?.();
  if (info && typeof info.name === 'string') return info.name;
  // 2025-era stateless requests carry no clientInfo: fall back to the User-Agent product token
  const ua = ctx?.http?.req?.headers?.get?.('user-agent');
  const m = typeof ua === 'string' ? /^[A-Za-z][A-Za-z0-9._-]{0,31}/.exec(ua) : null;
  return m && !/^(node|undici|Mozilla)$/i.test(m[0]) ? m[0] : 'MCP client';
}

export function buildServer(reg: Registry, version: string): McpServer {
  const server = new McpServer({ name: 'printedrobotics-so101', version }, { instructions: INSTRUCTIONS });

  server.registerTool('connect', {
    title: 'Connect to the SO-101 simulation',
    description: DESCRIPTIONS.connect,
    inputSchema: Inputs.connect,
    annotations: ANNOTATIONS.connect
  }, async (args: any, ctx: any): Promise<any> => {
    try {
      const ip = requestScope.getStore()?.ip ?? 'unknown';
      const { session, room } = await reg.connect(args.code, ip, clientName(ctx, server), ctx?.mcpReq?.signal);
      const structured = {
        ok: true, session, robot: ROBOT, mode: 'sim',
        idle_timeout_s: Math.round(reg.cfg.sessionIdleMs / 1000),
        limits: { joints_deg: JOINT_LIMITS_DEG, gripper_pct: GRIPPER_LIMITS_PCT },
        units: UNITS,
        views: room.caps.views,
        missions: room.caps.missions
      };
      return {
        content: [{ type: 'text', text: `Connected to the SO-101 simulation. Pass session "${session}" to every other tool. ${JSON.stringify({ ...structured, session: undefined })}` }],
        structuredContent: structured
      };
    } catch (e) {
      return errorResult(e);
    }
  });

  for (const tool of TAB_TOOLS) {
    server.registerTool(tool, {
      description: DESCRIPTIONS[tool],
      inputSchema: Inputs[tool] as any,
      annotations: ANNOTATIONS[tool]
    }, async (args: any, ctx: any): Promise<any> => {
      try {
        reg.resolveSession(args.session);
        precheck(tool, args);
        const r = await reg.call(args.session, tool, args, ctx?.mcpReq?.signal);
        return okResult(tool, decorateMissions(tool, args, r));
      } catch (e) {
        return errorResult(e);
      }
    });
  }
  registerPlanTools(server);   // read-only purchase-plan tools (no session needed)
  return server;
}

function precheck(tool: Exclude<ToolName, 'connect'>, args: Record<string, any>): void {
  if (tool === 'move_joints') {
    const n = args.joints_deg ? Object.keys(args.joints_deg).length : 0;
    if (!n && typeof args.gripper_pct !== 'number') throw new BridgeError('INVALID_ARGUMENT', { reason: 'nothing_to_move', expected: 'joints_deg_or_gripper_pct' });
  }
  const v = checkLimits(tool, args);
  if (v) throw new BridgeError('OUT_OF_LIMITS', v as unknown as Record<string, unknown>);
}
