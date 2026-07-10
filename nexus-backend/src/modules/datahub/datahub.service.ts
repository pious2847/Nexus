/**
 * Data Hub (Module G) — dataset catalog, three sharing modes (public/
 * by-request/private), a request-approval workflow, admin QA/curation
 * before a dataset goes public, and API-key auth for the "Public Data API"
 * spec bullet. Every mutation audited.
 *
 * Deliberately NOT built (documented, not silently skipped): automatic
 * format conversion (a dataset is served exactly as uploaded — CSV stays
 * CSV) and automatic PII scrubbing of file contents (there's no reliable
 * way to redact arbitrary uploaded files; instead `contains_pii` is a
 * declared flag with a DB constraint forbidding it on public datasets —
 * a curator decision, not an automated one).
 */
import { randomBytes, createHash } from 'crypto';
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import type { RbacService } from '../../core/rbac/rbac.service';
import * as repo from './datahub.repository';

export interface ViewerContext {
  userId: string | null;
  orgId: string | null;
  canReadCatalog: boolean; // holds data.dataset.read
  canPublish: boolean; // holds data.publish — curator/admin override
}

const PUBLIC_VIEWER: ViewerContext = { userId: null, orgId: null, canReadCatalog: false, canPublish: false };

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export class DatasetAccessDeniedError extends Error {}
export class InvalidDatasetError extends Error {}

export class DataHubService {
  constructor(
    private readonly db: Db,
    private readonly audit?: AuditRecorder,
  ) {}

  /** data.dataset.read / data.publish are checked nationally (catalog browsing/curation
   *  isn't itself geo-scoped — which datasets you can *download* is governed by
   *  sharing_mode + org/request, not RBAC place scope). Unauthenticated -> the public viewer. */
  async buildViewerContext(userId: string | null, rbac: RbacService): Promise<ViewerContext> {
    if (!userId) return PUBLIC_VIEWER;
    const [canReadCatalog, canPublish, orgId] = await Promise.all([
      rbac.can(userId, 'data.dataset.read'),
      rbac.can(userId, 'data.publish'),
      repo.getUserOrgId(this.db, userId),
    ]);
    return { userId, orgId, canReadCatalog, canPublish };
  }

  listDatasets(filter: Omit<repo.ListDatasetsFilter, 'publicOnly'>, viewer: ViewerContext = PUBLIC_VIEWER) {
    return repo.listDatasets(this.db, { ...filter, publicOnly: !viewer.canReadCatalog });
  }

  async getDataset(id: string, viewer: ViewerContext = PUBLIC_VIEWER): Promise<repo.DatasetRow | null> {
    const dataset = await repo.getDataset(this.db, id);
    if (!dataset) return null;
    if (!viewer.canReadCatalog && !(dataset.status === 'published' && dataset.sharing_mode === 'public')) return null;
    return dataset;
  }

  async create(input: repo.CreateDatasetInput, actorId: string, orgId: string | null): Promise<repo.DatasetRow> {
    if (input.sharingMode === 'public' && input.containsPii) {
      throw new InvalidDatasetError('A dataset flagged as containing PII cannot be shared publicly — use by_request or private.');
    }
    const dataset = await repo.insertDataset(this.db, { ...input, orgId: input.orgId ?? orgId }, actorId);
    await this.audit?.record({
      actorId, action: 'dataset.created', resourceType: 'dataset', resourceId: dataset.id,
      placeId: dataset.place_id, metadata: { name: dataset.name, sharingMode: dataset.sharing_mode },
    });
    return dataset;
  }

  async update(id: string, patch: repo.UpdateDatasetPatch, actorId: string): Promise<repo.DatasetRow> {
    if (patch.sharingMode !== undefined || patch.containsPii !== undefined) {
      const current = await repo.getDataset(this.db, id);
      if (!current) throw new Error('Dataset not found');
      const effectiveSharingMode = patch.sharingMode ?? current.sharing_mode;
      const effectivePii = patch.containsPii ?? current.contains_pii;
      if (effectiveSharingMode === 'public' && effectivePii) {
        throw new InvalidDatasetError('A dataset flagged as containing PII cannot be shared publicly — use by_request or private.');
      }
    }
    const updated = await repo.updateDataset(this.db, id, patch);
    if (!updated) throw new Error('Dataset not found');
    await this.audit?.record({
      actorId, action: 'dataset.updated', resourceType: 'dataset', resourceId: id,
      placeId: updated.place_id, metadata: { changed: Object.keys(patch) },
    });
    return updated;
  }

  async submitForReview(id: string, actorId: string): Promise<repo.DatasetRow> {
    const updated = await repo.submitForReview(this.db, id);
    if (!updated) throw new Error('Dataset not found or not in a reviewable state (must be draft or rejected)');
    await this.audit?.record({
      actorId, action: 'dataset.submitted_for_review', resourceType: 'dataset', resourceId: id, placeId: updated.place_id, metadata: {},
    });
    return updated;
  }

  /** QA/curation gate (spec: "admin review before a dataset goes public"). */
  async review(id: string, decision: 'published' | 'rejected', reviewerId: string): Promise<repo.DatasetRow> {
    const updated = await repo.reviewDataset(this.db, id, decision, reviewerId);
    if (!updated) throw new Error('Dataset not found or not pending review');
    await this.audit?.record({
      actorId: reviewerId, action: `dataset.${decision}`, resourceType: 'dataset', resourceId: id, placeId: updated.place_id, metadata: {},
    });
    return updated;
  }

