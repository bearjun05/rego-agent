import type { AgentLogger } from '@rego/runtime-sdk';

export function createLogger(prefix: string): AgentLogger {
  const ts = () => new Date().toISOString();
  return {
    debug: (msg, data) => console.debug(`${ts()} [DEBUG ${prefix}] ${msg}`, data ?? ''),
    info: (msg, data) => console.log(`${ts()} [INFO  ${prefix}] ${msg}`, data ?? ''),
    warn: (msg, data) => console.warn(`${ts()} [WARN  ${prefix}] ${msg}`, data ?? ''),
    error: (msg, data) => console.error(`${ts()} [ERROR ${prefix}] ${msg}`, data ?? ''),
  };
}
