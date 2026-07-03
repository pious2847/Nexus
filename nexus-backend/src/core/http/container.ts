/**
 * Wires the core services over a shared pg Pool (the legacy app's pool, so we
 * don't open a second one). This is the composition root for the HTTP layer.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { Db } from '../../shared/db';
import { AuthService } from '../auth/auth.service';
import { RbacService } from '../rbac/rbac.service';
import { GeographyService } from '../geography/geography.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { HazardService } from '../../modules/hazards/hazards.service';
import { ReportsService } from '../../modules/reports/reports.service';

export interface CoreServices {
  db: Db;
  auth: AuthService;
  rbac: RbacService;
  geography: GeographyService;
  audit: AuditService;
  notifications: NotificationsService;
  hazards: HazardService;
  reports: ReportsService;
}

export function createCoreServices(pool: Pool): CoreServices {
  const db = drizzle(pool);
  const audit = new AuditService(db);
  const geography = new GeographyService(db);
  const hazards = new HazardService(db, audit);
  return {
    db,
    audit,
    geography,
    hazards,
    auth: new AuthService(db, process.env.JWT_SECRET ?? '', undefined, audit),
    rbac: new RbacService(db),
    notifications: new NotificationsService(db),
    reports: new ReportsService(db, geography, hazards, audit),
  };
}
