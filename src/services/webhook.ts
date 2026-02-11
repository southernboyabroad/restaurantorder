import express, { Request, Response } from 'express';
import { config } from '../config';
import { validateTwilioWebhook } from './sms';
import { findCustomerByPhone, appendOrder } from './sheets';
import { parseOrder } from './orderParser';
import { sendSms } from './sms';
import logger from '../logger';

export const webhookRouter = express.Router();

// Twilio sends POST to /sms when a customer replies
webhookRouter.post('/sms', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
  const { Body: body, From: from } = req.body as { Body: string; From: string };

  logger.info('Inbound SMS received', { from, body });

  // ── Validate Twilio signature in production ──
  if (process.env.NODE_ENV === 'production') {
    const signature = req.headers['x-twilio-signature'] as string;
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    if (!validateTwilioWebhook(config.twilio.authToken, signature, url, req.body)) {
      logger.warn('Invalid Twilio signature — rejecting webhook', { from });
      res.status(403).send('Forbidden');
      return;
    }
  }

  try {
    // Look up customer
    const customer = await findCustomerByPhone(from);
    if (!customer) {
      logger.warn('Received SMS from unknown number', { from });
      // Reply politely
      await sendSms(from, 'Sorry, we don\'t have your number on file. Please contact us to get set up.');
      res.type('text/xml').send('<Response></Response>');
      return;
    }

    // Parse the order
    const parsed = await parseOrder(body);

    const hasItems = Object.values(parsed.quantities).some((qty) => qty > 0);

    if (!hasItems) {
      // Could not parse anything useful
      logger.warn('Could not parse order from reply', { from, body });
      await sendSms(
        from,
        `Hi ${customer.name}, we couldn't understand your order. Please reply with quantities like:\nchicken 10, ribs 5, coleslaw 20`,
      );
      res.type('text/xml').send('<Response></Response>');
      return;
    }

    // Record the order
    const dateStr = new Date().toISOString().slice(0, 10);
    await appendOrder({
      date: dateStr,
      phone: customer.phone,
      name: customer.name,
      quantities: parsed.quantities,
      rawReply: body,
    });

    // Build a confirmation
    const items = Object.entries(parsed.quantities)
      .filter(([, qty]) => qty > 0)
      .map(([product, qty]) => `${product.replace(/_/g, ' ')} ×${qty}`)
      .join(', ');

    let confirmationMsg = `Thanks ${customer.name}! Your order is recorded:\n${items}`;
    if (!parsed.confident) {
      confirmationMsg += '\n\n⚠️ We interpreted your message with AI — please double-check and reply again if anything is wrong.';
    }

    await sendSms(from, confirmationMsg);

    // Return empty TwiML (we already responded via API)
    res.type('text/xml').send('<Response></Response>');
  } catch (err) {
    logger.error('Error processing inbound SMS', { error: err, from, body });
    res.status(500).type('text/xml').send('<Response></Response>');
  }
});

// Health check
webhookRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
