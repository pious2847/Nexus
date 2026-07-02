/**
 * Audit trail — records who did what, when (spec 03 §5). Every sensitive/critical
 * action should be recorded; this is mandatory for a system government may adopt
 * and for post-incident review. Failures to write audit must never break the main
 * action, so `record()` swallows errors after logging.
 */
import type { Db } from '../../shared/db';
import * as repo from './audit.repository';

export interface AuditEntry {
  actorId?: string | null; // null = system
  action: string; // e.g. 'auth.otp_login', 'hazard.event.transition'
  resourceType?: string;
  resourceId?: string | null;
  placeId?: string | null;
  metadata?: unknown;
  ip?: string | null;
}

/** Minimal interface so callers can depend on a recorder without the DB type. */
export interface AuditRecorder {
  record(entry: AuditEntry): Promise<void>;
}

export class AuditService implements AuditRecorder {
  constructor(private readonly db: Db) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await repo.insertAuditLog(this.db, entry);
    } catch (err) {
      // Never let audit failure break the audited action.
      console.error('[audit] failed to record', entry.action, (err as Error).message);
    }
  }

  recent(filter: { actorId?: string; action?: string; limit?: number } = {}) {
    return repo.recentAuditLogs(this.db, filter);
  }
}
