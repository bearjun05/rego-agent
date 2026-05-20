export * from './slack.js';
export * from './telegram.js';
export * from './llm.js';

import { allSlackTools } from './slack.js';
import { allTelegramTools } from './telegram.js';
import { allLlmTools } from './llm.js';
import type { ToolDefinition } from '@rego/runtime-sdk';

/** 런타임에서 자동 등록할 모든 공통 도구 */
export const allCommonTools: ToolDefinition[] = [
  ...(allSlackTools as ToolDefinition[]),
  ...(allTelegramTools as ToolDefinition[]),
  ...(allLlmTools as ToolDefinition[]),
];
