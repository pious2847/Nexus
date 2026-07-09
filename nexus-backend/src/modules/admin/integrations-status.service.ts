/**
 * Integration configuration status (Module L). Read-only diagnostics — NEVER
 * exposes secret values, only whether each integration's required env vars
 * are present, plus non-secret metadata (sender IDs, key IDs). Actual
 * settings live in .env (see .env.example), not the database — storing API
 * keys in a DB table editable over HTTP would be a real security regression
 * for no operational benefit over the existing env-var-based deployment model.
 */
export interface IntegrationStatus {
  name: string;
  configured: boolean;
  detail?: string;
}

export function getIntegrationsStatus(): IntegrationStatus[] {
  const has = (...names: string[]) => names.every((n) => !!process.env[n]);
  return [
    { name: 'arkesel_sms', configured: has('ARKESEL_API_KEY'), detail: process.env.ARKESEL_SENDER_ID },
    { name: 'gemini_ai', configured: has('GEMINI_API_KEY') },
    { name: 'gmail_email', configured: has('GMAIL_USER', 'GMAIL_APP_PASSWORD'), detail: process.env.GMAIL_USER },
    { name: 'whatsapp', configured: has('WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID') },
    { name: 'firms_bushfire', configured: has('FIRMS_MAP_KEY') },
    { name: 'copernicus_glofas', configured: has('COPERNICUS_API_KEY') },
    { name: 'google_maps', configured: has('GOOGLE_MAPS_API_KEY') },
    { name: 'alert_signing', configured: has('ALERT_SIGNING_KEY_ID', 'ALERT_SIGNING_PRIVATE_KEY', 'ALERT_SIGNING_PUBLIC_KEY'), detail: process.env.ALERT_SIGNING_KEY_ID },
    { name: 'sms_inbound_webhook_guard', configured: has('SMS_INBOUND_TOKEN') },
    { name: 'cloudinary', configured: has('CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET') },
    { name: 'africastalking_sms_legacy', configured: has('AT_API_KEY') },
  ];
}
