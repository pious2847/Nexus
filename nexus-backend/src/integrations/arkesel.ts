/**
 * Arkesel SMS adapter (Ghana). Isolated so the provider can be swapped and so
 * flows are testable without a live key. In dev/no-key mode it logs instead of
 * failing, which keeps OTP flows runnable locally.
 */
import axios from 'axios';

export interface SmsResult {
  sent: boolean;
  provider: string;
  detail?: string;
}

export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const apiKey = process.env.ARKESEL_API_KEY;
  const sender = process.env.ARKESEL_SENDER_ID || 'NEXUS';

  if (!apiKey) {
    console.warn(`[sms:dev] (no ARKESEL_API_KEY) would send to ${to}: ${message}`);
    return { sent: false, provider: 'none', detail: 'ARKESEL_API_KEY not set' };
  }

  try {
    const res = await axios.get('https://sms.arkesel.com/sms/api', {
      params: { action: 'send-sms', api_key: apiKey, to, from: sender, sms: message },
      timeout: 10000,
    });
    return { sent: true, provider: 'arkesel', detail: JSON.stringify(res.data) };
  } catch (err) {
    return { sent: false, provider: 'arkesel', detail: (err as Error).message };
  }
}
