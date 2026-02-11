import twilio from 'twilio';
import { config } from '../config';
import logger from '../logger';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export async function sendSms(to: string, body: string): Promise<string> {
  try {
    const message = await client.messages.create({
      body,
      from: config.twilio.phoneNumber,
      to,
    });
    logger.info(`SMS sent to ${to} — SID: ${message.sid}`);
    return message.sid;
  } catch (err) {
    logger.error(`Failed to send SMS to ${to}`, { error: err });
    throw err;
  }
}

export function buildOrderPromptMessage(customerName: string): string {
  const productList = config.products
    .map((p) => p.replace(/_/g, ' '))
    .join(', ');

  return (
    `Hi ${customerName}! Time to place your order for the next delivery.\n\n` +
    `Available products: ${productList}\n\n` +
    `Reply with quantities, e.g.:\n` +
    `toast 10, 4-inch 5, long 20\n\n` +
    `Or just tell us what you need and we'll figure it out!`
  );
}

export function validateTwilioWebhook(
  authToken: string,
  twilioSignature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  return twilio.validateRequest(authToken, twilioSignature, url, params);
}
