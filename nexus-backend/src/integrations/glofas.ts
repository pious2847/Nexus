/**
 * GloFAS (Global Flood Awareness System) river discharge — served as free, no-key
 * JSON by Open-Meteo's Flood API (flood-api.open-meteo.com), which wraps GloFAS v4
 * (5km resolution) reanalysis + forecast. This is genuine GloFAS data (spec 01 §7
 * lists 'glofas' as a flood signal source) via a much simpler transport than raw
 * CDS/netCDF access (which the original research flagged as needing a Python
 * worker — this JSON wrapper avoids that entirely).
 */
import axios from 'axios';

export interface DischargeDay {
  date: string;
  dischargeM3s: number;
}
export interface DischargeSeries {
  days: DischargeDay[];
}

export function parseDailyDischarge(json: unknown): DischargeSeries {
  const daily = (json as { daily?: { time?: string[]; river_discharge?: (number | null)[] } }).daily;
  const times = daily?.time ?? [];
  const values = daily?.river_discharge ?? [];
  const days = times
    .map((date, i) => ({ date, dischargeM3s: values[i] }))
    .filter((d): d is DischargeDay => typeof d.dischargeM3s === 'number');
  return { days };
}

/** Forecast river discharge for a point (default: next 7 days). */
export async function fetchForecastDischarge(lat: number, lng: number, forecastDays = 7): Promise<DischargeSeries> {
  const res = await axios.get('https://flood-api.open-meteo.com/v1/flood', {
    params: { latitude: lat, longitude: lng, daily: 'river_discharge', forecast_days: forecastDays },
    timeout: 20000,
  });
  return parseDailyDischarge(res.data);
}

/** Observed historical river discharge for a date range (back to 1984). */
export async function fetchHistoricalDischarge(lat: number, lng: number, startDate: string, endDate: string): Promise<DischargeSeries> {
  const res = await axios.get('https://flood-api.open-meteo.com/v1/flood', {
    params: { latitude: lat, longitude: lng, daily: 'river_discharge', start_date: startDate, end_date: endDate },
    timeout: 20000,
  });
  return parseDailyDischarge(res.data);
}
