/**
 * Data access for alerts + the subscriber lookup used for fan-out.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface AlertRow {
  id: string;
  hazard_event_id: string | null;
  place_id: string | null;
  category: string;
  event_type: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string;
  description: string | null;
  instruction: string | null;
  area_desc: string | null;
  status: string;
  recipients: number;
  sms_attempted: number;
  sms_delivered: number;
  whatsapp_attempted: number;
  whatsapp_delivered: number;
  email_attempted: number;
  email_delivered: number;
  focal_points_notified: number;
  signature: string | null;
  signing_key_id: string | null;
  signed_at: string | null;
  published_at: string | null;
  created_at: string;
}

const COLS = sql`id, hazard_event_id, place_id, category, event_type, severity, urgency, certainty,
  headline, description, instruction, area_desc, status, recipients, sms_attempted, sms_delivered,
  whatsapp_attempted, whatsapp_delivered, email_attempted, email_delivered, focal_points_notified,
  signature, signing_key_id, signed_at, published_at, created_at`;

/** Event + hazard-type + place details needed to draft an alert. */
export interface EventForAlert {
  hazard_type: string;
  category: string;
  label: string;
  place_id: string | null;
  place_name: string | null;
  place_path: string | null;
  severity: string | null;
  urgency: string | null;
  certainty: string | null;
  title: string;
}

export async function getEventForAlert(db: Db, eventId: string): Promise<EventForAlert | null> {
  const r = await db.execute(sql`
    SELECT e.hazard_type, ht.category, ht.label, e.place_id,
           p.name AS place_name, p.path::text AS place_path,
           e.severity, e.urgency, e.certainty, e.title
    FROM hazard_events e
    JOIN hazard_types ht ON e.hazard_type = ht.code
    LEFT JOIN places p ON e.place_id = p.id
    WHERE e.id = ${eventId}
  `);
  return (r.rows[0] as unknown as EventForAlert) ?? null;
}

export async function placePathById(db: Db, placeId: string): Promise<string | null> {
  const r = await db.execute(sql`SELECT path::text AS path FROM places WHERE id = ${placeId}`);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

export interface InsertAlertInput {
  hazardEventId?: string | null;
  placeId?: string | null;
  category: string;
  eventType: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string;
  description?: string | null;
  instruction?: string | null;
  areaDesc?: string | null;
  createdBy?: string | null;
}

export async function insertAlert(db: Db, a: InsertAlertInput): Promise<AlertRow> {
  const r = await db.execute(sql`
    INSERT INTO warnings (hazard_event_id, place_id, category, event_type, severity, urgency, certainty,
      headline, description, instruction, area_desc, created_by)
    VALUES (${a.hazardEventId ?? null}, ${a.placeId ?? null}, ${a.category}, ${a.eventType}, ${a.severity},
      ${a.urgency}, ${a.certainty}, ${a.headline}, ${a.description ?? null}, ${a.instruction ?? null},
      ${a.areaDesc ?? null}, ${a.createdBy ?? null})
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as AlertRow;
}

export async function getAlert(db: Db, id: string): Promise<AlertRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM warnings WHERE id = ${id}`);
  return (r.rows[0] as unknown as AlertRow) ?? null;
}

/**
 * `warnings.event_type` is a human-readable label (e.g. "Flood Warning", set
 * from `hazard_types.label` at draft time — see `draftFromEvent`), NOT the
 * machine hazard_type code. Callers that need the code (e.g. to look up a
 * pure per-hazard-type constant like an icon) must join back through
 * `hazard_event_id` instead of trusting `event_type`.
 */
export async function getAlertHazardTypeCode(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT e.hazard_type FROM warnings w JOIN hazard_events e ON e.id = w.hazard_event_id WHERE w.id = ${id}
  `);
  return (r.rows[0] as { hazard_type: string } | undefined)?.hazard_type ?? null;
}

export async function listAlerts(db: Db, f: { status?: string; limit?: number }): Promise<AlertRow[]> {
  const conds = [sql`TRUE`];
  if (f.status) conds.push(sql`status = ${f.status}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`SELECT ${COLS} FROM warnings WHERE ${where} ORDER BY created_at DESC LIMIT ${f.limit ?? 50}`);
  return r.rows as unknown as AlertRow[];
}

