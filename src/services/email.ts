import sgMail from '@sendgrid/mail';
import { config } from '../config';
import logger from '../logger';

sgMail.setApiKey(config.sendgrid.apiKey);

export async function sendWarehouseEmail(
  subject: string,
  textBody: string,
  htmlBody: string,
): Promise<void> {
  // Trim whitespace from email addresses to avoid "Invalid from email" errors
  const fromEmail = config.sendgrid.fromEmail.trim();
  const toEmails = config.sendgrid.warehouseEmail
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  const msg = {
    to: toEmails,
    from: {
      email: fromEmail,
      name: config.emailSignOffName || 'Martins Bread Orders',
    },
    replyTo: {
      email: fromEmail,
      name: config.emailSignOffName || 'Martins Bread Orders',
    },
    subject,
    text: textBody,
    html: htmlBody,
  };

  logger.info('Sending warehouse email', { from: fromEmail, to: toEmails, subject });

  try {
    await sgMail.send(msg);
    logger.info(`Warehouse email sent to ${toEmails.join(', ')}`);
  } catch (err) {
    logger.error('Failed to send warehouse email', { error: err, from: fromEmail, to: toEmails });
    throw err;
  }
}
