# Architecture

## What This System Does
SMS-based order collection for a restaurant/bakery supplier. Customers text their orders, the system parses them and writes to Google Sheets, then emails a warehouse summary at 11:30 AM.

## Tech Stack
- **Runtime:** Node.js + TypeScript
- **Web server:** Express
- **SMS:** Twilio (inbound webhook + outbound SMS)
- **Storage:** Google Sheets (via Google Sheets API)
- **Email:** SendGrid
- **Scheduling:** node-cron
- **Order parsing:** Regex parser (primary) + OpenAI gpt-4o-mini (fallback)

## Order Flow
```
9:30 AM → SMS sent to all customers
Customer replies via text
Twilio POST /sms webhook
  → Look up customer by phone (Customers sheet)
  → Detect intent (order, decline, repeat, correction, etc.)
  → Parse order (regex → OpenAI fallback)
  → Write to: Main Orders sheet + Delivery tab + Route-specific sheet (if applicable)
  → Send confirmation SMS back to customer
10:30 AM / 11:15 AM → Reminder SMS to non-responders
11:30 AM → Aggregate orders by route → Email warehouse
```

## Source Files

| File | Purpose |
|------|---------|
| `src/config.ts` | Environment variable loading, spreadsheet IDs, product list |
| `src/index.ts` | Express server startup + cron scheduler bootstrap |
| `src/services/webhook.ts` | Twilio SMS webhook handler — full order pipeline |
| `src/services/sheets.ts` | All Google Sheets read/write (Customers, Orders, route-specific sheets) |
| `src/services/deliveryTab.ts` | Delivery tracking tab creation and updates |
| `src/services/scheduler.ts` | Cron jobs: morning SMS, reminders, afternoon email |
| `src/services/orderParser.ts` | Regex + OpenAI order parsing, intent detection |
| `src/services/email.ts` | SendGrid warehouse email sending |
| `src/services/orderSummary.ts` | Order aggregation and email formatting |
| `src/services/orderingWindow.ts` | Logic for valid ordering times and delivery date calculation |

## Spreadsheets

| Env Var | Purpose |
|---------|---------|
| `GOOGLE_SHEET_ID` | Main 2026 spreadsheet — "Customers" tab (read) + "Orders" tab (written on every order) |
| `DELIVERY_SHEET_ID` | Delivery tracking — auto-creates `DLVR M-D` tabs per delivery date |
| `SHEET_ID_25252` | Route 25252 dedicated sheet — "Restaurant_Data" tab updated per order |
| `SHEET_ID_25248` | Route 25248 dedicated sheet — "Restaurant_Data" tab updated per order |

Every order writes to ALL applicable spreadsheets simultaneously. The route-specific sheets (25252, 25248) are additive — nothing about the main spreadsheet changed.

## Customers Sheet Columns
A=Name, B=Phone, C=Default Product, D=Route, E=Product Order, F=SMS Days, G=Product Map

## Products (Main Orders Sheet Column Order)
toast, 4-inch, long, institutional_sandwich, dinner_rolls, hoagie, top_slice, marty, plain_marty, 5-inch

## Delivery Tab Product Order
institutional_sandwich, 4-inch, toast, long, dinner_rolls, top_slice, hoagie

## Delivery Date Logic
- Wednesday orders → Thursday delivery
- Friday orders → Saturday delivery
- Saturday orders → Monday delivery

## Ordering Windows
- Active: 9:30 AM – 1:00 PM on scheduled SMS days
- Early orders accepted: after 6 PM on ordering days, or before 9:30 AM on non-ordering days (recorded for next delivery)
