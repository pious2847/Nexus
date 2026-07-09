/**
 * Organization & team management (Module A foundation gap). Every mutation
 * audited, no-op if `audit` is omitted (same pattern as every other service
 * this session).
 */
import type { Db } from '../../../shared/db';
import type { AuditRecorder } from '../../../core/audit/audit.service';
import * as repo from './organizations.repository';

export class OrganizationsService {
  constructor(
    private readonly db: Db,
    private readonly audit?: AuditRecorder,
  ) {}

  listOrgs(filter: repo.ListOrgsFilter = {}) {
    return repo.listOrgs(this.db, filter);
  }

  getOrg(id: string) {
    return repo.getOrg(this.db, id);
  }

  listMembers(orgId: string) {
    return repo.listMembers(this.db, orgId);
  }

  async create(input: repo.InsertOrgInput, actorId: string): Promise<repo.OrgRow> {
    const org = await repo.insertOrg(this.db, input);
    await this.audit?.record({
      actorId,
      action: 'org.created',
      resourceType: 'organization',
      resourceId: org.id,
      placeId: null,
      metadata: { name: org.name, type: org.type },
    });
    return org;
  }

  async update(id: string, patch: repo.UpdateOrgPatch, actorId: string): Promise<repo.OrgRow> {
    const updated = await repo.updateOrg(this.db, id, patch);
    if (!updated) throw new Error('Organization not found');
    await this.audit?.record({
      actorId,
      action: 'org.updated',
      resourceType: 'organization',
      resourceId: id,
      placeId: null,
      metadata: { changed: Object.keys(patch) },
    });
    return updated;
  }

  async setVerified(id: string, verified: boolean, actorId: string): Promise<repo.OrgRow> {
    const updated = await repo.setVerified(this.db, id, verified);
    if (!updated) throw new Error('Organization not found');
    await this.audit?.record({
      actorId,
      action: verified ? 'org.verified' : 'org.unverified',
      resourceType: 'organization',
      resourceId: id,
      placeId: null,
      metadata: {},
    });
    return updated;
  }
}
