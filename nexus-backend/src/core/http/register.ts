/**
 * Mounts the new TypeScript core routers onto the existing Express app
 * (the CJS→TS runtime bridge — the app runs under tsx). Additive: legacy routes
 * are untouched. Called synchronously from server.js before the 404 handler.
 */
import type { Express } from 'express';
import { createCoreServices } from './container';
import { buildAuthRouter } from '../auth/auth.routes';
import { buildGeographyRouter } from '../geography/geography.routes';
import { buildHazardsRouter } from '../../modules/hazards/hazards.routes';
import { buildReportsRouter } from '../../modules/reports/reports.routes';
import { buildAlertsRouter } from '../../modules/alerts/alerts.routes';
import { buildNotificationsRouter } from '../notifications/notifications.routes';
import { buildHazardMapRouter } from '../../modules/hazards/hazardmap.routes';
import { buildVulnerablePersonsRouter } from '../../modules/vulnerable/vulnerable.routes';
import { startHazardJobs } from '../../modules/hazards/hazards.jobs';

export function registerCoreRoutes(app: Express): void {
  // Reuse the legacy app's pg Pool so we don't open a second connection pool.
  const { getPool } = require('../../config/database') as { getPool: () => import('pg').Pool };
  const services = createCoreServices(getPool());

  app.use('/api/v1/auth-v2', buildAuthRouter(services));
  app.use('/api/v1/geography', buildGeographyRouter(services));
  app.use('/api/v1/hazards', buildHazardsRouter(services));
  // Mounted at /incident-reports to avoid the legacy /reports (community reports) route.
  app.use('/api/v1/incident-reports', buildReportsRouter(services));
  // Mounted at /warnings to avoid the legacy /alerts (sensor/flood alerts) route.
  app.use('/api/v1/warnings', buildAlertsRouter(services));
  app.use('/api/v1/notifications', buildNotificationsRouter(services));
  // Mounted at /hazard-map to avoid the legacy /map (sanitation asset layers) route.
  app.use('/api/v1/hazard-map', buildHazardMapRouter(services.hazardMap));
  app.use('/api/v1/vulnerable-persons', buildVulnerablePersonsRouter(services));

  console.log('[core] mounted auth-v2, geography, hazards, incident-reports, warnings, notifications, hazard-map, vulnerable-persons (TypeScript)');

  // Scheduled hazard evaluators (opt-in via ENABLE_HAZARD_JOBS).
  startHazardJobs({ db: services.db, hazards: services.hazards, geography: services.geography });
}
