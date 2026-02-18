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
 * Forward a copy of an SMS exchange to the admin phone number so
 * the owner can follow along in real-time.
 *
 * direction: "out" for messages the bot sent, "in" for customer replies.
 * Does nothing if ADMIN_PHONE_NUMBER is not set or if the message
 * was already sent to/from the admin number (avoids loops).
 */
export async function forwardToAdmin(
  direction: 'in' | 'out',
  customerName: string,
  body: string,
  customerPhone?: string,
): Promise<void> {
  const adminPhone = config.adminPhoneNumber;
  if (!adminPhone) return;

  // Don't forward messages that are already to/from the admin
  if (customerPhone && normalizeForCompare(customerPhone) === normalizeForCompare(adminPhone)) return;

  const arrow = direction === 'out' ? '→' : '←';
  const forwardBody = `[${arrow} ${customerName}]\n${body}`;

  try {
    await client.messages.create({
      body: forwardBody,
      from: config.twilio.phoneNumber,
      to: adminPhone,
    });
    logger.info(`Forwarded SMS to admin (${direction} ${customerName})`);
  } catch (err) {
    // Non-fatal — don't let forwarding failures break the main flow
    logger.error('Failed to forward SMS to admin', { error: err });
  }
}

function normalizeForCompare(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
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
      6: 'Good morning... what can I get you for Monday?',   // Saturday
      3: 'Good morning... what can I get you for tomorrow?',  // Wednesday
      5: 'Good morning... what can I get you for tomorrow?',  // Friday
    },
    '25248': {
      6: 'Good morning... what can I get you for Tuesday?',   // Saturday
      3: 'Good morning... what can I get you for Friday?',    // Wednesday
      5: null,                                                 // Friday — no text
    },
  };

  const routeMessages = route ? messageMap[route] : undefined;

  if (routeMessages !== undefined) {
    const msg = routeMessages[dow];
    return msg !== undefined ? msg : null;
  }

  // Fallback for unknown routes — generic prompt
  return 'Good morning... what can I get you for your next delivery?';
}

/**
 * Build the confirmation SMS sent after an order is recorded, based on the
 * customer's route and the current day of the week.
 *
 * Day-of-week uses JS convention: 0=Sun … 6=Sat.
 */
export function buildConfirmationMessage(
  route: string | undefined,
  dayOfWeek?: number,
): string {
  const dow = dayOfWeek ?? new Date().getDay();

  const confirmMap: Record<string, Record<number, string>> = {
    '25252': {
      3: 'Sounds good... Have a great afternoon.',   // Wednesday
      5: 'Sounds good... Have a great afternoon.',   // Friday
      6: 'Sounds good....Have a fantastic weekend.',  // Saturday
    },
    '25248': {
      3: 'Sounds good... Have a great afternoon.',   // Wednesday
      6: 'Sounds good... Have a great weekend.',      // Saturday
    },
  };

  const routeMessages = route ? confirmMap[route] : undefined;
  if (routeMessages !== undefined) {
    const msg = routeMessages[dow];
    if (msg) return msg;
  }

  // Fallback for unknown routes or unexpected days
  return 'Sounds good... Have a great afternoon.';
}

export function validateTwilioWebhook(
  authToken: string,
  twilioSignature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  return twilio.validateRequest(authToken, twilioSignature, url, params);
}
