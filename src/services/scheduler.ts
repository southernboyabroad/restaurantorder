import cron from 'node-cron';
import { getCustomers } from './sheets';
import { sendSms, buildOrderPromptMessage } from './sms';
import { generateSummariesByRoute, formatSummaryText, formatSummaryHtml } from './orderSummary';
import { sendWarehouseEmail } from './email';
import { ensureOrdersSheet } from './sheets';
import logger from '../logger';

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function todayDisplayDate(): string {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`; // M/D/YYYY
}

// ── 9:30 AM ET — Wed, Fri, Sat — send order prompts ─────────────

async function morningJob(): Promise<void> {
  logger.info('=== MORNING JOB START ===');
  try {
    await ensureOrdersSheet();
    const customers = await getCustomers();

    if (customers.length === 0) {
      logger.warn('No customers found — skipping SMS blast');
      return;
    }

    const results = await Promise.allSettled(
      customers.map(async (c) => {
        const message = buildOrderPromptMessage(c.name);
        return sendSms(c.phone, message);
      }),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    logger.info(`Morning SMS blast complete: ${succeeded} sent, ${failed} failed`);
  } catch (err) {
    logger.error('Morning job failed', { error: err });
  }
}

// ── 11:30 AM ET — Wed, Fri, Sat — summarize + email warehouse ───

async function afternoonJob(): Promise<void> {
  logger.info('=== AFTERNOON JOB START ===');
  try {
    const dateStr = todayDateStr();
    const displayDate = todayDisplayDate();
    const summaries = await generateSummariesByRoute(dateStr);

    if (summaries.length === 0) {
      logger.warn('No orders found today — skipping email');
      return;
    }

    for (const summary of summaries) {
      const routeLabel = summary.route || 'Unassigned';
      const subject = `ADDITIONS to Route ${routeLabel} - ${displayDate}`;
      const textBody = formatSummaryText(summary);
      const htmlBody = formatSummaryHtml(summary);

      await sendWarehouseEmail(subject, textBody, htmlBody);
      logger.info(`Email sent for route ${routeLabel}`);
    }

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

  // "At 11:30 on Wednesday, Friday, and Saturday"
  cron.schedule('30 11 * * 3,5,6', () => {
    afternoonJob();
  });

  logger.info('Scheduler started — SMS at 9:30 AM, email at 11:30 AM (Wed/Fri/Sat ET)');
}

// Exported for manual triggering / testing
export { morningJob, afternoonJob };
