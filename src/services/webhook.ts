import express, { Request, Response } from 'express';
import { config } from '../config';
import { validateTwilioWebhook, buildOrderPromptMessage, buildConfirmationMessage } from './sms';
import { findCustomerByPhone, appendOrder, markOrdersAsEmailed, getLastOrderForCustomer } from './sheets';
import { parseOrder, isAffirmativeReply, isRepeatOrderRequest } from './orderParser';
import { sendSms } from './sms';
import { updateDeliveryTabOrder } from './deliveryTab';
import { formatOrderText, formatOrderHtml, getDeliveryDate, formatDeliveryDate, deliveryDayName } from './orderSummary';
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

    // Parse the order (pass default product and product order for bare-number mapping)
    const parsed = await parseOrder(body, customer.defaultProduct, customer.productOrder);

    const hasItems = Object.values(parsed.quantities).some((qty) => qty > 0);

    if (!hasItems) {
      // Check if this is an affirmative reply like "Yes", "Okay", "Sure"
      if (isAffirmativeReply(body)) {
        logger.info('Affirmative reply detected — asking for quantities', { from, body });
        let followUp: string;
        if (customer.productOrder && customer.productOrder.length > 0) {
          const exampleQty = customer.productOrder.map(() => '5').join(' and ');
          const exampleLabels = customer.productOrder.join(', ');
          followUp = `Great! Just reply with your quantities for ${exampleLabels}.\nFor example: "${exampleQty}"`;
        } else if (customer.defaultProduct) {
          followUp = `Great! Just reply with how many ${customer.defaultProduct} you need.\nFor example: "10"`;
        } else {
          followUp = `Great! Please reply with your order, like:\ntoast 10, 4-inch 5, hot dog 20`;
        }
        await sendSms(from, followUp);
        res.type('text/xml').send('<Response></Response>');
        return;
      }

      // Check if this is a repeat-order request like "same as last time"
      if (isRepeatOrderRequest(body)) {
        logger.info('Repeat order request detected — looking up last order', { from, body });
        const lastOrder = await getLastOrderForCustomer(from);
        if (lastOrder) {
          // Re-use the quantities from their last order
          parsed.quantities = lastOrder.quantities;
          parsed.confident = true;
          logger.info('Repeating previous order', { from, quantities: lastOrder.quantities });
          // Fall through to the order-recording logic below
        } else {
          await sendSms(
            from,
            `Hi ${customer.name}, we don't have a previous order on file for you. Please reply with your order like:\ntoast 10, 4-inch 5, hot dog 20`,
          );
          res.type('text/xml').send('<Response></Response>');
          return;
        }
      } else {
        // Could not parse anything useful
        logger.warn('Could not parse order from reply', { from, body });
        await sendSms(
          from,
          `Hi ${customer.name}, we couldn't understand your order. Please reply with quantities like:\ntoast 10, 4-inch 5, hot dog 20`,
        );
        res.type('text/xml').send('<Response></Response>');
        return;
      }
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
      emailed: false,
    });

    // Also update the delivery date tab (second mechanism)
    try {
      await updateDeliveryTabOrder(customer.name, parsed.quantities);
    } catch (tabErr) {
      logger.error('Failed to update delivery tab', { error: tabErr });
      // Non-fatal — the flat Orders sheet already has the order
    }

    // ── Send warehouse email immediately for THIS order only ──
    try {
      const delivery = getDeliveryDate();
      const deliveryDateStr = formatDeliveryDate(delivery);
      const dayName = deliveryDayName(delivery);
      const routeLabel = customer.route || 'Unassigned';
      const subject = `ADDITIONS to Route ${routeLabel}- ${deliveryDateStr}`;
      const textBody = formatOrderText(parsed.quantities, dayName);
      const htmlBody = formatOrderHtml(parsed.quantities, dayName);

      await sendWarehouseEmail(subject, textBody, htmlBody);
      await markOrdersAsEmailed(dateStr);
      logger.info('Warehouse email sent for order', { customer: customer.name, route: routeLabel });
    } catch (emailErr) {
      logger.error('Failed to send warehouse email for order', { error: emailErr, customer: customer.name });
      // Non-fatal — the order is still recorded in the sheet
    }

    // Build a confirmation
    const itemLines = Object.entries(parsed.quantities)
      .filter(([, qty]) => qty > 0)
      .map(([product, qty]) => {
        const display = product
          .replace(/_/g, ' ')
          .replace(/\blong\b/gi, 'hot dog')
          .replace(/\binstitutional sandwich\b/gi, 'sandwich');
        return `${display} - ${qty}`;
      })
      .join('\n');

    let confirmationMsg = buildConfirmationMessage(customer.route) + '\n\n' + itemLines;
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

