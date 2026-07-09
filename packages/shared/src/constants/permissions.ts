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
  'safety.checkin.create': '"I\'m Safe" check-in — self or on behalf of someone else',
  'safety.checkin.read': 'View aggregated safety check-ins for a hazard event / area',
  'sos.create': 'Send an SOS / panic-button alert',
  'sos.read': 'View open SOS alerts for an area',
  'sos.manage': 'Acknowledge / resolve an SOS alert',
  'focal.create': 'Register a community focal point (last-mile relay: focal person, radio station, notice board)',
  'focal.read': 'View registered community focal points for an area',
  'focal.manage': 'Update / deactivate a community focal point',
  'shelter.create': 'Register a shelter / safe zone',
  'shelter.read': 'View shelters and their occupancy/status',
  'shelter.manage': 'Update shelter occupancy, status, or details',
  'relief.read': 'View relief stock levels and distribution history',
  'relief.manage': 'Record relief stock and distributions',
  'dispatch.create': 'Create an incident dispatch/response task',
  'dispatch.read': 'View dispatch tasks',
  'dispatch.manage': 'Assign, transition, or close a dispatch task',
  'volunteer.create': 'Register as a volunteer / register a volunteer',
  'volunteer.read': 'View the volunteer roster',
  'volunteer.manage': 'Update volunteer availability / task assignment',
  'asset.manage': 'Register / assign / update a response asset (vehicle, boat, equipment)',
  'asset.read': 'View response assets',
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
    'safety.checkin.create', 'safety.checkin.read',
    'sos.create', 'sos.read', 'sos.manage',
    'focal.create', 'focal.read', 'focal.manage',
    'shelter.read', 'shelter.manage', 'relief.read', 'relief.manage',
    'dispatch.create', 'dispatch.read', 'dispatch.manage',
    'volunteer.read', 'volunteer.manage', 'asset.manage', 'asset.read',
  ],
  regional_coordinator: [
    'hazard.event.read', 'hazard.event.create', 'hazard.event.transition',
    'alert.publish.advisory', 'alert.publish.watch', 'alert.publish.severe', 'alert.approve',
    'report.read', 'report.verify', 'response.manage',
    'data.dataset.read', 'data.request.approve',
    'vulnerable.create', 'vulnerable.read', 'vulnerable.manage',
    'health.facility.read', 'health.facility.manage', 'health.case.read',
    'safety.checkin.create', 'safety.checkin.read',
    'sos.create', 'sos.read', 'sos.manage',
    'focal.create', 'focal.read', 'focal.manage',
    'shelter.read', 'shelter.manage', 'relief.read', 'relief.manage',
    'dispatch.create', 'dispatch.read', 'dispatch.manage',
    'volunteer.read', 'volunteer.manage', 'asset.manage', 'asset.read',
  ],
  district_officer: [
    'hazard.event.read', 'hazard.event.create',
    'alert.publish.advisory', 'alert.publish.watch',
    'report.read', 'report.verify', 'response.manage', 'sanitation.manage',
    'data.dataset.read', 'vulnerable.create', 'vulnerable.read', 'vulnerable.manage',
    'health.facility.create', 'health.facility.read', 'health.facility.manage',
    'health.case.create', 'health.case.read',
    'safety.checkin.create', 'safety.checkin.read',
    'sos.create', 'sos.read', 'sos.manage',
    'focal.create', 'focal.read', 'focal.manage',
    'shelter.create', 'shelter.read', 'shelter.manage', 'relief.read', 'relief.manage',
    'dispatch.create', 'dispatch.read', 'dispatch.manage',
    'volunteer.create', 'volunteer.read', 'volunteer.manage', 'asset.manage', 'asset.read',
  ],
  // Field workers register + view (geo-scoped to their assigned place, like reports) —
  // but status/consent changes (e.g. marking someone deceased) stay with officers+.
  // Same pattern for health: they can report cases + see facilities, not manage/close facilities.
  // Same for SOS: they can see + create, but acknowledging/resolving stays with officers+.
  // Field workers are the ones actually executing tasks in the field, so unlike most other
  // modules they DO get dispatch.manage (transition a task assigned to them to in_progress/done)
  // — but not dispatch.create (that's an officer coordination decision) or shelter/relief
  // create (registry ownership stays with officers).
  field_worker: [
    'report.create', 'report.read', 'sanitation.manage', 'vulnerable.create', 'vulnerable.read',
    'health.facility.read', 'health.case.create', 'health.case.read',
    'safety.checkin.create', 'safety.checkin.read',
    'sos.create', 'sos.read', 'focal.read',
    'shelter.read', 'dispatch.read', 'dispatch.manage', 'volunteer.create', 'volunteer.read', 'asset.read',
  ],
  // Community moderators are the "focal person" N6/N1 relies on — they can check people
  // in on their behalf, see the local aggregate to know who's still unaccounted for, and
  // register other focal points (radio stations, notice boards) in their area — but
  // deactivating/editing an existing one stays with officers+.
  community_moderator: [
    'report.read', 'report.verify', 'safety.checkin.create', 'safety.checkin.read', 'sos.create', 'sos.read',
    'focal.create', 'focal.read',
    'shelter.read', 'dispatch.read', 'volunteer.create', 'volunteer.read',
  ],
  // NGO partners are a key relief-inventory stakeholder per the spec ("manage relief
  // inventory") — they get relief.manage even though most other M permissions stay read-only.
  ngo_partner: [
    'data.dataset.read', 'data.request.create', 'report.read', 'response.manage',
    'shelter.read', 'relief.read', 'relief.manage', 'dispatch.read', 'volunteer.read', 'asset.read',
  ],
  researcher: ['data.dataset.read', 'data.request.create'],
  data_consumer: ['data.dataset.read'],
  // Citizens can send an SOS but not browse others' — that's an officer/moderator view.
  // They can also register themselves as a volunteer.
  citizen: ['report.create', 'report.read', 'safety.checkin.create', 'sos.create', 'volunteer.create'],
};
