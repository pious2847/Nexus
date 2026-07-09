/**
 * Response-asset registry service (vehicles, boats, equipment — Module M).
 * Same shape as `volunteer.service.ts` / `health-facility.service.ts`: every
 * list scoped to a geography subtree, every mutation audited.
 */
import type { Db } from '../../../shared/db';
import type { AuditRecorder } from '../../../core/audit/audit.service';
import * as repo from './asset.repository';
import type { ResponseAssetRow, UpdateAssetPatch } from './asset.repository';

export interface RegisterAssetInput {
  name: string;
  assetType: string;
  placeId: string;
  notes?: string | null;
}

export class AssetService {
  constructor(
    private readonly db: Db,
    private readonly audit?: AuditRecorder,
  ) {}

  async register(input: RegisterAssetInput, registeredBy?: string | null): Promise<ResponseAssetRow> {
    const asset = await repo.insertAsset(this.db, { ...input, registeredBy: registeredBy ?? null });
    await this.audit?.record({
      actorId: registeredBy ?? null,
      action: 'asset.registered',
      resourceType: 'response_asset',
      resourceId: asset.id,
      placeId: asset.place_id,
      metadata: { assetType: asset.asset_type },
    });
    return asset;
  }

  getAsset(id: string) {
    return repo.getAsset(this.db, id);
  }

  assetPlacePath(id: string) {
    return repo.getAssetPlacePath(this.db, id);
  }

  listByScope(scopePlaceId: string, filter: Parameters<typeof repo.listByScope>[2] = {}) {
    return repo.listByScope(this.db, scopePlaceId, filter);
  }

  async update(id: string, patch: UpdateAssetPatch, actorId?: string | null): Promise<ResponseAssetRow> {
    const before = await repo.getAsset(this.db, id);
    if (!before) throw new Error('Response asset record not found');
    const updated = await repo.updateAsset(this.db, id, patch);
    if (!updated) throw new Error('Response asset record not found');
    await this.audit?.record({
      actorId: actorId ?? null,
      action: 'asset.updated',
      resourceType: 'response_asset',
      resourceId: id,
      placeId: before.place_id,
      metadata: { changed: Object.keys(patch), patch },
    });
    return updated;
  }

  /** Assign an asset to a dispatch task: sets assigned_task + status: 'deployed'. */
  async assignToTask(id: string, taskId: string, actorId?: string | null): Promise<ResponseAssetRow> {
    const before = await repo.getAsset(this.db, id);
    if (!before) throw new Error('Response asset record not found');
    const updated = await repo.updateAsset(this.db, id, { assignedTask: taskId, status: 'deployed' });
    if (!updated) throw new Error('Response asset record not found');
    await this.audit?.record({
      actorId: actorId ?? null,
      action: 'asset.assigned',
      resourceType: 'response_asset',
      resourceId: id,
      placeId: before.place_id,
      metadata: { taskId },
    });
    return updated;
  }
}
