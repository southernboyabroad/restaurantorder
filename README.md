# Restaurant Order SMS Automation

Automated SMS-based order collection system for food/bakery suppliers. Sends text messages to customers on a schedule (Wednesday, Friday, Saturday), parses their replies into structured orders in Google Sheets, syncs a delivery tracking tab, and emails a summary to your warehouse.

## How It Works

1. **9:30 AM (Wed/Fri/Sat)** — Reads the customer list from Google Sheets and sends each customer an SMS asking for their order.
2. **Customers reply by text** — Replies arrive via a Twilio webhook, get parsed (regex first, OpenAI fallback), recorded in the "Orders" sheet, and synced to a delivery tracking tab.
3. **10:30 AM & 11:15 AM (same days)** — Reminder SMS sent to any customers who haven't replied yet.
4. **11:30 AM (same days)** — Aggregates orders by route and emails a product-totals summary to the warehouse via SendGrid.

Early orders (after 6 PM the previous evening, or before 9:30 AM on order days) are also accepted and recorded for the next delivery date.

## Project Structure

```
src/
  config.ts              — Environment variable loader with validation
  logger.ts              — Winston logger (console + rotating file)
  index.ts               — Express server + scheduler bootstrap
  services/
    sheets.ts            — Google Sheets: read customers, write/update orders
    sms.ts               — Twilio: send SMS, build route-specific prompt messages
    orderParser.ts       — Regex parser + OpenAI fallback + intent detection
    orderSummary.ts      — Aggregate orders, format text/HTML email bodies
    email.ts             — SendGrid: send warehouse summary
    scheduler.ts         — node-cron jobs (9:30 AM, 10:30 AM, 11:15 AM, 11:30 AM)
    webhook.ts           — Express routes: POST /sms and admin trigger endpoints
    orderingWindow.ts    — Eastern-time ordering window and early-order logic
    deliveryTab.ts       — Auto-create and update delivery tracking spreadsheet tab
  __tests__/
    orderParser.test.ts
    orderSummary.test.ts
    orderingWindow.test.ts
    webhook.test.ts
```

## Prerequisites

- **Node.js 18+**
- **Twilio account** — with a phone number that can send/receive SMS
- **Google Cloud service account** — with Sheets API enabled, access to two spreadsheets
- **SendGrid account** — with a verified sender email
- **OpenAI API key** _(optional)_ — enables AI fallback for ambiguous replies

## Setup

### 1. Clone and install

```bash
git clone <repo-url> && cd restaurantorder
npm install
```

### 2. Google Sheets

#### Orders spreadsheet (`GOOGLE_SHEET_ID`)

Create a Google Sheet with a tab named **"Customers"** with these columns:

| A (Name) | B (Phone)    | C (Default Product) | D (Route) | E (Product Order)      | F (SMS Days) |
|----------|--------------|---------------------|-----------|------------------------|--------------|
| Alice    | +15551111111 | 4-inch              | 25252     | toast,4-inch,long      | 3,5,6        |
| Bob      | +15552222222 | toast               | 25248     | toast,long             | 3,6          |

- **Phone**: E.164 format (`+1XXXXXXXXXX`)
- **Default Product**: used when customer sends a bare number (e.g., "10")
- **Route**: delivery route identifier (used to group orders in emails)
- **Product Order**: comma-separated list defining column order in the Orders sheet
- **SMS Days**: comma-separated day-of-week numbers (0=Sun, 3=Wed, 5=Fri, 6=Sat)

An "Orders" sheet will be created automatically with columns: Date, Phone, Name, Route, [products…], Raw Reply, Emailed.

#### Delivery spreadsheet (`DELIVERY_SHEET_ID`)

Can be the same spreadsheet or a separate one. The app will auto-create a tab named "DLVR M-D" (e.g., "DLVR 3-14") for each delivery date, grouped by route with SUM totals.

#### Service account setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and enable the **Google Sheets API**.
2. Create a **Service Account** and download the JSON key file.
3. Base64-encode the key: `base64 -w0 service-account.json` (Linux) or `base64 -i service-account.json` (macOS).
4. Share **both** spreadsheets with the service account email (ending in `@*.iam.gserviceaccount.com`) with **Editor** access.

### 3. Twilio

