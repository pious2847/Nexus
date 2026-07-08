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
import { AlertsService } from '../../modules/alerts/alerts.service';
import { HazardMapService } from '../../modules/hazards/hazardmap.service';
import { VulnerablePersonsService } from '../../modules/vulnerable/vulnerable.service';
import { HealthFacilityService } from '../../modules/health/facilities/health-facility.service';
import { DiseaseCaseService } from '../../modules/health/cases/disease-case.service';
import { SafetyCheckinService } from '../../modules/safety/checkin.service';
import { SosService } from '../../modules/safety/sos.service';

export interface CoreServices {
  db: Db;
  auth: AuthService;
  rbac: RbacService;
  geography: GeographyService;
  audit: AuditService;
  notifications: NotificationsService;
  hazards: HazardService;
  reports: ReportsService;
  alerts: AlertsService;
  hazardMap: HazardMapService;
  vulnerablePersons: VulnerablePersonsService;
  healthFacilities: HealthFacilityService;
  diseaseCases: DiseaseCaseService;
  safetyCheckins: SafetyCheckinService;
  sos: SosService;
}

export function createCoreServices(pool: Pool): CoreServices {
  const db = drizzle(pool);
  const audit = new AuditService(db);
  const geography = new GeographyService(db);
  const hazards = new HazardService(db, audit);
  const rbac = new RbacService(db);
  const notifications = new NotificationsService(db);
  return {
    db,
    audit,
    geography,
    hazards,
    rbac,
    notifications,
    auth: new AuthService(db, process.env.JWT_SECRET ?? '', undefined, audit),
    reports: new ReportsService(db, geography, hazards, audit),
    alerts: new AlertsService(db, rbac, notifications, audit),
    hazardMap: new HazardMapService(db),
    vulnerablePersons: new VulnerablePersonsService(db, geography, audit),
    healthFacilities: new HealthFacilityService(db, geography, audit),
    diseaseCases: new DiseaseCaseService(db, geography, audit),
    safetyCheckins: new SafetyCheckinService(db, geography, audit),
    sos: new SosService(db, geography, notifications, audit),
  };
}
