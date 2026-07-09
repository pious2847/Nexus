/**
 * Relief-inventory service — stock levels + distributions (Module M —
 * Emergency Response & Coordination). No geography dependency here: stock
 * is always tied to an existing place_id/shelter_id, not resolved from
 * lng/lat (that resolution, when needed, happens in the route layer using
 * the shared geography service — see relief.routes.ts).
 */
import type { Db } from '../../../shared/db';
import type { AuditRecorder } from '../../../core/audit/audit.service';
import * as repo from './relief.repository';
import type { ReliefStockRow, ReliefDistributionRow, ListStockFilter } from './relief.repository';

export interface RecordStockInput {
  placeId: string;
  shelterId?: string | null;
  itemType: string;
  quantity?: number;
  unit?: string;
  lowStockThreshold?: number;
  managedBy?: string | null;
}

export interface DistributeInput {
  quantity: number;
  recipientDesc?: string | null;
  hazardEventId?: string | null;
}

export class ReliefService {
  constructor(
    private readonly db: Db,
    private readonly audit?: AuditRecorder,
  ) {}

  /** Record a new relief-stock line. Defaults managed_by to the recording actor if not given explicitly. */
  async recordStock(input: RecordStockInput, actorId: string): Promise<ReliefStockRow> {
    const stock = await repo.insertStock(this.db, { ...input, managedBy: input.managedBy ?? actorId });
    await this.audit?.record({
      actorId,
      action: 'relief.stock_recorded',
      resourceType: 'relief_stock',
      resourceId: stock.id,
      placeId: stock.place_id,
      metadata: { itemType: stock.item_type, quantity: stock.quantity, unit: stock.unit },
    });
    return stock;
  }

  getStock(id: string) {
    return repo.getStock(this.db, id);
  }

  stockPlacePath(id: string) {
    return repo.getStockPlacePath(this.db, id);
  }

  /** List a district/region's relief-inventory. */
  listByScope(scopePlaceId: string, filter: ListStockFilter = {}): Promise<ReliefStockRow[]> {
    return repo.listByScope(this.db, scopePlaceId, filter);
  }

  async adjustStock(id: string, delta: number, actorId: string): Promise<ReliefStockRow> {
    const updated = await repo.adjustQuantity(this.db, id, delta);
    if (!updated) throw new Error('Relief stock record not found');
    await this.audit?.record({
      actorId,
      action: 'relief.stock_adjusted',
      resourceType: 'relief_stock',
      resourceId: id,
      placeId: updated.place_id,
      metadata: { delta },
    });
    return updated;
  }

  /**
   * Distribute `input.quantity` from a stock record. Rejects with a plain
   * Error ("Insufficient stock…") if it exceeds current quantity — matching
   * how other services signal business-rule violations (e.g.
   * hazards.state.ts's `assertTransition`). `insertDistribution` decrements
   * the stock in the same call.
   */
  async distribute(stockId: string, input: DistributeInput, actorId: string): Promise<ReliefDistributionRow> {
    const stock = await repo.getStock(this.db, stockId);
    if (!stock) throw new Error('Relief stock record not found');
    if (input.quantity <= 0) throw new Error('Distribution quantity must be positive');
    if (input.quantity > stock.quantity) {
      throw new Error(`Insufficient stock: requested ${input.quantity}, available ${stock.quantity}`);
    }
    const distribution = await repo.insertDistribution(this.db, {
      stockId,
      hazardEventId: input.hazardEventId ?? null,
      quantity: input.quantity,
      recipientDesc: input.recipientDesc ?? null,
      distributedBy: actorId,
    });
    await this.audit?.record({
      actorId,
      action: 'relief.distributed',
      resourceType: 'relief_distribution',
      resourceId: distribution.id,
      placeId: stock.place_id,
      metadata: { quantity: input.quantity, recipientDesc: input.recipientDesc },
    });
    return distribution;
  }

  listDistributions(stockId: string) {
    return repo.listDistributionsByStock(this.db, stockId);
  }
}
