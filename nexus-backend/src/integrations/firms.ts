/**
 * NASA FIRMS adapter — near-real-time active fire detections (bushfire signal).
 * Free MAP_KEY from https://firms.modaps.eosdis.nasa.gov/api/. Country CSV API.
 * Without a key it logs and returns [] so the pipeline stays runnable in dev.
 */
import axios from 'axios';

export interface FirePoint {
  lat: number;
  lng: number;
  confidence: string | number; // VIIRS: 'l'|'n'|'h'; MODIS: 0-100
  frp: number | null; // fire radiative power (MW)
  brightness: number | null;
  acqDate?: string;
  satellite?: string;
  daynight?: string;
}

/** True if a detection is "high confidence" (VIIRS 'h' or MODIS ≥ 80). */
export function isHighConfidence(fp: FirePoint): boolean {
  if (typeof fp.confidence === 'number') return fp.confidence >= 80;
  return String(fp.confidence).toLowerCase() === 'h';
}

/** Parse a FIRMS country CSV response into fire points (pure, unit-tested). */
export function parseFirmsCsv(csv: string): FirePoint[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iLat = idx('latitude');
  const iLng = idx('longitude');
  const iConf = idx('confidence');
  const iFrp = idx('frp');
  const iBright = idx('bright_ti4') !== -1 ? idx('bright_ti4') : idx('brightness');
  const iDate = idx('acq_date');
  const iSat = idx('satellite');
  const iDay = idx('daynight');
  if (iLat === -1 || iLng === -1) return [];

  const points: FirePoint[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r].split(',');
    const lat = Number(cols[iLat]);
    const lng = Number(cols[iLng]);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    const confRaw = iConf !== -1 ? cols[iConf]?.trim() : '';
    const confNum = Number(confRaw);
    points.push({
      lat,
      lng,
      confidence: confRaw !== '' && !Number.isNaN(confNum) ? confNum : (confRaw || 'n'),
      frp: iFrp !== -1 && cols[iFrp] ? Number(cols[iFrp]) : null,
      brightness: iBright !== -1 && cols[iBright] ? Number(cols[iBright]) : null,
      acqDate: iDate !== -1 ? cols[iDate]?.trim() : undefined,
      satellite: iSat !== -1 ? cols[iSat]?.trim() : undefined,
      daynight: iDay !== -1 ? cols[iDay]?.trim() : undefined,
    });
  }
  return points;
}

export interface FetchOptions {
  country?: string; // ISO3, default GHA
  source?: string; // default VIIRS_SNPP_NRT
  dayRange?: number; // 1..10, default 1
}

/** Fetch active fires for Ghana from FIRMS (or [] when no MAP_KEY is set). */
export async function fetchActiveFires(opts: FetchOptions = {}): Promise<FirePoint[]> {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) {
    console.warn('[firms:dev] FIRMS_MAP_KEY not set — returning no fire detections');
    return [];
  }
  const country = opts.country ?? 'GHA';
  const source = opts.source ?? 'VIIRS_SNPP_NRT';
  const dayRange = opts.dayRange ?? 1;
  const url = `https://firms.modaps.eosdis.nasa.gov/api/country/csv/${key}/${source}/${country}/${dayRange}`;
  try {
    const res = await axios.get<string>(url, { timeout: 20000, responseType: 'text' });
    return parseFirmsCsv(typeof res.data === 'string' ? res.data : String(res.data));
  } catch (err) {
    console.error('[firms] fetch failed:', (err as Error).message);
    return [];
  }
}
