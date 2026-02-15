import express, { Request, Response } from 'express';
import { config } from '../config';
import { validateTwilioWebhook } from './sms';
import { findCustomerByPhone, appendOrder } from './sheets';
import { parseOrder } from './orderParser';
import { sendSms } from './sms';
import { updateDeliveryTabOrder } from './deliveryTab';
import { generateSummariesByRoute, formatSummaryText, formatSummaryHtml, getDeliveryDate, formatDeliveryDate, deliveryDayName } from './orderSummary';
import { sendWarehouseEmail } from './email';
import logger from '../logger';

export const webhookRouter = express.Router();

// Twilio sends POST to /sms when a customer replies
webhookRouter.post('/sms', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
  const { Body: body, From: from } = req.body as { Body: string; From: string };

  logger.info('Inbound SMS received', { from, body });

  // ── Optionally validate Twilio signature ──
  // Disabled by default because Messaging Services + reverse proxies
  // make URL reconstruction unreliable. Enable with TWILIO_VALIDATE_WEBHOOK=true
  // once you've confirmed the system works end-to-end.
  if (process.env.TWILIO_VALIDATE_WEBHOOK === 'true') {
    const signature = req.headers['x-twilio-signature'] as string;
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    logger.info('Twilio signature validation attempt', {
      reconstructedUrl: url,
      protocol: req.protocol,
      host: req.get('host'),
      hasSignature: !!signature,
    });
    if (!validateTwilioWebhook(config.twilio.authToken, signature, url, req.body)) {
      logger.warn('Invalid Twilio signature — rejecting webhook', {
        from,
        reconstructedUrl: url,
      });
      res.status(403).send('Forbidden');
      return;
    }
    logger.info('Twilio signature validation passed');
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

    // Parse the order (pass default product so bare numbers like "12" work)
    const parsed = await parseOrder(body, customer.defaultProduct);

    const hasItems = Object.values(parsed.quantities).some((qty) => qty > 0);

    if (!hasItems) {
      // Could not parse anything useful
      logger.warn('Could not parse order from reply', { from, body });
      await sendSms(
        from,
        `Hi ${customer.name}, we couldn't understand your order. Please reply with quantities like:\ntoast 10, 4-inch 5, long 20`,
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
      route: customer.route || '',
      quantities: parsed.quantities,
      rawReply: body,
    });

    // Also update the delivery date tab (second mechanism)
    try {
      await updateDeliveryTabOrder(customer.name, parsed.quantities);
    } catch (tabErr) {
      logger.error('Failed to update delivery tab', { error: tabErr });
      // Non-fatal — the flat Orders sheet already has the order
    }

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

// ── Manual trigger: send warehouse email now ────────────────────
// POST /trigger-email  (optionally pass ?date=2026-02-15)
webhookRouter.post('/trigger-email', express.json(), async (req: Request, res: Response) => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const delivery = getDeliveryDate();
    const deliveryDateStr = formatDeliveryDate(delivery);
    const dayName = deliveryDayName(delivery);

    const summaries = await generateSummariesByRoute(dateStr);

    if (summaries.length === 0) {
      res.json({ status: 'no_orders', message: `No orders found for ${dateStr}` });
      return;
    }

    const sent: string[] = [];
    for (const summary of summaries) {
      const routeLabel = summary.route || 'Unassigned';
      const subject = `ADDITIONS to Route ${routeLabel}- ${deliveryDateStr}`;
      const textBody = formatSummaryText(summary, dayName);
      const htmlBody = formatSummaryHtml(summary, dayName);

      await sendWarehouseEmail(subject, textBody, htmlBody);
      sent.push(routeLabel);
      logger.info(`Manual trigger: email sent for route ${routeLabel}`);
    }

    res.json({ status: 'sent', date: dateStr, deliveryDate: deliveryDateStr, routes: sent });
  } catch (err) {
    logger.error('Manual email trigger failed', { error: err });
    res.status(500).json({ status: 'error', message: 'Failed to send email' });
  }
});

// Health check
webhookRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    schedulerEnabled: config.schedulerEnabled,
    timestamp: new Date().toISOString(),
  });
});
