/**
 * Scheduled hazard evaluators (node-cron; ADR-0006 — BullMQ/Redis later).
 * Disabled unless ENABLE_HAZARD_JOBS=true, so dev/test boots don't auto-write.
 * Each job is guarded against overlap and never throws out of the tick.
 */
import type { IngestDeps } from './ingestion';
import { ingestFirms, ingestRainfall, ingestDrought } from './ingestion';

// node-cron is untyped here; require with a minimal signature.
const cron = require('node-cron') as {
  schedule: (expr: string, fn: () => void | Promise<void>) => unknown;
};

/** Run `task` unless already running; log the outcome; swallow errors. */
function guarded(label: string, isBusy: () => boolean, setBusy: (v: boolean) => void, task: () => Promise<unknown>) {
  return async () => {
    if (isBusy()) return;
    setBusy(true);
    try {
      const summary = await task();
      console.log(`[jobs:${label}]`, JSON.stringify(summary));
    } catch (err) {
      console.error(`[jobs:${label}] failed:`, (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
}

export function startHazardJobs(deps: IngestDeps): void {
  if (process.env.ENABLE_HAZARD_JOBS !== 'true') {
    console.log('[jobs] hazard evaluators disabled (set ENABLE_HAZARD_JOBS=true to enable)');
    return;
  }

  let firmsBusy = false;
  let rainBusy = false;
  let droughtBusy = false;

  // FIRMS every 3h (matches its ~3h data latency); rainfall every 6h;
  // drought weekly (slow-onset, spec 01 §3.5 — no need for frequent re-evaluation).
  cron.schedule('0 */3 * * *', guarded('firms', () => firmsBusy, (v) => (firmsBusy = v), () => ingestFirms(deps)));
  cron.schedule('30 */6 * * *', guarded('rainfall', () => rainBusy, (v) => (rainBusy = v), () => ingestRainfall(deps)));
  cron.schedule('0 4 * * 1', guarded('drought', () => droughtBusy, (v) => (droughtBusy = v), () => ingestDrought(deps)));

  console.log('[jobs] hazard evaluators scheduled — FIRMS every 3h, rainfall every 6h, drought weekly (Mon 04:00)');
}