export async function setPublished(
  db: Db,
  id: string,
  userId: string,
  counts: {
    recipients: number;
    smsAttempted: number;
    smsDelivered: number;
    whatsappAttempted: number;
    whatsappDelivered: number;
    emailAttempted: number;
    emailDelivered: number;
    focalPointsNotified: number;
  },
): Promise<void> {
  await db.execute(sql`
    UPDATE warnings SET status = 'published', published_by = ${userId}, published_at = now(),
      recipients = ${counts.recipients}, sms_attempted = ${counts.smsAttempted}, sms_delivered = ${counts.smsDelivered},
      whatsapp_attempted = ${counts.whatsappAttempted}, whatsapp_delivered = ${counts.whatsappDelivered},
      email_attempted = ${counts.emailAttempted}, email_delivered = ${counts.emailDelivered},
      focal_points_notified = ${counts.focalPointsNotified},
      updated_at = now()
    WHERE id = ${id}
  `);
}

/** Records the Ed25519 signature computed over the alert's CAP payload at publish time. */
export async function setSignature(db: Db, id: string, signature: string, keyId: string): Promise<void> {
  await db.execute(sql`
    UPDATE warnings SET signature = ${signature}, signing_key_id = ${keyId}, signed_at = now(), updated_at = now()
    WHERE id = ${id}
  `);
}

/** Users to notify for an alert area: subscribers whose place shares lineage with the area. */
export async function findSubscribers(db: Db, placePath: string): Promise<string[]> {
  const r = await db.execute(sql`
    SELECT DISTINCT s.user_id FROM subscriptions s JOIN places p ON s.place_id = p.id
    WHERE p.path <@ ${placePath}::ltree OR ${placePath}::ltree <@ p.path
  `);
  return (r.rows as unknown as { user_id: string }[]).map((x) => x.user_id);
}

/**
 * Subscribers who opted into SMS for the affected area and have a phone number.
 * Preference absence = enabled (opt-out model): only an explicit sms=false row excludes them.
 */
export async function findSmsSubscribers(db: Db, placePath: string): Promise<{ userId: string; phone: string }[]> {
  const r = await db.execute(sql`
    SELECT DISTINCT u.id AS user_id, u.phone
    FROM subscriptions s
    JOIN places p ON s.place_id = p.id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN notification_preferences np ON np.user_id = s.user_id AND np.channel = 'sms'
    WHERE (p.path <@ ${placePath}::ltree OR ${placePath}::ltree <@ p.path)
      AND 'sms' = ANY(s.channels)
      AND u.phone IS NOT NULL
      AND (np.enabled IS DISTINCT FROM false)
  `);
  return (r.rows as unknown as { user_id: string; phone: string }[]).map((x) => ({ userId: x.user_id, phone: x.phone }));
}

/** Same shape/opt-out semantics as findSmsSubscribers, for the 'whatsapp' channel. */
export async function findWhatsappSubscribers(db: Db, placePath: string): Promise<{ userId: string; phone: string }[]> {
  const r = await db.execute(sql`
    SELECT DISTINCT u.id AS user_id, u.phone
    FROM subscriptions s
    JOIN places p ON s.place_id = p.id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN notification_preferences np ON np.user_id = s.user_id AND np.channel = 'whatsapp'
    WHERE (p.path <@ ${placePath}::ltree OR ${placePath}::ltree <@ p.path)
      AND 'whatsapp' = ANY(s.channels)
      AND u.phone IS NOT NULL
      AND (np.enabled IS DISTINCT FROM false)
  `);
  return (r.rows as unknown as { user_id: string; phone: string }[]).map((x) => ({ userId: x.user_id, phone: x.phone }));
}

/** Same shape/opt-out semantics as findSmsSubscribers, for the 'email' channel. */
export async function findEmailSubscribers(db: Db, placePath: string): Promise<{ userId: string; email: string }[]> {
  const r = await db.execute(sql`
    SELECT DISTINCT u.id AS user_id, u.email
    FROM subscriptions s
    JOIN places p ON s.place_id = p.id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN notification_preferences np ON np.user_id = s.user_id AND np.channel = 'email'
    WHERE (p.path <@ ${placePath}::ltree OR ${placePath}::ltree <@ p.path)
      AND 'email' = ANY(s.channels)
      AND u.email IS NOT NULL
      AND (np.enabled IS DISTINCT FROM false)
  `);
  return (r.rows as unknown as { user_id: string; email: string }[]).map((x) => ({ userId: x.user_id, email: x.email }));
}
