import sgMail from '@sendgrid/mail';
import { config } from '../config';
import logger from '../logger';

sgMail.setApiKey(config.sendgrid.apiKey);

export async function sendWarehouseEmail(
  subject: string,
  textBody: string,
  htmlBody: string,
): Promise<void> {
  const msg = {
    to: config.sendgrid.warehouseEmail,
    from: config.sendgrid.fromEmail,
    subject,
    text: textBody,
    html: htmlBody,
  };

  try {
    await sgMail.send(msg);
    logger.info(`Warehouse email sent to ${config.sendgrid.warehouseEmail}`);
  } catch (err) {
    logger.error('Failed to send warehouse email', { error: err });
    throw err;
  }
}
