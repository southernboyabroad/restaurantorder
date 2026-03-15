import express, { Request, Response } from 'express';
import { config } from '../config';
import { validateTwilioWebhook, buildOrderPromptMessage, buildConfirmationMessage } from './sms';
import { findCustomerByPhone, findCustomerByNameHint, normalizePhone, appendOrder, markOrdersAsEmailed, getLastOrderForCustomer, getTodaysOrders, updateTodaysOrder, getOtherContactsForCustomer, Customer } from './sheets';
import { parseOrder, parseOrderStrict, isAffirmativeReply, isRepeatOrderRequest, isDeclineReply, isCalledInReply, parseCorrectionRequest, preprocessCorrectionText, isReactionMessage } from './orderParser';
import { sendSms, forwardToAdmin } from './sms';
import { updateDeliveryTabOrder } from './deliveryTab';
import { formatOrderText, formatOrderHtml, getDeliveryDate, formatDeliveryDate, deliveryDayName } from './orderSummary';
import { sendWarehouseEmail } from './email';
import { isInsideOrderingWindow, isEarlyOrderWindow, getNextOrderingDate } from './orderingWindow';
import logger from '../logger';

// Short delay so replies feel personal rather than instant/automated
const replyDelay = () =>
  process.env.NODE_ENV !== 'test'
    ? new Promise<void>((resolve) => setTimeout(resolve, 15_000))
    : Promise.resolve();

// ── Order correction handler ────────────────────────────────────
// Admin texts:    "change Waldo's toast to 15"
// Customer texts: "change my toast to 15" or "change toast to 15"

async function handleCorrection(
  from: string,
  senderCustomer: Customer | undefined,
  isAdmin: boolean,
  correction: ReturnType<typeof parseCorrectionRequest> & {},
  res: import('express').Response,
  orderDateStr?: string,
): Promise<void> {
  const dateStr = orderDateStr || new Date().toISOString().slice(0, 10);

  let targetCustomer: Customer;

  if (correction.customerNameHint) {
    // Admin correction — changing someone else's order
    if (!isAdmin) {
      const msg = senderCustomer
        ? "Sorry, only the admin can correct other customers' orders."
        : "Sorry, we don't have your number on file. Please contact us to get set up.";
      await sendSms(from, msg);
      res.type('text/xml').send('<Response></Response>');
      return;
    }

    const lookup = await findCustomerByNameHint(correction.customerNameHint);
    if (!lookup) {
      await sendSms(from, `Couldn't find a customer matching "${correction.customerNameHint}". Check the name and try again.`);
      res.type('text/xml').send('<Response></Response>');
      return;
    }
    if (lookup.ambiguous) {
      const names = lookup.ambiguous.slice(0, 5).join(', ');
      await sendSms(from, `Multiple customers match "${correction.customerNameHint}": ${names}. Please be more specific.`);
      res.type('text/xml').send('<Response></Response>');
      return;
    }
    targetCustomer = lookup.customer;
  } else {
    // Self-correction
    if (!senderCustomer) {
      await sendSms(from, "Sorry, we don't have your number on file. Please contact us to get set up.");
      res.type('text/xml').send('<Response></Response>');
      return;
    }
    targetCustomer = senderCustomer;
  }

  // Parse quantities from the correction text
  const preprocessed = preprocessCorrectionText(correction.orderText);
  const parsed = parseOrderStrict(preprocessed);
  const hasItems = parsed && Object.values(parsed.quantities).some((q) => q > 0);

  if (!hasItems) {
    const example = correction.customerNameHint
      ? `"change ${correction.customerNameHint}'s toast to 15"`
      : '"change my toast to 15"';
    await sendSms(from, `Couldn't understand the correction. Try something like:\n${example}`);
    res.type('text/xml').send('<Response></Response>');
    return;
  }

  // Update the existing order in the sheet
  const result = await updateTodaysOrder(targetCustomer.name, dateStr, parsed!.quantities);

  if (!result.found) {
    await sendSms(from, `No order found today for ${targetCustomer.name}. They may not have ordered yet.`);
    res.type('text/xml').send('<Response></Response>');
    return;
  }

  // Update the delivery tab with the merged quantities
  try {
    const corrDelivery = getDeliveryDate(new Date(`${dateStr}T12:00:00`));
    await updateDeliveryTabOrder(targetCustomer.name, result.mergedQuantities, corrDelivery);
  } catch (tabErr) {
    logger.error('Failed to update delivery tab for correction', { error: tabErr });
  }

  // If the original was already emailed, send a correction email now
  if (result.wasEmailed) {
    try {
      const delivery = getDeliveryDate(new Date(`${dateStr}T12:00:00`));
      const deliveryDateStr = formatDeliveryDate(delivery);
      const dayName = deliveryDayName(delivery);
      const routeLabel = targetCustomer.route || 'Unassigned';
      const subject = `CORRECTED - Route ${routeLabel} - ${deliveryDateStr} - ${targetCustomer.name}`;
      const textBody = formatOrderText(result.mergedQuantities, dayName);
      const htmlBody = formatOrderHtml(result.mergedQuantities, dayName);

      await sendWarehouseEmail(subject, textBody, htmlBody);
      logger.info('Correction email sent to warehouse', { customer: targetCustomer.name, route: routeLabel });
    } catch (emailErr) {
      logger.error('Failed to send correction email', { error: emailErr, customer: targetCustomer.name });
    }
  }

  // Send confirmation
  const itemLines = Object.entries(result.mergedQuantities)
    .filter(([, qty]) => qty > 0)
    .map(([product, qty]) => {
      const display = product
        .replace(/_/g, ' ')
        .replace(/\blong\b/gi, 'hot dog')
        .replace(/\binstitutional sandwich\b/gi, 'sandwich');
      return `${display} - ${qty}`;
    })
    .join('\n');

  let msg = `Order corrected for ${targetCustomer.name}:\n\n${itemLines}`;
  if (result.wasEmailed) {
    msg += '\n\nA corrected email has been sent to the warehouse.';
  }

  await sendSms(from, msg);
  await forwardToAdmin('out', targetCustomer.name, msg, from);
  logger.info('Order correction completed', {
    correctedBy: from,
    customer: targetCustomer.name,
    previousQuantities: result.previousQuantities,
    newQuantities: result.mergedQuantities,
    wasEmailed: result.wasEmailed,
  });
  res.type('text/xml').send('<Response></Response>');
}