  async archive(id: string, actorId: string): Promise<repo.DatasetRow> {
    const updated = await repo.archiveDataset(this.db, id);
    if (!updated) throw new Error('Dataset not found');
    await this.audit?.record({
      actorId, action: 'dataset.archived', resourceType: 'dataset', resourceId: id, placeId: updated.place_id, metadata: {},
    });
    return updated;
  }

  // ── Data requests ──────────────────────────────────────────────────────────
  async requestAccess(datasetId: string, requesterId: string, justification: string): Promise<repo.DataRequestRow> {
    const dataset = await repo.getDataset(this.db, datasetId);
    if (!dataset || dataset.status !== 'published') throw new Error('Dataset not found or not published');
    if (dataset.sharing_mode !== 'by_request') throw new Error('This dataset is not request-gated (it is public or private)');
    const request = await repo.insertDataRequest(this.db, datasetId, requesterId, justification);
    await this.audit?.record({
      actorId: requesterId, action: 'data_request.created', resourceType: 'data_request', resourceId: request.id,
      placeId: dataset.place_id, metadata: { datasetId },
    });
    return request;
  }

  listRequestsForDataset(datasetId: string) {
    return repo.listRequestsForDataset(this.db, datasetId);
  }

  listMyRequests(requesterId: string) {
    return repo.listMyRequests(this.db, requesterId);
  }

  async reviewRequest(id: string, decision: 'approved' | 'denied', reviewerId: string, notes?: string | null): Promise<repo.DataRequestRow> {
    const updated = await repo.reviewDataRequest(this.db, id, decision, reviewerId, notes ?? null);
    if (!updated) throw new Error('Request not found or not pending');
    await this.audit?.record({
      actorId: reviewerId, action: `data_request.${decision}`, resourceType: 'data_request', resourceId: id, placeId: null, metadata: {},
    });
    return updated;
  }

  // ── Download ───────────────────────────────────────────────────────────────
  /** Enforces the three-sharing-mode access rule, then logs the download. Throws DatasetAccessDeniedError, not a generic Error, so routes can map it to 403 specifically. */
  async download(id: string, viewer: ViewerContext, apiKeyId: string | null = null): Promise<repo.DatasetRow> {
    const dataset = await repo.getDataset(this.db, id);
    if (!dataset) throw new Error('Dataset not found');
    if (dataset.status !== 'published') throw new DatasetAccessDeniedError('Dataset is not published');

    const allowed =
      dataset.sharing_mode === 'public' ||
      viewer.canPublish ||
      (dataset.sharing_mode === 'private' && dataset.org_id !== null && dataset.org_id === viewer.orgId) ||
      (dataset.sharing_mode === 'by_request' && viewer.userId !== null && (await repo.hasApprovedRequest(this.db, id, viewer.userId)));

    if (!allowed) throw new DatasetAccessDeniedError('You do not have access to this dataset — request access first.');

    await repo.logDownload(this.db, id, viewer.userId, apiKeyId);
    return dataset;
  }

  usageStats(datasetId: string) {
    return repo.datasetUsageStats(this.db, datasetId);
  }

  // ── API keys ───────────────────────────────────────────────────────────────
  /** Returns the raw key exactly once — only key_prefix/key_hash are ever persisted. */
  async createApiKey(orgId: string, name: string, createdBy: string): Promise<{ apiKey: repo.ApiKeyRow; rawKey: string }> {
    const rawKey = `nexus_${randomBytes(24).toString('hex')}`;
    const apiKey = await repo.insertApiKey(this.db, orgId, name, hashKey(rawKey), rawKey.slice(0, 14), createdBy);
    await this.audit?.record({
      actorId: createdBy, action: 'data_api_key.created', resourceType: 'data_api_key', resourceId: apiKey.id, placeId: null, metadata: { orgId, name },
    });
    return { apiKey, rawKey };
  }

  listApiKeys(orgId: string) {
    return repo.listApiKeys(this.db, orgId);
  }

  async revokeApiKey(id: string, actorId: string): Promise<repo.ApiKeyRow> {
    const revoked = await repo.revokeApiKey(this.db, id);
    if (!revoked) throw new Error('API key not found or already revoked');
    await this.audit?.record({ actorId, action: 'data_api_key.revoked', resourceType: 'data_api_key', resourceId: id, placeId: null, metadata: {} });
    return revoked;
  }

  /** Resolves a raw `X-API-Key` header value to an org-scoped viewer context, or null if invalid/revoked. */
  async viewerFromApiKey(rawKey: string): Promise<ViewerContext | null> {
    const key = await repo.findActiveApiKeyByHash(this.db, hashKey(rawKey));
    if (!key) return null;
    // An API key grants download access equivalent to its org's membership — not the
    // full data.dataset.read/data.publish permission set, so canReadCatalog/canPublish
    // stay false (an API key is for pulling data programmatically, not curating it).
    return { userId: null, orgId: key.org_id, canReadCatalog: false, canPublish: false };
  }
}
