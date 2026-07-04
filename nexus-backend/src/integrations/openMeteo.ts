/**
 * Open-Meteo adapter — free, NO API KEY. Daily precipitation forecast, used by
 * the heavy-rainfall (and later flood/drought) evaluators. `parseDailyPrecip`
 * is pure + unit-tested; `fetchDailyPrecip` hits the live API.
 */
import axios from 'axios';

export interface DailyPrecip {
  date: string;
  precipMm: number;
}

export interface PrecipForecast {
  maxMm: number; // max daily precip over the window
  days: DailyPrecip[];
}

/** Parse an Open-Meteo `daily` response into a precip forecast (pure). */
export function parseDailyPrecip(json: unknown): PrecipForecast {
  const daily = (json as { daily?: { time?: string[]; precipitation_sum?: (number | null)[] } }).daily;
  const times = daily?.time ?? [];
  const sums = daily?.precipitation_sum ?? [];
  const days: DailyPrecip[] = times.map((date, i) => ({ date, precipMm: Number(sums[i] ?? 0) }));
  const maxMm = days.reduce((m, d) => Math.max(m, d.precipMm), 0);
  return { maxMm, days };
}

/** Fetch the daily precipitation forecast for a point (default: next 2 days). */
export async function fetchDailyPrecip(lat: number, lng: number, forecastDays = 2): Promise<PrecipForecast> {
  const url = 'https://api.open-meteo.com/v1/forecast';
  const res = await axios.get(url, {
    params: {
      latitude: lat,
      longitude: lng,
      daily: 'precipitation_sum',
      forecast_days: forecastDays,
      timezone: 'auto',
    },
    timeout: 15000,
  });
  return parseDailyPrecip(res.data);
}

/**
 * Fetch OBSERVED daily precipitation for a date range (free, no key — Open-Meteo's
 * historical archive, reanalysis-based). Used for drought detection: current rainfall
 * vs. a rolling multi-year "normal" (true CHIRPS climatology is a future upgrade —
 * see spec 01 §17). Dates are 'YYYY-MM-DD'.
 */
export async function fetchHistoricalDailyPrecip(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<PrecipForecast> {
  const url = 'https://archive-api.open-meteo.com/v1/archive';
  const res = await axios.get(url, {
    params: { latitude: lat, longitude: lng, start_date: startDate, end_date: endDate, daily: 'precipitation_sum', timezone: 'auto' },
    timeout: 20000,
  });
  return parseDailyPrecip(res.data);
}
