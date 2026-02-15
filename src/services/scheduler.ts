import cron from 'node-cron';
import { getCustomers, getTodaysOrders, markOrdersAsEmailed } from './sheets';
import { sendSms, buildOrderPromptMessage } from './sms';
import { generateSummariesByRoute, formatSummaryText, formatSummaryHtml, getDeliveryDate, formatDeliveryDate, deliveryDayName } from './orderSummary';
import { sendWarehouseEmail } from './email';
import { ensureOrdersSheet } from './sheets';
import { ensureDeliveryTab } from './deliveryTab';
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
      const message = buildOrderPromptMessage('Test Customer');
      await sendSms(config.testPhoneNumber, message);
      logger.info('Morning SMS test complete: 1 sent to test number');
    } else {
      const results = await Promise.allSettled(
        customers.map(async (c) => {
          const message = buildOrderPromptMessage(c.name);
          return sendSms(c.phone, message);
        }),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;
      logger.info(`Morning SMS blast complete: ${succeeded} sent, ${failed} failed`);
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
    // restaurant only gets one reminder per phone number
    const needsReminder = customers.filter(
      (c) => !orderedNames.has(c.name.toLowerCase()),
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
        needsReminder.map((c) => sendSms(c.phone, 'Reminder')),
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
    const summaries = await generateSummariesByRoute(dateStr);

    if (summaries.length === 0) {
      logger.warn('No orders found today — skipping email');
      return;
    }

    for (const summary of summaries) {
      const routeLabel = summary.route || 'Unassigned';
      const subject = `ADDITIONS to Route ${routeLabel}- ${deliveryDateStr}`;
      const textBody = formatSummaryText(summary, dayName);
      const htmlBody = formatSummaryHtml(summary, dayName);

      await sendWarehouseEmail(subject, textBody, htmlBody);
      logger.info(`Email sent for route ${routeLabel}`);
    }

    // Mark all orders as emailed so late orders trigger individual emails
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

  // "At 11:30 on Wednesday, Friday, and Saturday"
  cron.schedule('30 11 * * 3,5,6', () => {
    afternoonJob();
  });

  if (config.schedulerEnabled) {
    if (config.testPhoneNumber) {
      logger.info(`Scheduler ENABLED (TEST MODE) — SMS will only go to ${config.testPhoneNumber}`);
    } else {
      logger.info('Scheduler ENABLED — SMS at 9:30 AM, reminder at 10:30 AM, email at 11:30 AM (Wed/Fri/Sat ET)');
    }
  } else {
    logger.info('Scheduler DISABLED — cron jobs registered but will not run. Set SCHEDULER_ENABLED=true to activate.');
  }
}

// Exported for manual triggering / testing
export { morningJob, reminderJob, afternoonJob };
