# Restaurant Order SMS Automation

Automated SMS-based order collection system. Sends text messages to customers on a schedule, parses their replies into structured orders in Google Sheets, and emails a summary to your warehouse.

## How It Works

1. **9:30 AM (Wed/Fri/Sat)** — The system reads your customer list from Google Sheets and sends each customer an SMS asking for their order.
2. **Customers reply by text** — Replies are received via a Twilio webhook, parsed (regex first, OpenAI fallback), and recorded as rows in the "Orders" sheet and the delivery date tab.
3. **10:30 AM & 11:15 AM** — Reminder texts are sent to customers who haven't replied yet.
4. **11:30 AM** — Orders are aggregated by route and emailed to the warehouse via SendGrid. The delivery date tab is synced as a catch-up pass.

## Project Structure

```
src/
  config.ts              — Environment variable loader with validation
  logger.ts              — Winston logger (console + file)
  index.ts               — Express server + scheduler bootstrap
  services/
    sheets.ts            — Google Sheets: read customers, write orders
    sms.ts               — Twilio: send SMS, build prompt messages
    orderParser.ts       — Regex parser + OpenAI fallback
    orderSummary.ts      — Aggregate orders, format text/HTML
    email.ts             — SendGrid: send warehouse summary
    scheduler.ts         — node-cron jobs (8 AM + 2 PM)
    webhook.ts           — Express routes: POST /sms, GET /health
  __tests__/
    orderParser.test.ts
    orderSummary.test.ts
    webhook.test.ts
```

## Prerequisites

- **Node.js 18+**
- **Twilio account** — with a phone number that can send/receive SMS
- **Google Cloud service account** — with Sheets API enabled
- **SendGrid account** — with a verified sender email
- **OpenAI API key** _(optional)_ — enables AI fallback for messy replies

## Setup

### 1. Clone and install

```bash
git clone <repo-url> && cd restaurant-order-sms
npm install
```

### 2. Google Sheets

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or use an existing one).
3. Enable the **Google Sheets API**.
4. Create a **Service Account** and download the JSON key file.
5. Base64-encode the key: `base64 -w0 service-account.json` (Linux) or `base64 -i service-account.json` (macOS).
6. Create a Google Sheet with a tab named **"Customers"** with headers:

   | A (Name) | B (Phone)      |
   |----------|----------------|
   | Alice    | +15551111111   |
   | Bob      | +15552222222   |

7. Share the spreadsheet with the service account email (found in the JSON key, ending in `@*.iam.gserviceaccount.com`). Give it **Editor** access.
8. Copy the spreadsheet ID from the URL.

### 3. Twilio

1. Sign up at [twilio.com](https://www.twilio.com/).
2. Get a phone number that supports SMS.
3. In the Twilio console, set the **Messaging webhook** for your number to:
   ```
   https://<your-deployed-url>/sms   (HTTP POST)
   ```

### 4. SendGrid

1. Sign up at [sendgrid.com](https://sendgrid.com/).
2. Create an API key with **Mail Send** permission.
3. Verify your sender email (the `SENDGRID_FROM_EMAIL`).

### 5. Environment variables

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

### 6. Run locally

```bash
npm run dev
```

To test the webhook locally, use [ngrok](https://ngrok.com/):

```bash
ngrok http 3000
# Then set your Twilio webhook to: https://<ngrok-id>.ngrok.io/sms
```

## Testing

### Unit tests

```bash
npm test
```

### Manual end-to-end test

1. Start the server locally (`npm run dev`) with ngrok.
2. Set Twilio webhook to your ngrok URL.
3. Trigger the morning job manually:
   ```bash
   curl -X POST http://localhost:3000/test/morning  # (add this route for dev)
   ```
   Or wait for the scheduled time, or temporarily change the cron to run every minute:
   ```ts
   cron.schedule('* * * * *', () => morningJob());
   ```
4. Reply to the SMS from your phone.
5. Check Google Sheets — you should see a new row in the "Orders" tab.
6. Trigger the afternoon job to verify the email arrives at your warehouse.

### Testing order parsing

The strict parser handles these formats:
- `chicken 10, ribs 5`
- `10 chicken, 5 ribs`
- `chicken: 10, ribs: 5`
- Mixed: `I need 10 chicken and ribs 5`

Anything the regex can't parse gets sent to OpenAI (if configured) for AI interpretation. The customer receives a warning if AI parsing was used.

## Deployment

### Option A: Render

1. Push this repo to GitHub.
2. Go to [Render Dashboard](https://dashboard.render.com/) → **New** → **Blueprint**.
3. Connect your repo. Render reads `render.yaml` automatically.
4. Fill in the environment variables marked `sync: false` in the dashboard.
5. Deploy. Note the URL and set it as the Twilio webhook.

### Option B: Railway

1. Push to GitHub.
2. Go to [Railway](https://railway.app/) → **New Project** → **Deploy from GitHub repo**.
3. Railway reads `railway.toml` and the `Dockerfile`.
4. Add all environment variables in the Railway dashboard.
5. Deploy and note the public URL for Twilio.

### Option C: Any Docker host

```bash
docker build -t restaurant-order-sms .
docker run -d --name orders \
  --env-file .env \
  -p 3000:3000 \
  restaurant-order-sms
```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Yes | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Yes | Your Twilio phone number (E.164) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` | Yes | Base64-encoded service account JSON |
| `GOOGLE_SHEET_ID` | Yes | Google Sheet ID (for Customers + Orders tabs) |
| `DELIVERY_SHEET_ID` | Yes | Google Sheet ID for the delivery date tabs (DLVR M-D) |
| `SENDGRID_API_KEY` | Yes | SendGrid API key |
| `SENDGRID_FROM_EMAIL` | Yes | Verified sender email |
| `WAREHOUSE_EMAIL` | Yes | Comma-separated emails to receive order summaries |
| `SCHEDULER_ENABLED` | No | Set to `true` to enable the cron jobs (default: `false`) |
| `OPENAI_API_KEY` | No | Enables AI order parsing fallback |
| `PRODUCTS` | No | Comma-separated product list (default: `toast,4-inch,long,institutional_sandwich,dinner_rolls`) |
| `ADMIN_PHONE_NUMBER` | No | If set, every SMS exchange is forwarded here for real-time monitoring |
| `TEST_PHONE_NUMBER` | No | If set, the scheduler only texts this number instead of all customers |
| `EMAIL_SIGN_OFF_NAME` | No | Name in the warehouse email sign-off line (default: `Bryant`) |
| `PORT` | No | Server port (default: `3000`) |
| `TZ` | No | Timezone for cron schedules (default: `America/New_York`) |
| `LOG_LEVEL` | No | Winston log level (default: `info`) |

## Error Handling and Logging

- All operations are wrapped in try/catch with structured logging via Winston.
- SMS sends use `Promise.allSettled` so one failure doesn't block others.
- Logs go to both console and `app.log` (rotated at 5 MB, 3 files kept).
- The `/health` endpoint can be used for uptime monitoring.
- Twilio webhook signature validation is enforced in production.
