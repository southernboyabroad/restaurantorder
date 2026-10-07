import { Resend } from 'resend';
import { config } from '../config';
import logger from '../logger';

const resend = new Resend(config.resend.apiKey);

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

  const { error } = await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to: toEmails,
    replyTo: fromEmail,
    subject,
    text: textBody,
    html: htmlBody,
  });

  if (error) {
    logger.error('Failed to send warehouse email', { error, from: fromEmail, to: toEmails });
    throw new Error(error.message);
  }

  logger.info(`Warehouse email sent to ${toEmails.join(', ')}`);
}
