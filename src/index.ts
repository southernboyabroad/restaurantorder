import express from 'express';
import { config } from './config';
import { webhookRouter } from './services/webhook';
import { startScheduler, reminderJob } from './services/scheduler';
import { getTodaysOrders } from './services/sheets';
import { updateDeliveryTabOrder } from './services/deliveryTab';
import logger from './logger';

const app = express();

// ── Trust reverse proxy (Render, Railway, etc.) ─────────────────
// Without this, req.protocol returns "http" behind the proxy,
// which breaks Twilio webhook signature validation (Twilio signs
// against the public https:// URL).
app.set('trust proxy', 1);

// ── Homepage ────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.send('Restaurant Order Service is running.');
});

// ── Manual trigger — POST /api/remind ───────────────────────────
app.get('/api/remind', async (_req, res) => {
  try {
    await reminderJob();
    res.json({ ok: true, message: 'Reminder job executed' });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Manual trigger — GET /api/sync-delivery ─────────────────────
// Reads all of today's orders from the Orders sheet and pushes
// each one into the delivery tab (creating it if needed).
// Handles manually-entered or "called in" orders that bypassed
// the normal SMS → delivery-tab flow.
app.get('/api/sync-delivery', async (_req, res) => {
  try {
    const dateStr = new Date().toISOString().slice(0, 10);
    const orders = await getTodaysOrders(dateStr);

    if (orders.length === 0) {
      res.json({ ok: true, message: `No orders found for ${dateStr}` });
      return;
    }

    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const order of orders) {
      const hasItems = Object.values(order.quantities).some((q) => q > 0);
      if (!hasItems) {
        skipped++;
        continue;
      }
      try {
        await updateDeliveryTabOrder(order.name, order.quantities);
        synced++;
      } catch (err) {
        errors.push(`${order.name}: ${String(err)}`);
      }
    }

    res.json({
      ok: true,
      date: dateStr,
      totalOrders: orders.length,
      synced,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Webhook routes ──────────────────────────────────────────────
app.use('/', webhookRouter);

// ── Start server ────────────────────────────────────────────────
app.listen(config.port, () => {
  logger.info(`Server listening on port ${config.port}`);
  logger.info(`Timezone: ${process.env.TZ || '(system default)'}`);
  logger.info(`Products: ${config.products.join(', ')}`);

  startScheduler();
});

