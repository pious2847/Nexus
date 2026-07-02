/**
 * Roles for the geography-scoped RBAC model (see MASTER_PLAN §5 and
 * docs/specs/03-foundation-data-model.md §3). A user holds a role over a place
 * in the geography tree (national = root place).
 */
export const ROLES = [
  'super_admin',
  'national_agency', // NADMO / GMet / GHS / EPA / Fire Service
  'regional_coordinator',
  'district_officer',
  'field_worker',
  'community_moderator', // trusted locals who pre-verify citizen reports
  'ngo_partner',
  'researcher',
  'data_consumer',
  'citizen',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  national_agency: 'National Agency',
  regional_coordinator: 'Regional Coordinator',
  district_officer: 'District Officer',
  field_worker: 'Field Worker / Volunteer',
  community_moderator: 'Community Moderator',
  ngo_partner: 'NGO / Partner',
  researcher: 'Researcher',
  data_consumer: 'Data Consumer',
  citizen: 'Citizen',
};

export const ORGANIZATION_TYPES = [
  'government_agency',
  'ngo',
  'assembly',
  'academic',
  'private',
  'community',
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];
