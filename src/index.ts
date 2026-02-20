import express from 'express';
import { config } from './config';
import { webhookRouter } from './services/webhook';
import { startScheduler, reminderJob } from './services/scheduler';
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
app.post('/api/remind', async (_req, res) => {
  try {
    await reminderJob();
    res.json({ ok: true, message: 'Reminder job executed' });
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

