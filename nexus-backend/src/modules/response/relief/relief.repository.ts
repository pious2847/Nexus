/**
 * Data access for relief inventory — stock levels + distributions (Module M
 * — Emergency Response & Coordination). Mirrors shelter.repository.ts /
 * health-facility.repository.ts's style (Drizzle `sql` tag, ltree subtree
 * scope via `listByScope`). Distribution writes decrement the stock as two
 * sequential queries inside `insertDistribution` — this codebase does not
 * wrap multi-step writes in explicit DB transactions (see
 * hazards.service.ts's `raiseEvent`, which does sequential inserts without a
 * transaction wrapper), so we follow that established convention here rather
 * than introducing BEGIN/COMMIT.
 *
 * DDL: src/db/migrations/0018_emergency_response.sql (relief_stocks,
 * relief_distributions tables).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db';

export interface ReliefStockRow {
  id: string;
  place_id: string;
  shelter_id: string | null;
  item_type: string;
  quantity: number;
  unit: string;
  low_stock_threshold: number;
  managed_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface ReliefDistributionRow {
  id: string;
  stock_id: string;
  hazard_event_id: string | null;
  quantity: number;
  recipient_desc: string | null;
  distributed_by: string | null;
  created_at: string;
}

const STOCK_COLS = sql`id, place_id, shelter_id, item_type, quantity, unit, low_stock_threshold, managed_by, updated_at, created_at`;
const DIST_COLS = sql`id, stock_id, hazard_event_id, quantity, recipient_desc, distributed_by, created_at`;

export interface InsertStockInput {
  placeId: string;
  shelterId?: string | null;
  itemType: string;
  quantity?: number;
  unit?: string;
  lowStockThreshold?: number;
  managedBy?: string | null;
}

export async function insertStock(db: Db, p: InsertStockInput): Promise<ReliefStockRow> {
  const r = await db.execute(sql`
    INSERT INTO relief_stocks (place_id, shelter_id, item_type, quantity, unit, low_stock_threshold, managed_by)
    VALUES (
      ${p.placeId}, ${p.shelterId ?? null}, ${p.itemType}, ${p.quantity ?? 0},
      ${p.unit ?? 'units'}, ${p.lowStockThreshold ?? 0}, ${p.managedBy ?? null}
    )
    RETURNING ${STOCK_COLS}
  `);
  return r.rows[0] as unknown as ReliefStockRow;
}

export async function getStock(db: Db, id: string): Promise<ReliefStockRow | null> {
  const r = await db.execute(sql`SELECT ${STOCK_COLS} FROM relief_stocks WHERE id = ${id}`);
  return (r.rows[0] as unknown as ReliefStockRow) ?? null;
}

/** ltree path of the stock's place, for RBAC scope checks. */
export async function getStockPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM relief_stocks r JOIN places p ON r.place_id = p.id WHERE r.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

export interface ListStockFilter {
  itemType?: string;
  /** Only stock at/below its low_stock_threshold. */
  lowStockOnly?: boolean;
}

/** List relief stock within a geography subtree (the scope place and everything under it). */
export async function listByScope(db: Db, scopePlaceId: string, f: ListStockFilter = {}): Promise<ReliefStockRow[]> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (f.itemType) conds.push(sql`r.item_type = ${f.itemType}`);
  if (f.lowStockOnly) conds.push(sql`r.quantity <= r.low_stock_threshold`);
  const where = sql.join(conds, sql` AND `);
  const result = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`r.id`, sql`r.place_id`, sql`r.shelter_id`, sql`r.item_type`, sql`r.quantity`,
        sql`r.unit`, sql`r.low_stock_threshold`, sql`r.managed_by`, sql`r.updated_at`, sql`r.created_at`,
      ],
      sql`, `,
    )}
    FROM relief_stocks r JOIN places p ON r.place_id = p.id
    WHERE ${where}
    ORDER BY r.updated_at DESC
  `);
  return result.rows as unknown as ReliefStockRow[];
}

/** Atomically increment/decrement quantity, clamped at a minimum of 0. */
export async function adjustQuantity(db: Db, id: string, delta: number): Promise<ReliefStockRow | null> {
  const r = await db.execute(sql`
    UPDATE relief_stocks
    SET quantity = GREATEST(0, quantity + ${delta}), updated_at = now()
    WHERE id = ${id}
    RETURNING ${STOCK_COLS}
  `);
  return (r.rows[0] as unknown as ReliefStockRow) ?? null;
}

export interface InsertDistributionInput {
  stockId: string;
  hazardEventId?: string | null;
  quantity: number;
  recipientDesc?: string | null;
  distributedBy?: string | null;
}

/**
 * Records a distribution, then decrements the stock's quantity by the same
 * amount as a second, sequential query (no explicit transaction — see file
 * header). The service layer is responsible for validating sufficient stock
 * *before* calling this.
 */
export async function insertDistribution(db: Db, p: InsertDistributionInput): Promise<ReliefDistributionRow> {
  const r = await db.execute(sql`
    INSERT INTO relief_distributions (stock_id, hazard_event_id, quantity, recipient_desc, distributed_by)
    VALUES (${p.stockId}, ${p.hazardEventId ?? null}, ${p.quantity}, ${p.recipientDesc ?? null}, ${p.distributedBy ?? null})
    RETURNING ${DIST_COLS}
  `);
  await adjustQuantity(db, p.stockId, -p.quantity);
  return r.rows[0] as unknown as ReliefDistributionRow;
}

export async function listDistributionsByStock(db: Db, stockId: string): Promise<ReliefDistributionRow[]> {
  const r = await db.execute(sql`
    SELECT ${DIST_COLS} FROM relief_distributions WHERE stock_id = ${stockId} ORDER BY created_at DESC
  `);
  return r.rows as unknown as ReliefDistributionRow[];
}
