/**
 * Multi-hazard early-warning constants (see docs/specs/01-multi-hazard-ews.md).
 * Hazard types are config-driven at runtime; this list is the initial registry
 * and the source of truth for shared typing across frontend/backend.
 */
export const HAZARD_TYPES = [
  'flood',
  'heavy_rainfall',
  'drought',
  'bushfire',
  'disease_outbreak',
  'windstorm',
  'extreme_heat',
  'sanitation_failure', // existing sanitation domain, as a hazard
] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];

/** Lifecycle states for a hazard event (spec 01 §4). */
export const HAZARD_EVENT_STATES = [
  'predicted',
  'watch',
  'warning',
  'active',
  'response',
  'recovery',
  'closed',
] as const;
export type HazardEventState = (typeof HAZARD_EVENT_STATES)[number];

/** CAP-aligned classification (spec 01 §5, ADR-0008). */
export const CAP_SEVERITIES = ['minor', 'moderate', 'severe', 'extreme'] as const;
export type CapSeverity = (typeof CAP_SEVERITIES)[number];

export const CAP_URGENCIES = ['future', 'expected', 'immediate'] as const;
export type CapUrgency = (typeof CAP_URGENCIES)[number];

export const CAP_CERTAINTIES = ['possible', 'likely', 'observed'] as const;
export type CapCertainty = (typeof CAP_CERTAINTIES)[number];

/** Derived colour band for maps + citizen UI. */
export const SEVERITY_COLORS: Record<CapSeverity, string> = {
  minor: '#2E7D32', // green
  moderate: '#F9A825', // yellow
  severe: '#EF6C00', // orange
  extreme: '#C62828', // red
};

/**
 * Pictogram/emoji per hazard type (spec 02 N5 — accessibility & no-literacy
 * alerting: a warning nobody can read or hear isn't a warning). Frontend-
 * agnostic — a plain string a PWA/print sheet/SMS can drop in directly,
 * not an icon-font/SVG reference that would tie this package to a specific
 * frontend rendering stack.
 */
export const HAZARD_ICONS: Record<HazardType, string> = {
  flood: '🌊',
  heavy_rainfall: '🌧️',
  drought: '☀️',
  bushfire: '🔥',
  disease_outbreak: '🦠',
  windstorm: '🌪️',
  extreme_heat: '🌡️',
  sanitation_failure: '🚱',
};

/** Delivery channels for alerts/notifications (Module F). */
export const NOTIFICATION_CHANNELS = [
  'in_app',
  'push',
  'sms',
  'whatsapp',
  'email',
  'voice',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
