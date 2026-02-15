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
  const toEmail = config.sendgrid.warehouseEmail.trim();

  const msg = {
    to: toEmail,
    from: {
      email: fromEmail,
      name: config.emailSignOffName || 'Martins Bread Orders',
    },
    subject,
    text: textBody,
    html: htmlBody,
  };

  logger.info('Sending warehouse email', { from: fromEmail, to: toEmail, subject });

  try {
    await sgMail.send(msg);
    logger.info(`Warehouse email sent to ${toEmail}`);
  } catch (err) {
    logger.error('Failed to send warehouse email', { error: err, from: fromEmail, to: toEmail });
    throw err;
  }
}
