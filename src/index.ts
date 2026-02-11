import express from 'express';
import { config } from './config';
import { webhookRouter } from './services/webhook';
import { startScheduler } from './services/scheduler';
import logger from './logger';

const app = express();

app.get('/', (req, res) => {
  res.send('Restaurant Order Service is running.');
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