// ── Manual trigger: re-send any un-emailed orders ───────────────
// GET /trigger-email  (optionally pass ?date=2026-02-15)
// Sends individual emails for orders not yet emailed (safety net).
webhookRouter.get('/trigger-email', async (req: Request, res: Response) => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const delivery = getDeliveryDate();
    const deliveryDateStr = formatDeliveryDate(delivery);
    const dayName = deliveryDayName(delivery);

    const { getTodaysOrders } = await import('./sheets');
    const orders = await getTodaysOrders(dateStr);
    const unsent = orders.filter((o) => !o.emailed);

    if (unsent.length === 0) {
      res.json({ status: 'no_unsent', message: `No un-emailed orders for ${dateStr} (${orders.length} total already sent)` });
      return;
    }

    // Send one email per individual order — never cumulate
    let emailCount = 0;
    for (const order of unsent) {
      const routeLabel = order.route || 'Unassigned';
      const subject = `ADDITIONS to Route ${routeLabel}- ${deliveryDateStr}`;
      const textBody = formatOrderText(order.quantities, dayName);
      const htmlBody = formatOrderHtml(order.quantities, dayName);

      await sendWarehouseEmail(subject, textBody, htmlBody);
      emailCount++;
      logger.info(`Manual trigger: email sent for ${order.name} on route ${routeLabel}`);
    }

    await markOrdersAsEmailed(dateStr);

    res.json({ status: 'sent', date: dateStr, deliveryDate: deliveryDateStr, emailsSent: emailCount });
  } catch (err: any) {
    logger.error('Manual email trigger failed', { error: err });
    const detail = err?.response?.body?.errors?.[0]?.message
      || err?.message
      || 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to send email',
      detail,
      debug: {
        fromEmail: config.sendgrid.fromEmail,
        warehouseEmail: config.sendgrid.warehouseEmail,
      },
    });
  }
});

// ── Manual trigger: send yourself the morning text to preview it ──
// GET /trigger-morning-text?route=25252&day=6
//   route — the route number to simulate (default: 25252)
//   day   — day of week as a number: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
//           (defaults to today)
// Only works when TEST_PHONE_NUMBER is set — will NOT text real customers.
webhookRouter.get('/trigger-morning-text', async (req: Request, res: Response) => {
  try {
    if (!config.testPhoneNumber) {
      res.status(400).json({
        status: 'error',
        message: 'TEST_PHONE_NUMBER must be set in .env to use this endpoint. This is a safety measure so real customers never get texted by accident.',
      });
      return;
    }

    const route = (req.query.route as string) || '25252';
    const day = req.query.day !== undefined ? Number(req.query.day) : new Date().getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const message = buildOrderPromptMessage(route, day);

    if (!message) {
      res.json({
        status: 'no_message',
        route,
        day: dayNames[day],
        message: `Route ${route} does not get a text on ${dayNames[day]}s.`,
      });
      return;
    }

    await sendSms(config.testPhoneNumber, message);
    logger.info('Manual morning text sent', { to: config.testPhoneNumber, route, day: dayNames[day] });

    res.json({
      status: 'sent',
      to: config.testPhoneNumber,
      route,
      day: dayNames[day],
      messageSent: message,
    });
  } catch (err: any) {
    logger.error('Manual morning text trigger failed', { error: err });
    res.status(500).json({ status: 'error', message: err?.message || 'Unknown error' });
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
