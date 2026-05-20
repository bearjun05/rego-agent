import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AgentManifestSchema, type AgentManifest, type AgentHandlerExports } from '@rego/runtime-sdk';
import { createLogger } from './logger.js';

const log = createLogger('registry');

export interface LoadedAgent {
  name: string;
  manifest: AgentManifest;
  handlers: AgentHandlerExports;
  folderPath: string;
  customTools: Record<string, unknown>;
}

interface RegistryState {
  agents: Map<string, LoadedAgent>;
  agentsRoot: string;
}

let _state: RegistryState | null = null;

export function getAgentsRoot(): string {
  // Runtime is at apps/runtime — agents are at ../../agents
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, '../../../agents');
}

export async function loadAllAgents(): Promise<Map<string, LoadedAgent>> {
  const root = getAgentsRoot();
  const agents = new Map<string, LoadedAgent>();

  if (!existsSync(root)) {
    log.warn(`agents directory not found at ${root}`);
    _state = { agents, agentsRoot: root };
    return agents;
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_')) continue; // _template skipped
    if (entry.name.startsWith('.')) continue;

    try {
      const loaded = await loadAgentFolder(path.join(root, entry.name));
      if (loaded) {
        agents.set(loaded.name, loaded);
        log.info(`loaded agent: ${loaded.name}`);
      }
    } catch (err) {
      log.error(`failed to load agent ${entry.name}`, err);
    }
  }

  _state = { agents, agentsRoot: root };
  return agents;
}

async function loadAgentFolder(folderPath: string): Promise<LoadedAgent | null> {
  const configPath = path.join(folderPath, 'agent.config.ts');
  const handlerPath = path.join(folderPath, 'handler.ts');

  if (!existsSync(configPath) || !existsSync(handlerPath)) return null;

  // 캐시버스팅: reload 시 Node ESM 모듈 캐시 때문에 바뀐 코드가 안 읽히는 문제 해결.
  // (?v= 쿼리는 fileURLToPath에서 떼어지므로 핸들러의 prompt 파일 읽기엔 영향 없음)
  const bust = `?v=${Date.now()}`;

  // 동적 import (tsx가 트랜스파일)
  const configModule = (await import(pathToFileURL(configPath).href + bust)) as {
    default: AgentManifest;
  };
  const handlerModule = (await import(pathToFileURL(handlerPath).href + bust)) as AgentHandlerExports & {
    default?: AgentHandlerExports;
  };

  const manifest = AgentManifestSchema.parse(configModule.default);
  const handlers: AgentHandlerExports = handlerModule.default ?? handlerModule;

  // 본인 폴더의 tools/ 자동 로드
  const customTools: Record<string, unknown> = {};
  const customToolsDir = path.join(folderPath, 'tools');
  if (existsSync(customToolsDir)) {
    const toolFiles = await fs.readdir(customToolsDir);
    for (const file of toolFiles) {
      if (!file.endsWith('.ts')) continue;
      try {
        const mod = (await import(pathToFileURL(path.join(customToolsDir, file)).href + bust)) as {
          default?: { id: string };
        };
        const tool = mod.default;
        if (tool && tool.id) {
          customTools[tool.id] = tool;
        }
      } catch (err) {
        log.warn(`failed to load custom tool ${file}`, err);
      }
    }
  }

  return {
    name: manifest.name,
    manifest,
    handlers,
    folderPath,
    customTools,
  };
}

export function getAgent(name: string): LoadedAgent | undefined {
  return _state?.agents.get(name);
}

export function listAgents(): LoadedAgent[] {
  if (!_state) return [];
  return Array.from(_state.agents.values());
}

export async function reloadAgent(name: string): Promise<LoadedAgent | null> {
  if (!_state) return null;
  const folderPath = path.join(_state.agentsRoot, name);
  const loaded = await loadAgentFolder(folderPath);
  if (loaded) {
    _state.agents.set(name, loaded);
    log.info(`reloaded agent: ${name}`);
  }
  return loaded;
}

export async function reloadAll(): Promise<Map<string, LoadedAgent>> {
  return loadAllAgents();
}
