import { z } from 'zod';
import type {
  AgentEvent,
  AgentHandlerExports,
  AgentManifest,
  AgentManifestInput,
  HandlerFunction,
  ToolDefinition,
  TriggerDef,
} from './types.js';
import { AgentManifestSchema } from './types.js';

/**
 * 에이전트 manifest 정의.
 * 사용자 폴더의 agent.config.ts 에서 `export default defineAgent({ ... })` 형태로 사용.
 */
export function defineAgent(manifest: AgentManifestInput): AgentManifest {
  return AgentManifestSchema.parse(manifest);
}

/**
 * 도구 정의. self-describing — 메타데이터 + run 함수.
 * packages/tools/ 에서 export, 또는 사용자 폴더 tools/ 안에서 본인 도구 정의 가능.
 */
export function defineTool<TInput, TOutput>(
  def: ToolDefinition<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> {
  if (!def.id) throw new Error('Tool requires an id');
  if (!def.inputs) throw new Error(`Tool ${def.id} requires inputs schema`);
  if (!def.outputs) throw new Error(`Tool ${def.id} requires outputs schema`);
  if (typeof def.run !== 'function') throw new Error(`Tool ${def.id} requires a run function`);
  return def;
}

/**
 * 트리거 선언 helper. defineAgent({ triggers: [...] }) 안에서 사용.
 */
export const trigger = {
  slackMention: (opts?: { channel?: string }): TriggerDef => ({
    type: 'slack.mention',
    ...opts,
  }),
  slackMessage: (opts?: { channel?: string }): TriggerDef => ({
    type: 'slack.message',
    ...opts,
  }),
  slackReaction: (opts: { emoji: string; channel?: string }): TriggerDef => ({
    type: 'slack.reaction_added',
    ...opts,
  }),
  cron: (schedule: string): TriggerDef => ({
    type: 'cron',
    schedule,
  }),
  http: (path: string): TriggerDef => ({
    type: 'http',
    path,
  }),
  manual: (): TriggerDef => ({
    type: 'manual',
  }),
};

/**
 * 핸들러 정의. handler.ts 에서 `export default defineHandler({ onSlackMention: ..., onCron: ... })`
 *
 * 또는 named exports로도 가능:
 *   export const onSlackMention = async (e, ctx) => { ... }
 *
 * 런타임이 둘 다 지원.
 */
export function defineHandler(exports: AgentHandlerExports): AgentHandlerExports {
  return exports;
}

/**
 * 핸들러 함수에 타입 추론을 도와주는 helper.
 * 단독 사용: `export const onSlackMention = handler<'slack.mention'>(async (e, ctx) => { ... })`
 */
export function handler<E extends AgentEvent = AgentEvent>(
  fn: HandlerFunction<E>,
): HandlerFunction<E> {
  return fn;
}

/**
 * Zod re-export (사용자 편의)
 */
export { z };
