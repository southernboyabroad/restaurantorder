import { Resend } from 'resend';
import { config } from '../config';
import logger from '../logger';

const resend = new Resend(config.resend.apiKey);

// Resend returned a 520 for ~98s on 2026-10-23 and had recovered a few minutes
// later. A provider blip should not cost a day's order email, so transient
// failures are retried with backoff. 4xx is the caller's fault and is not retried.
const RETRY_DELAYS_MS = [2_000, 8_000, 20_000];

function isTransient(error: { statusCode?: number | null }): boolean {
  const status = error?.statusCode;
  if (typeof status === 'number') return status >= 500 || status === 429;
  // No status (timeout, socket hang-up, DNS) — worth another go.
  return true;
}

export async function sendWarehouseEmail(
  subject: string,
  textBody: string,
  htmlBody: string,
): Promise<void> {
  const fromEmail = config.resend.fromEmail.trim();
  const toEmails = config.sendgrid.warehouseEmail
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  const fromName = config.emailSignOffName || 'Martins Bread Orders';

  logger.info('Sending warehouse email', { from: fromEmail, to: toEmails, subject });

  for (let attempt = 0; ; attempt++) {
    const { error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: toEmails,
      replyTo: fromEmail,
      subject,
      text: textBody,
      html: htmlBody,
    });

    if (!error) {
      logger.info(`Warehouse email sent to ${toEmails.join(', ')}`);
      return;
    }

    const retryable = isTransient(error) && attempt < RETRY_DELAYS_MS.length;
    if (!retryable) {
      logger.error('Failed to send warehouse email', {
        error,
        from: fromEmail,
        to: toEmails,
        attempts: attempt + 1,
      });
      throw new Error(error.message);
    }

    const delay = RETRY_DELAYS_MS[attempt];
    logger.warn(`Warehouse email attempt ${attempt + 1} failed — retrying in ${delay}ms`, {
      error,
      subject,
    });
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
