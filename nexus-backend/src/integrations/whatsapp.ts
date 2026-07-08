/**
 * WhatsApp adapter (Meta Cloud API). Isolated so flows are testable without a
 * live phone-number-id, matching the Arkesel/email adapters' pattern. Shares
 * credentials with the legacy sanitation WhatsApp bot (src/services/whatsappService.js)
 * — WHATSAPP_PHONE_NUMBER_ID is the canonical env var name (matches the legacy
 * code), not WHATSAPP_PHONE_ID.
 */
import axios from 'axios';

export interface WhatsappResult {
  sent: boolean;
  provider: string;
  detail?: string;
}

export async function sendWhatsapp(to: string, message: string): Promise<WhatsappResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.warn(`[whatsapp:dev] (no WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID) would send to ${to}: ${message}`);
    return { sent: false, provider: 'none', detail: 'WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID not set' };
  }

  try {
    const res = await axios.post(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 },
    );
    return { sent: true, provider: 'whatsapp', detail: JSON.stringify(res.data) };
  } catch (err) {
    return { sent: false, provider: 'whatsapp', detail: (err as Error).message };
  }
}
