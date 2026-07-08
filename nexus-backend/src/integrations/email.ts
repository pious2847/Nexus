/**
 * Email adapter (Gmail via nodemailer app-password auth — same account the
 * legacy src/services/emailService.js uses). Isolated so flows are testable
 * without live credentials. In dev/no-credentials mode it logs instead of
 * failing, matching the Arkesel adapter's pattern.
 *
 * nodemailer ships no TypeScript types of its own (no `types` field, no
 * @types/nodemailer in this repo) — required via a minimal local shim rather
 * than pulling in a new dependency for one function.
 */
const nodemailer = require('nodemailer') as {
  createTransport: (opts: { service: string; auth: { user: string; pass: string } }) => MailTransporter;
};

interface MailTransporter {
  sendMail: (opts: { from: string; to: string; subject: string; html: string; text?: string }) => Promise<{ messageId: string }>;
}

export interface EmailResult {
  sent: boolean;
  provider: string;
  detail?: string;
}

let transporter: MailTransporter | null = null;

function getTransporter(): MailTransporter | null {
  if (transporter) return transporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<EmailResult> {
  const t = getTransporter();
  if (!t) {
    console.warn(`[email:dev] (no GMAIL_USER/GMAIL_APP_PASSWORD) would send to ${to}: ${subject}`);
    return { sent: false, provider: 'none', detail: 'GMAIL_USER/GMAIL_APP_PASSWORD not set' };
  }
  try {
    const info = await t.sendMail({
      from: `"NEXUS" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
      text: text ?? html.replace(/<[^>]+>/g, ''),
    });
    return { sent: true, provider: 'gmail', detail: info.messageId };
  } catch (err) {
    return { sent: false, provider: 'gmail', detail: (err as Error).message };
  }
}