1. Sign up at [twilio.com](https://www.twilio.com/) and get a phone number that supports SMS.
2. In the Twilio console, set the **Messaging webhook** for your number to:
   ```
   https://<your-deployed-url>/sms   (HTTP POST)
   ```

### 4. SendGrid

1. Sign up at [sendgrid.com](https://sendgrid.com/).
2. Create an API key with **Mail Send** permission.
3. Verify your sender email (`SENDGRID_FROM_EMAIL`).

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
npm test          # run all tests with coverage
npm run test:watch
npm run lint
```

The test suite covers order parsing (100+ cases), ordering window logic, order summary formatting, and the full webhook flow with all external services mocked.

### Manual end-to-end test

1. Start the server locally (`npm run dev`) with ngrok.
2. Set Twilio webhook to your ngrok URL.
3. Trigger the morning job manually:
   ```bash
   curl http://localhost:3000/api/remind
   ```
4. Reply to the SMS from your phone.
5. Check Google Sheets — you should see a new row in the "Orders" tab and an updated delivery tab.
6. Trigger the afternoon email:
   ```bash
   curl "http://localhost:3000/trigger-email"
   ```

### Order parsing formats

The strict regex parser handles:
- `toast 10, long 5`
- `10 toast, 5 long`
- `toast: 10, long: 5`
- Mixed: `I need 10 toast and long 5`
- Word numbers: `five toast`
- Positional (customer with `productOrder` set): `10 5 20`
- Single number: recorded against customer's `defaultProduct`
- Synonyms: "hot dog" → long, "bun" / "buns" → 4-inch, "sandwich" → institutional_sandwich

Anything the regex can't confidently parse is forwarded to OpenAI (if configured). The customer receives a note if AI parsing was used.

**Intent keywords** are also recognized:
- Affirmative ("yes", "okay", "sure") — confirms previous order
- Decline ("no order", "skip", "closed") — records zero order
- Repeat ("same as last time", "the usual") — copies previous order
- Called-in ("called it in") — records note

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service status |
| GET | `/health` | Health check (JSON) |
| POST | `/sms` | Twilio webhook for incoming SMS |
| GET | `/api/remind` | Manually trigger the morning SMS job |
| GET | `/api/sync-delivery` | Sync today's Orders sheet to delivery tab |
| GET | `/trigger-email` | Send un-emailed orders (`?date=YYYY-MM-DD`) |
| GET | `/trigger-morning-text` | Preview SMS (`?route=X&day=Y`, test mode only) |

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
| `GOOGLE_SHEET_ID` | Yes | Spreadsheet ID for Customers + Orders sheets |
| `DELIVERY_SHEET_ID` | Yes | Spreadsheet ID for delivery tracking tabs |
| `SENDGRID_API_KEY` | Yes | SendGrid API key |
| `SENDGRID_FROM_EMAIL` | Yes | Verified sender email |
| `WAREHOUSE_EMAIL` | Yes | Comma-separated recipient emails for order summaries |
| `OPENAI_API_KEY` | No | Enables AI order parsing fallback (gpt-4o-mini) |
| `PRODUCTS` | No | Comma-separated product list (default: `toast,4-inch,long,institutional_sandwich,dinner_rolls`) |
| `PORT` | No | Server port (default: `3000`) |
| `TZ` | No | Timezone (default: `America/New_York`) |
| `LOG_LEVEL` | No | Winston log level (default: `info`) |
| `SCHEDULER_ENABLED` | No | Enable cron jobs (default: `false`; set `true` in production) |
| `ADMIN_PHONE_NUMBER` | No | Phone number to receive copies of all SMS exchanges |
| `TEST_PHONE_NUMBER` | No | When set, SMS blasts go only to this number (test mode) |
| `EMAIL_SIGN_OFF_NAME` | No | Name used in email sign-off (default: `Bryant`) |
| `TWILIO_VALIDATE_WEBHOOK` | No | Enforce Twilio signature validation (default: `false`) |

## Error Handling and Logging

- All operations are wrapped in try/catch with structured logging via Winston.
- SMS blasts use `Promise.allSettled` so one failure doesn't block others.
- Logs go to both console and `app.log` (rotated at 5 MB, 3 files kept).
- The `/health` endpoint returns `{ status, schedulerEnabled, timestamp }` for uptime monitoring.
- Admin phone forwarding and delivery tab sync are non-fatal — failures are logged but don't affect order recording.
