import cron from 'node-cron';
import { getCustomers, getTodaysOrders, markOrdersAsEmailed, syncOrdersToRestaurantDataSheets } from './sheets';
import { sendSms, buildOrderPromptMessage, forwardToAdmin } from './sms';
import { formatSummaryText, formatSummaryHtml, getDeliveryDate, formatDeliveryDate, deliveryDayName, groupOrdersByRoute } from './orderSummary';
import { sendWarehouseEmail } from './email';
import { ensureOrdersSheet } from './sheets';
import { ensureDeliveryTab, updateDeliveryTabOrder } from './deliveryTab';
import { config } from '../config';
import logger from '../logger';

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── 9:30 AM ET — Wed, Fri, Sat — send order prompts ─────────────

async function morningJob(): Promise<void> {
  if (!config.schedulerEnabled) {
    logger.info('Scheduler disabled — skipping morning job');
    return;
  }
  logger.info('=== MORNING JOB START ===');
  try {
    await ensureOrdersSheet();
    // Create the delivery date tab (e.g. "DLVR 2-14") if it doesn't exist yet
    try {
      await ensureDeliveryTab();
    } catch (tabErr) {
      logger.error('Failed to create delivery tab', { error: tabErr });
      // Non-fatal — continue with the SMS blast
    }
    const customers = await getCustomers();

    if (customers.length === 0) {
      logger.warn('No customers found — skipping SMS blast');
      return;
    }

    // In test mode, only send to the test phone number
    if (config.testPhoneNumber) {
      logger.info(`TEST MODE — sending only to ${config.testPhoneNumber}`);
      const message = buildOrderPromptMessage(undefined);
      if (message) {
        await sendSms(config.testPhoneNumber, message);
        logger.info('Morning SMS test complete: 1 sent to test number');
      } else {
        logger.info('Morning SMS test: no message for today (route/day combo)');
      }
    } else {
      // Build messages per customer; skip customers whose route has no text today.
      // Also honour per-customer smsDays overrides (Column F in the Customers sheet).
      // Skip customers who already have an order for today (early orders).
      const dow = new Date().getDay();
      const dateStr = todayDateStr();
      const existingOrders = await getTodaysOrders(dateStr);
      const alreadyOrderedNames = new Set(existingOrders.map((o) => o.name.toLowerCase()));

      const toSend = customers
        .filter((c) => !c.smsDays || c.smsDays.includes(dow))
        .filter((c) => !alreadyOrderedNames.has(c.name.toLowerCase()))
        .map((c) => {
          const routeMsg = buildOrderPromptMessage(c.route);
          // If the route has no text today but this customer has an explicit smsDays
          // override that includes today, use a day-appropriate message instead.
          const message = (routeMsg === null && c.smsDays?.includes(dow))
            ? 'Good morning... what can I get you for tomorrow?'
            : routeMsg;
          return { customer: c, message };
        })
        .filter((entry): entry is { customer: typeof entry.customer; message: string } => entry.message !== null);

      const skippedRoute = customers.length - customers.filter((c) => !c.smsDays || c.smsDays.includes(dow)).length;
      const skippedEarly = customers
        .filter((c) => !c.smsDays || c.smsDays.includes(dow))
        .filter((c) => alreadyOrderedNames.has(c.name.toLowerCase())).length;
      const skippedTotal = customers.length - toSend.length;

      if (skippedEarly > 0) {
        logger.info(`Skipping ${skippedEarly} customer(s) — already have an early order for today`);
      }
      if (skippedTotal > skippedEarly) {
        logger.info(`Skipping ${skippedTotal - skippedEarly} customer(s) — no text scheduled for their route today`);
      }

      const results = await Promise.allSettled(
        toSend.map(async ({ customer, message }) => {
          await sendSms(customer.phone, message);
          await forwardToAdmin('out', customer.name, message, customer.phone);
        }),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;
      logger.info(`Morning SMS blast complete: ${succeeded} sent, ${failed} failed`);
    }

    // Sync any pre-entered orders (e.g. called-in orders entered manually) to
    // route-specific Restaurant_Data sheets. This runs after the SMS blast so
    // that customers with early orders are already skipped above, and their
    // orders get synced to the route sheets here.
    try {
      await syncOrdersToRestaurantDataSheets(todayDateStr());
    } catch (syncErr) {
      logger.error('Failed to sync pre-entered orders to Restaurant_Data sheets', { error: syncErr });
    }
  } catch (err) {
    logger.error('Morning job failed', { error: err });
  }
}

// ── 10:30 AM ET — Wed, Fri, Sat — reminder for non-responders ────

async function reminderJob(): Promise<void> {
  if (!config.schedulerEnabled) {
    logger.info('Scheduler disabled — skipping reminder job');
    return;
  }
  logger.info('=== REMINDER JOB START ===');
  try {
    const dateStr = todayDateStr();
    const customers = await getCustomers();
    const orders = await getTodaysOrders(dateStr);

    // Collect customer names that have already ordered today
    const orderedNames = new Set(orders.map((o) => o.name.toLowerCase()));

    // Find customers who haven't ordered — dedupe by name so each
    // restaurant only gets one reminder per phone number.
    // Also skip customers whose route has no text today or whose
    // smsDays override excludes today.
    const dow = new Date().getDay();
    const needsReminder = customers.filter(
      (c) =>
        !orderedNames.has(c.name.toLowerCase()) &&
        (!c.smsDays || c.smsDays.includes(dow)) &&
        (buildOrderPromptMessage(c.route) !== null || c.smsDays?.includes(dow)),
    );

    if (needsReminder.length === 0) {
      logger.info('All customers have ordered — no reminders needed');
      return;
    }

    // In test mode, only send to the test phone number
    if (config.testPhoneNumber) {
      logger.info(`TEST MODE — sending reminder only to ${config.testPhoneNumber}`);
      await sendSms(config.testPhoneNumber, 'Reminder');
      logger.info('Reminder SMS test complete: 1 sent to test number');
    } else {
      const results = await Promise.allSettled(
        needsReminder.map(async (c) => {
          await sendSms(c.phone, 'Reminder');
          await forwardToAdmin('out', c.name, 'Reminder', c.phone);
        }),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;
      logger.info(`Reminder SMS complete: ${succeeded} sent, ${failed} failed`);
    }
  } catch (err) {
    logger.error('Reminder job failed', { error: err });
  }
}

// ── 11:30 AM ET — Wed, Fri, Sat — summarize + email warehouse ───

async function afternoonJob(): Promise<void> {
  if (!config.schedulerEnabled) {
    logger.info('Scheduler disabled — skipping afternoon job');
    return;
  }
  logger.info('=== AFTERNOON JOB START ===');
  try {
    const dateStr = todayDateStr();
    const delivery = getDeliveryDate();
    const deliveryDateStr = formatDeliveryDate(delivery);
    const dayName = deliveryDayName(delivery);
    const orders = await getTodaysOrders(dateStr);

    // Sync all today's orders to the delivery tab (catches any that weren't
    // written in real-time, e.g. early orders or SMS processing hiccups)
    for (const order of orders) {
      try {
        await updateDeliveryTabOrder(order.name, order.quantities, delivery);
      } catch (syncErr) {
        logger.error(`Failed to sync order for "${order.name}" to delivery tab`, { error: syncErr });
      }
    }

    // Only send emails for orders that weren't already emailed on SMS receipt
    const unsent = orders.filter((o) => !o.emailed);

    if (unsent.length === 0) {
      logger.info('All orders already emailed — nothing to catch up');
      return;
    }

    // Aggregate unsent orders by route and send one totaled email per route
    const routeSummaries = groupOrdersByRoute(dateStr, unsent);
    for (const summary of routeSummaries) {
      const routeLabel = summary.route || 'Unassigned';
      const subject = `ADDITIONS to Route ${routeLabel}- ${deliveryDateStr}`;
      const textBody = formatSummaryText(summary, dayName);
      const htmlBody = formatSummaryHtml(summary, dayName);
      await sendWarehouseEmail(subject, textBody, htmlBody);
      logger.info(`Aggregated email sent for route ${routeLabel} (${summary.orderCount} orders)`);
    }

    await markOrdersAsEmailed(dateStr);

    logger.info('=== AFTERNOON JOB COMPLETE ===');
  } catch (err) {
    logger.error('Afternoon job failed', { error: err });
  }
}

// ── Schedule registration ───────────────────────────────────────

export function startScheduler(): void {
  // Cron expressions use the system timezone — we set TZ=America/New_York
  // "At 09:30 on Wednesday, Friday, and Saturday"
  cron.schedule('30 9 * * 3,5,6', () => {
    morningJob();
  });

  // "At 10:30 on Wednesday, Friday, and Saturday"
  cron.schedule('30 10 * * 3,5,6', () => {
    reminderJob();
  });

  // "At 11:15 on Wednesday, Friday, and Saturday" — second reminder
  cron.schedule('15 11 * * 3,5,6', () => {
    reminderJob();
  });

  // "At 11:30 on Wednesday, Friday, and Saturday"
  cron.schedule('30 11 * * 3,5,6', () => {
    afternoonJob();
  });

  if (config.schedulerEnabled) {
    if (config.testPhoneNumber) {
      logger.info(`Scheduler ENABLED (TEST MODE) — SMS will only go to ${config.testPhoneNumber}`);
    } else {
      logger.info('Scheduler ENABLED — SMS at 9:30 AM, reminders at 10:30 & 11:15 AM, email at 11:30 AM (Wed/Fri/Sat ET)');
    }
  } else {
    logger.info('Scheduler DISABLED — cron jobs registered but will not run. Set SCHEDULER_ENABLED=true to activate.');
  }
}

// Exported for manual triggering / testing
export { morningJob, reminderJob, afternoonJob };