export const webhookRouter = express.Router();

// Twilio sends POST to /sms when a customer replies
webhookRouter.post('/sms', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
  const { Body: body, From: from } = req.body as { Body: string; From: string };

  logger.info('Inbound SMS received', { from, body });

  // ── Check ordering window ──────────────────────────────────────
  // Inside the normal window (Wed/Fri/Sat 9:30 AM - 1 PM) → process normally
  // Early order window (after 6 PM on ordering days, or non-ordering days) → accept for next delivery
  // Dead zone (1 PM - 6 PM on ordering days) → stay silent (admin is exempt)
  const isAdminSender = !!config.adminPhoneNumber && normalizePhone(from) === normalizePhone(config.adminPhoneNumber);
  const insideWindow = isInsideOrderingWindow();
  const earlyOrder = !insideWindow && isEarlyOrderWindow();

  if (!insideWindow && !earlyOrder && !isAdminSender) {
    logger.info('Outside ordering window — ignoring inbound SMS (no bot reply)', { from });
    res.type('text/xml').send('<Response></Response>');
    return;
  }

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
    const isAdmin = isAdminSender;

    // Forward inbound SMS to admin so they can follow along
    const customerLabel = customer?.name || 'Unknown';
    await forwardToAdmin('in', customerLabel, body, from);

    // ── Ignore message reactions (👍 to "..." / Liked "...") ──────
    // iOS and Android send a quoted copy of the original message when
    // someone reacts to it.  That quoted text can contain order quantities
    // and cause accidental orders.  Silently drop these.
    if (isReactionMessage(body)) {
      logger.info('Message reaction detected — ignoring', { from, body });
      res.type('text/xml').send('<Response></Response>');
      return;
    }

    // ── Determine the order date ──────────────────────────────────
    // During the normal window → today's date
    // Early order → the customer's next scheduled ordering day
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let orderDateStr: string;
    let orderDayOfWeek: number;

    if (earlyOrder && customer) {
      const next = getNextOrderingDate(customer);
      orderDateStr = next.dateStr;
      orderDayOfWeek = next.dayOfWeek;
      logger.info('Early order detected', { from, name: customer.name, orderDate: orderDateStr, orderDay: DAY_NAMES[orderDayOfWeek] });
    } else {
      orderDateStr = new Date().toISOString().slice(0, 10);
      orderDayOfWeek = new Date().getDay();
    }

    // ── Check for order correction ──────────────────────────────
    const correction = parseCorrectionRequest(body);
    if (correction) {
      await handleCorrection(from, customer, isAdmin, correction, res, orderDateStr);
      return;
    }

    // ── Admin texting in? Stay silent. ─────────────────────────
    // The admin's own messages should never trigger bot replies
    // (unknown-number errors, order parsing, etc.).  Corrections
    // are already handled above, so this is the right place.
    if (isAdmin) {
      logger.info('Admin SMS — no bot reply', { from, body });
      res.type('text/xml').send('<Response></Response>');
      return;
    }

    if (!customer) {
      logger.warn('Received SMS from unknown number', { from });
      // Reply politely
      const unknownReply = 'Sorry, we don\'t have your number on file. Please contact us to get set up.';
      await sendSms(from, unknownReply);
      await forwardToAdmin('out', 'Unknown', unknownReply, from);
      res.type('text/xml').send('<Response></Response>');
      return;
    }

    // ── Already ordered for target date? ────────────────────────────
    // Once a customer has placed an order and received their confirmation,
    // any follow-up ("Thanks!", "Have a great day", etc.) should NOT
    // trigger another bot reply.  Corrections are already handled above.
    const dateStr = orderDateStr;
    const todaysOrders = await getTodaysOrders(dateStr);
    const normalizedFrom = normalizePhone(from);

    // Check if THIS specific phone already placed an order today
    const senderAlreadyOrdered = todaysOrders.some(
      (o) => normalizePhone(o.phone) === normalizedFrom,
    );

    if (senderAlreadyOrdered) {
      logger.info('Customer already ordered today — staying silent', { from, name: customer.name, body });
      res.type('text/xml').send('<Response></Response>');
      return;
    }

    // Check if a DIFFERENT contact from the same restaurant already ordered with real items
    const otherContactOrder = todaysOrders.find(
      (o) =>
        o.name.toLowerCase() === customer.name.toLowerCase() &&
        normalizePhone(o.phone) !== normalizedFrom &&
        Object.values(o.quantities).some((q) => q > 0),
    );

    if (otherContactOrder) {
      // Let them know the order was already handled
      const existingItems = Object.entries(otherContactOrder.quantities)
        .filter(([, qty]) => qty > 0)
        .map(([product, qty]) => {
          const display = product
            .replace(/_/g, ' ')
            .replace(/\blong\b/gi, 'hot dog')
            .replace(/\binstitutional sandwich\b/gi, 'sandwich');
          return `${display} - ${qty}`;
        })
        .join('\n');

      const alreadyMsg = `Heads up — an order has already been placed for you guys today:\n\n${existingItems}\n\nIf you need to make changes, reply with something like "change toast to 15".`;
      await sendSms(from, alreadyMsg);
      await forwardToAdmin('out', customer.name, alreadyMsg, from);
      logger.info('Another contact already ordered — notified sender', { from, name: customer.name, orderedBy: otherContactOrder.phone });
      res.type('text/xml').send('<Response></Response>');
      return;
    }

    // Parse the order (pass default product and product order for bare-number mapping)
    const parsed = await parseOrder(body, customer.defaultProduct, customer.productOrder);

    // Apply per-customer product remapping (e.g. Tilly's: long → top_slice)
    if (customer.productMap && Object.keys(customer.productMap).length > 0) {
      for (const [src, dest] of Object.entries(customer.productMap)) {
        if (src in parsed.quantities) {
          parsed.quantities[dest] = (parsed.quantities[dest] || 0) + parsed.quantities[src];
          delete parsed.quantities[src];
          logger.info('Applied customer product remap', { customer: customer.name, src, dest });
        }
      }
    }

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
        await replyDelay();
        await sendSms(from, followUp);
        await forwardToAdmin('out', customer.name, followUp, from);
        res.type('text/xml').send('<Response></Response>');
        return;
      }

      // Check if the customer is declining / skipping their order
      if (isDeclineReply(body)) {
        logger.info('Decline reply detected — recording zero order', { from, body, name: customer.name });

        // Record a zero-quantity order so the 10:30 reminder is suppressed
        const zeroQuantities: Record<string, number> = {};
        for (const p of config.products) {
          zeroQuantities[p] = 0;
        }
        await appendOrder({
          date: orderDateStr,
          phone: customer.phone,
          name: customer.name,
          route: customer.route || '',
          quantities: zeroQuantities,
          rawReply: body,
          emailed: false,
        });

        // Update delivery tab with zeros and mark green
        try {
          const declineDelivery = getDeliveryDate(new Date(`${orderDateStr}T12:00:00`));
          await updateDeliveryTabOrder(customer.name, zeroQuantities, declineDelivery);
        } catch (tabErr) {
          logger.error('Failed to update delivery tab for decline', { error: tabErr });
        }

        const declineMsg = earlyOrder
          ? `Got it — no order for ${DAY_NAMES[orderDayOfWeek]}. You won't get a text that day.`
          : buildConfirmationMessage(customer.route, orderDayOfWeek);
        await replyDelay();
        await sendSms(from, declineMsg);
        await forwardToAdmin('out', customer.name, declineMsg, from);
        res.type('text/xml').send('<Response></Response>');
        return;
      }

      // Check if the customer called the order in by phone
      if (isCalledInReply(body)) {
        logger.info('Called-in reply detected — notifying admin', { from, body, name: customer.name });
        const calledInMsg = `Got it — ${customer.name} called their order in. We'll get it entered.`;
        await replyDelay();
        await sendSms(from, calledInMsg);
        await forwardToAdmin('in', customer.name, `⚠️ ${customer.name} says they called their order in. Please enter it manually.`, from);
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
          const noPrevMsg = `Hi ${customer.name}, we don't have a previous order on file for you. Please reply with your order like:\ntoast 10, 4-inch 5, hot dog 20`;
          await replyDelay();
          await sendSms(from, noPrevMsg);
          await forwardToAdmin('out', customer.name, noPrevMsg, from);
          res.type('text/xml').send('<Response></Response>');
          return;
        }
      } else {
        // Could not parse anything useful
        logger.warn('Could not parse order from reply', { from, body });
        const noParseMsg = `Hi ${customer.name}, we couldn't understand your order. Please reply with quantities like:\ntoast 10, 4-inch 5, hot dog 20`;
        await replyDelay();
        await sendSms(from, noParseMsg);
        await forwardToAdmin('out', customer.name, noParseMsg, from);
        res.type('text/xml').send('<Response></Response>');
        return;
      }
    }

    // Record the order
    await appendOrder({
      date: orderDateStr,
      phone: customer.phone,
      name: customer.name,
      route: customer.route || '',
      quantities: parsed.quantities,
      rawReply: body,
      emailed: false,
    });

    // Also update the delivery date tab (second mechanism)
    try {
      const orderDelivery = getDeliveryDate(new Date(`${orderDateStr}T12:00:00`));
      await updateDeliveryTabOrder(customer.name, parsed.quantities, orderDelivery);
    } catch (tabErr) {
      logger.error('Failed to update delivery tab', { error: tabErr });
      // Non-fatal — the flat Orders sheet already has the order
    }

    // Warehouse email is sent by the 11:30 AM scheduler (afternoonJob),
    // not on each individual SMS. The /trigger-email endpoint can be used
    // to manually send any un-emailed orders if needed.

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

    let confirmationMsg: string;
    if (earlyOrder) {
      const deliveryDate = getDeliveryDate(new Date(`${orderDateStr}T12:00:00`));
      const deliveryDay = DAY_NAMES[deliveryDate.getDay()];
      confirmationMsg = `Got it! Your order for ${deliveryDay} is locked in. You won't get a text on ${DAY_NAMES[orderDayOfWeek]}.\n\n${itemLines}`;
    } else {
      confirmationMsg = buildConfirmationMessage(customer.route, orderDayOfWeek) + '\n\n' + itemLines;
    }
    if (!parsed.confident) {
      confirmationMsg += '\n\n⚠️ We interpreted your message with AI — please double-check and reply again if anything is wrong.';
    }

    await replyDelay();
    await sendSms(from, confirmationMsg);
    await forwardToAdmin('out', customer.name, confirmationMsg, from);

    // Notify other contacts for the same restaurant so they know the order is handled
    try {
      const otherContacts = await getOtherContactsForCustomer(customer.name, from);
      if (otherContacts.length > 0) {
        const notifyMsg = `Heads up — an order has been placed for you guys today:\n\n${itemLines}\n\nNo need to reply unless you'd like to make changes.`;
        for (const contact of otherContacts) {
          await sendSms(contact.phone, notifyMsg);
          logger.info('Notified other contact about order', {
            customer: customer.name,
            notifiedPhone: contact.phone,
          });
        }
      }
    } catch (notifyErr) {
      logger.error('Failed to notify other contacts', { error: notifyErr });
    }

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
