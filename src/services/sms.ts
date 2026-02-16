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

/**
 * Build the order prompt SMS for a customer based on their route and the
 * current day of the week.  Returns `null` when no text should be sent
 * (e.g. route 25248 on Fridays).
 *
 * Day-of-week uses JS convention: 0=Sun … 6=Sat.
 */
export function buildOrderPromptMessage(
  route: string | undefined,
  dayOfWeek?: number,
): string | null {
  const dow = dayOfWeek ?? new Date().getDay();

  // Route-specific messages keyed by day-of-week
  const messageMap: Record<string, Record<number, string | null>> = {
    '25252': {
      6: 'Good morning. What can I get you for Monday?',   // Saturday
      3: 'Good morning. What can I get you for tomorrow?',  // Wednesday
      5: 'Good morning. What can I get you for tomorrow?',  // Friday
    },
    '25248': {
      6: 'Good morning. What can I get you for Tuesday?',   // Saturday
      3: 'Good morning. What can I get you for Friday?',    // Wednesday
      5: null,                                               // Friday — no text
    },
  };

  const routeMessages = route ? messageMap[route] : undefined;

  if (routeMessages !== undefined) {
    const msg = routeMessages[dow];
    return msg !== undefined ? msg : null;
  }

  // Fallback for unknown routes — generic prompt
  return 'Good morning. What can I get you for your next delivery?';
}

export function validateTwilioWebhook(
  authToken: string,
  twilioSignature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  return twilio.validateRequest(authToken, twilioSignature, url, params);
}
