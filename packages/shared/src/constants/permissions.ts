/**
 * RBAC permission catalog and the role → permission mapping (spec 03 §3).
 * This is the single source of truth used by both the backend (enforcement +
 * DB seed) and the frontend (conditional UI). `'*'` = all permissions.
 */
import type { Role } from './roles';

export const PERMISSIONS = {
  'hazard.event.read': 'View hazard events',
  'hazard.event.create': 'Create / raise hazard events',
  'hazard.event.transition': 'Change a hazard event state',
  'alert.publish.advisory': 'Publish advisory alerts',
  'alert.publish.watch': 'Publish watch alerts',
  'alert.publish.severe': 'Publish severe warnings',
  'alert.publish.extreme': 'Publish extreme / emergency warnings',
  'alert.approve': 'Approve queued warnings before mass send',
  'report.create': 'Submit incident reports',
  'report.read': 'View incident reports',
  'report.verify': 'Verify / triage citizen reports',
  'data.dataset.read': 'Browse / download datasets',
  'data.request.create': 'Request gated datasets',
  'data.request.approve': 'Approve dataset access requests',
  'data.publish': 'Publish / curate datasets',
  'sanitation.manage': 'Manage sanitation assets & jobs',
  'response.manage': 'Coordinate emergency response',
  'vulnerable.create': 'Register a vulnerable person (evacuation-assistance registry)',
  'vulnerable.read': 'View the vulnerable-persons registry',
  'vulnerable.manage': 'Update status/consent of a vulnerable-person record',
  'health.facility.create': 'Register a health facility',
  'health.facility.read': 'View the health facility registry',
  'health.facility.manage': 'Update / close a health facility record',
  'health.case.create': 'Report a disease case (facility / field-worker sourced)',
  'health.case.read': 'View disease case reports and surveillance data',
  'user.manage': 'Manage user accounts',
  'role.assign': 'Assign roles to users',
  'org.manage': 'Manage organizations',
  'config.manage': 'Manage platform configuration',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<Role, readonly (Permission | '*')[]> = {
  super_admin: ['*'],
  national_agency: [
    'hazard.event.read', 'hazard.event.create', 'hazard.event.transition',
    'alert.publish.advisory', 'alert.publish.watch', 'alert.publish.severe',
    'alert.publish.extreme', 'alert.approve',
    'report.read', 'report.verify',
    'data.dataset.read', 'data.request.approve', 'data.publish',
    'response.manage', 'vulnerable.create', 'vulnerable.read', 'vulnerable.manage',
    'health.facility.read', 'health.facility.manage', 'health.case.read',
  ],
  regional_coordinator: [
    'hazard.event.read', 'hazard.event.create', 'hazard.event.transition',
    'alert.publish.advisory', 'alert.publish.watch', 'alert.publish.severe', 'alert.approve',
    'report.read', 'report.verify', 'response.manage',
    'data.dataset.read', 'data.request.approve',
    'vulnerable.create', 'vulnerable.read', 'vulnerable.manage',
    'health.facility.read', 'health.facility.manage', 'health.case.read',
  ],
  district_officer: [
    'hazard.event.read', 'hazard.event.create',
    'alert.publish.advisory', 'alert.publish.watch',
    'report.read', 'report.verify', 'response.manage', 'sanitation.manage',
    'data.dataset.read', 'vulnerable.create', 'vulnerable.read', 'vulnerable.manage',
    'health.facility.create', 'health.facility.read', 'health.facility.manage',
    'health.case.create', 'health.case.read',
  ],
  // Field workers register + view (geo-scoped to their assigned place, like reports) —
  // but status/consent changes (e.g. marking someone deceased) stay with officers+.
  // Same pattern for health: they can report cases + see facilities, not manage/close facilities.
  field_worker: [
    'report.create', 'report.read', 'sanitation.manage', 'vulnerable.create', 'vulnerable.read',
    'health.facility.read', 'health.case.create', 'health.case.read',
  ],
  community_moderator: ['report.read', 'report.verify'],
  ngo_partner: ['data.dataset.read', 'data.request.create', 'report.read', 'response.manage'],
  researcher: ['data.dataset.read', 'data.request.create'],
  data_consumer: ['data.dataset.read'],
  citizen: ['report.create', 'report.read'],
};
