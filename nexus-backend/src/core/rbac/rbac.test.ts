import { describe, it, expect } from 'vitest';
import { can, pathWithin, roleHasPermission, type Grant } from './rbac';

describe('pathWithin', () => {
  it('matches self and descendants, not siblings/ancestors', () => {
    expect(pathWithin('gh.northern', 'gh.northern')).toBe(true);
    expect(pathWithin('gh.northern.tolon', 'gh.northern')).toBe(true);
    expect(pathWithin('gh.greater_accra', 'gh.northern')).toBe(false);
    expect(pathWithin('gh', 'gh.northern')).toBe(false);
    // guard against prefix false-positives
    expect(pathWithin('gh.northern_east', 'gh.northern')).toBe(false);
  });
});

describe('roleHasPermission', () => {
  it('honours the super_admin wildcard', () => {
    expect(roleHasPermission('super_admin', 'config.manage')).toBe(true);
    expect(roleHasPermission('super_admin', 'alert.publish.extreme')).toBe(true);
  });
  it('reflects the role map', () => {
    expect(roleHasPermission('field_worker', 'report.create')).toBe(true);
    expect(roleHasPermission('field_worker', 'report.verify')).toBe(false);
    expect(roleHasPermission('district_officer', 'alert.publish.extreme')).toBe(false);
    expect(roleHasPermission('national_agency', 'alert.publish.extreme')).toBe(true);
  });
});

describe('can', () => {
  const national = (role: Grant['role']): Grant => ({ role, scopePath: null });
  const scoped = (role: Grant['role'], scopePath: string): Grant => ({ role, scopePath });

  it('super_admin (national) can do anything anywhere', () => {
    expect(can([national('super_admin')], 'alert.publish.extreme', 'gh.volta.ho')).toBe(true);
    expect(can([national('super_admin')], 'config.manage', null)).toBe(true);
  });

  it('enforces geographic scope for scoped roles', () => {
    const officer = [scoped('district_officer', 'gh.northern')];
    expect(can(officer, 'report.verify', 'gh.northern.tolon')).toBe(true);
    expect(can(officer, 'report.verify', 'gh.greater_accra.accra_metropolitan')).toBe(false);
  });

  it('denies permissions a role does not hold, even in scope', () => {
    const officer = [scoped('district_officer', 'gh.northern')];
    expect(can(officer, 'alert.publish.extreme', 'gh.northern.tolon')).toBe(false);
  });

  it('national-scoped grant applies everywhere and to place-less actions', () => {
    const agency = [national('national_agency')];
    expect(can(agency, 'alert.publish.extreme', 'gh.northern.tolon')).toBe(true);
    expect(can(agency, 'data.request.approve', null)).toBe(true);
  });

  it('place-less action is denied to a merely regional grant', () => {
    const coord = [scoped('regional_coordinator', 'gh.northern')];
    expect(can(coord, 'data.request.approve', null)).toBe(false);
  });

  it('combines multiple grants', () => {
    const grants = [scoped('district_officer', 'gh.northern'), scoped('field_worker', 'gh.volta')];
    expect(can(grants, 'sanitation.manage', 'gh.volta.ho')).toBe(true);
    expect(can(grants, 'report.verify', 'gh.northern.tolon')).toBe(true);
    expect(can(grants, 'report.verify', 'gh.volta.ho')).toBe(false); // field_worker can't verify
  });
});
