/**
 * Official myth-vs-fact clarification service (Module N — N11 Rumor &
 * misinformation control). An officer publishes a short, authoritative
 * clarification — optionally linked to the rumor report that prompted it —
 * and, if a place is given, it fans out to the N6 community focal-point
 * network the same way AlertsService.publish() does (see
 * alerts.service.ts's `focalPoints` fan-out block), so the correction
 * reaches people with no phone/signal via radio stations / focal persons /
 * notice boards, not just the public feed.
 */
import type { Db } from '../../shared/db';
import type { GeographyService } from '../../core/geography/geography.service';
import type { FocalPointService } from '../alerts/focal/focal-point.service';
import { sendSms as defaultSendSms, type SmsResult } from '../../integrations/arkesel';
import { sendEmail as defaultSendEmail, type EmailResult } from '../../integrations/email';
import * as repo from './mythfact.repository';
import type { MythFactEntryRow } from './mythfact.repository';

type SmsSender = (to: string, message: string) => Promise<SmsResult>;
type EmailSender = (to: string, subject: string, html: string, text?: string) => Promise<EmailResult>;

export interface PublishMythFactInput {
  myth: string;
  fact: string;
  hazardEventId?: string | null;
  placeId?: string | null;
  rumorReportId?: string | null;
}

/** Short, focal-point-relayable clarification script (a simplified sibling of alerts.broadcast.ts's formatter). */
export function formatMythFactScript(input: { myth: string; fact: string }): string {
  return `NEXUS FACT-CHECK\nMYTH: ${input.myth}\nFACT: ${input.fact}\n— Official clarification from NEXUS/NADMO`;
}

export class MythFactService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    // Optional (not defaulted, unlike the senders below) — needs a
    // FocalPointService to fan out to; if omitted, publish() simply skips
    // the last-mile fan-out rather than failing (same graceful-skip pattern
    // as AlertsService's `focalPoints?` param).
    private readonly focalPoints?: FocalPointService,
    private readonly sendSms: SmsSender = defaultSendSms,
    private readonly sendEmail: EmailSender = defaultSendEmail,
  ) {}

  /**
   * Publish an official clarification. If `placeId` is given, resolves its
   * ltree path and fans out `formatMythFactScript()` to every active focal
   * point covering that scope (SMS to `contact_phone`, email to
   * `contact_email`), mirroring AlertsService.publish()'s focal-point block.
   * Records the fan-out count as `channels_notified`.
   */
  async publish(input: PublishMythFactInput, publishedBy: string): Promise<MythFactEntryRow> {
    const entry = await repo.insertMythFact(this.db, {
      myth: input.myth,
      fact: input.fact,
      hazardEventId: input.hazardEventId ?? null,
      placeId: input.placeId ?? null,
      rumorReportId: input.rumorReportId ?? null,
      publishedBy,
    });

    let focalPointsNotified = 0;
    const placePath = input.placeId ? (await this.geography.getById(input.placeId))?.path ?? null : null;
    if (placePath && this.focalPoints) {
      const points = await this.focalPoints.findActiveByScope(placePath);
      const script = formatMythFactScript({ myth: input.myth, fact: input.fact });
      for (const point of points) {
        let delivered = false;
        if (point.contact_phone) {
          const result = await this.sendSms(point.contact_phone, script);
          delivered = delivered || result.sent;
        }
        if (point.contact_email) {
          const result = await this.sendEmail(
            point.contact_email,
            `NEXUS Fact-Check — ${input.myth}`,
            `<pre style="white-space:pre-wrap;font-family:inherit">${script}</pre>`,
            script,
          );
          delivered = delivered || result.sent;
        }
        if (delivered) focalPointsNotified++;
      }
    }

    await repo.setChannelsNotified(this.db, entry.id, { focalPointsNotified });
    return (await repo.getMythFact(this.db, entry.id)) as MythFactEntryRow;
  }

  getMythFact(id: string) {
    return repo.getMythFact(this.db, id);
  }

  /** Public clarification feed. `scopePlaceId` optional — omit for the most recent entries nationwide. */
  listPublic(scopePlaceId?: string | null, limit = 50): Promise<MythFactEntryRow[]> {
    return repo.listMythFactsByScope(this.db, scopePlaceId, limit);
  }

  /**
   * ltree path of a place, for the route layer's RBAC scope check on
   * `POST /` — lets mythfact.routes.ts stay typed against `{ mythFacts, rbac }`
   * only (no separate `geography` dependency) while still letting a
   * district/regional-scoped `mythfact.publish` grant (not just a national
   * one) authorize publishing a clarification for their own area.
   */
  resolvePlacePath(placeId: string): Promise<string | null> {
    return this.geography.getById(placeId).then((p) => p?.path ?? null);
  }
}
