import { getDb, auditLogs } from '@rego/db';
import { getEventBus } from './event-bus.js';

export type AuditSeverity = 'info' | 'warn' | 'critical';

export interface AuditEntry {
  action: string;
  actor?: string;
  agentName?: string;
  details?: unknown;
  severity?: AuditSeverity;
}

export async function audit(entry: AuditEntry) {
  const severity = entry.severity ?? 'info';
  try {
    const db = getDb();
    await db.insert(auditLogs).values({
      action: entry.action,
      actor: entry.actor ?? 'system',
      agentName: entry.agentName ?? null,
      details: entry.details ?? null,
      severity,
    });

    await getEventBus().publish({
      type: 'audit.recorded',
      agentName: entry.agentName,
      payload: { action: entry.action, severity, details: entry.details },
    });
  } catch (err) {
    console.error('Failed to record audit', err);
  }
}
