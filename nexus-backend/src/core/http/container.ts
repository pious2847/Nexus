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
import { FocalPointService } from '../../modules/alerts/focal/focal-point.service';
import { ShelterService } from '../../modules/response/shelters/shelter.service';
import { ReliefService } from '../../modules/response/relief/relief.service';
import { DispatchService } from '../../modules/response/dispatch/dispatch.service';
import { VolunteerService } from '../../modules/response/volunteers/volunteer.service';
import { AssetService } from '../../modules/response/volunteers/asset.service';
import { ResponseTimelineService } from '../../modules/response/timeline.service';
import { SystemHealthService } from '../../modules/admin/system-health.service';
import { AnalyticsService } from '../../modules/analytics/analytics.service';
import { MissingPersonsService } from '../../modules/missing/missing.service';
import { RumorService } from '../../modules/rumors/rumor.service';
import { MythFactService } from '../../modules/rumors/mythfact.service';
import { AnticipatoryService } from '../../modules/anticipatory/anticipatory.service';
import { BadgeService } from '../../modules/reports/badges.service';
import { OrganizationsService } from '../../modules/admin/organizations/organizations.service';
import { CommandService } from '../../modules/command/command.service';
import { EvacuationService } from '../../modules/evacuation/evacuation.service';
import { AssessmentService } from '../../modules/assessments/assessment.service';
import { AdminUsersService } from '../../modules/admin/users/admin-users.service';

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
  focalPoints: FocalPointService;
  shelters: ShelterService;
  relief: ReliefService;
  dispatch: DispatchService;
  volunteers: VolunteerService;
  assets: AssetService;
  responseTimeline: ResponseTimelineService;
  systemHealth: SystemHealthService;
  analytics: AnalyticsService;
  missingPersons: MissingPersonsService;
  rumors: RumorService;
  mythFacts: MythFactService;
  anticipatory: AnticipatoryService;
  badges: BadgeService;
  assessments: AssessmentService;
  adminUsers: AdminUsersService;
  organizations: OrganizationsService;
  command: CommandService;
  evacuation: EvacuationService;
}

export function createCoreServices(pool: Pool): CoreServices {
  const db = drizzle(pool);
  const audit = new AuditService(db);
  const geography = new GeographyService(db);
  const rbac = new RbacService(db);
  const notifications = new NotificationsService(db);
  const focalPoints = new FocalPointService(db, geography, audit);
  const dispatch = new DispatchService(db, audit);
  const vulnerablePersons = new VulnerablePersonsService(db, geography, audit);
  // anticipatory must exist before hazards (hazards.transition() calls into it), which
  // in turn means its own deps (focalPoints, vulnerablePersons) must be constructed first.
  const anticipatory = new AnticipatoryService(db, geography, audit, focalPoints, vulnerablePersons);
  const hazards = new HazardService(db, audit, anticipatory);
  const badges = new BadgeService(db, audit);
  return {
    db,
    audit,
    geography,
    hazards,
    rbac,
    notifications,
    focalPoints,
    dispatch,
    vulnerablePersons,
    anticipatory,
    badges,
    auth: new AuthService(db, process.env.JWT_SECRET ?? '', undefined, audit),
    reports: new ReportsService(db, geography, hazards, audit, badges),
    alerts: new AlertsService(db, rbac, notifications, audit, undefined, undefined, undefined, focalPoints),
    hazardMap: new HazardMapService(db),
    healthFacilities: new HealthFacilityService(db, geography, audit),
    diseaseCases: new DiseaseCaseService(db, geography, audit),
    safetyCheckins: new SafetyCheckinService(db, geography, audit),
    sos: new SosService(db, geography, notifications, audit, undefined, dispatch),
    shelters: new ShelterService(db, geography, audit),
    relief: new ReliefService(db, audit),
    volunteers: new VolunteerService(db, geography, audit),
    assets: new AssetService(db, audit),
    responseTimeline: new ResponseTimelineService(db),
    systemHealth: new SystemHealthService(db),
    analytics: new AnalyticsService(db),
    missingPersons: new MissingPersonsService(db, geography, audit),
    rumors: new RumorService(db, geography, audit),
    mythFacts: new MythFactService(db, geography, focalPoints, undefined, undefined),
    assessments: new AssessmentService(db, geography, audit),
    adminUsers: new AdminUsersService(db, audit),
    organizations: new OrganizationsService(db, audit),
    command: new CommandService(db, audit),
    evacuation: new EvacuationService(db),
  };
}
