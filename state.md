# State

## Current Status
System is live and in production.

## Active Spreadsheets
- Main 2026 spreadsheet (`GOOGLE_SHEET_ID`) — Orders tab being written as always
- Delivery tracking spreadsheet (`DELIVERY_SHEET_ID`) — DLVR tabs being written as always
- Route 25252 spreadsheet (`SHEET_ID_25252`) — newly added, writes to "Restaurant_Data" tab
- Route 25248 spreadsheet (`SHEET_ID_25248`) — newly added, writes to "Restaurant_Data" tab

## Recent Changes
- Added support for route-specific spreadsheets (25252 and 25248). When an order comes in for a customer on route 25252 or 25248, the system now also writes to those dedicated sheets in addition to the main spreadsheet. No existing behavior was changed — these are purely additive writes.
- Added three new products: marty (col J), plain_marty (col K), 5-inch (col L). Updated config.ts products list, PRODUCT_ALIASES and AI prompt in orderParser.ts, and ABBREV_TO_PRODUCT in sheets.ts.
- Added marty, plain_marty, and 5-inch to DELIVERY_PRODUCT_ORDER, PRODUCT_HEADERS, and PRODUCT_ABBREVS in deliveryTab.ts so new DLVR tabs include those columns automatically.
- Added CUSTOMER_PRODUCT_OVERRIDES in webhook.ts for hardcoded per-customer product remaps. Dunks's orders: "buns" parses to 4-inch globally, then the override remaps 4-inch → institutional_sandwich for Dunks (who only orders institutional_sandwich and toast). All other customers unaffected. To add similar overrides for other customers, add an entry to CUSTOMER_PRODUCT_OVERRIDES keyed by a lowercase substring of their name.

## Recent Changes (continued)
- Added "burger", "burgers", "hamburger", "hamburger bun", "hamburger buns" as aliases for 4-inch.
- Added bare "top split" as alias for long (in addition to the existing "top split hotdog/roll/bun" variants).
- Added normalization for "4 - inch" (spaces around hyphen) → "4-inch" so customers who type it that way get parsed correctly.
- Added "top split hotdog/hotdogs/hot dog/hot dogs/roll/rolls/bun/buns" and bare "top split" as aliases for long (which then hits customer overrides like Deano's long → top_slice).
- AI now runs as a supplement when the regex parser leaves orphaned number tokens (digits not paired with a product). Regex results take priority; AI only fills in missed products. This prevents partial parses from silently dropping products.
- Manually entered orders in the Orders spreadsheet: leave the emailed column BLANK when entering by hand. If it has a Y, the 11:30 job will skip it. Use /trigger-email to send missed orders.
- Render URL: https://restaurantorder-msop.onrender.com

## Audit findings (2026-10-07) — still open
Severity order. Each was verified by reading the executing code path.
- `markOrdersAsEmailed(dateStr)` flags EVERY un-emailed row for the date, not the rows
  that were actually in the email just sent (`webhook.ts:651`, `scheduler.ts:227`,
  `webhook.ts:753`). A hand-entered order can be stamped `Y` by someone else's
  late-order email and then never sent; `/trigger-email` afterwards reports
  `no_unsent`, so it stays invisible. Fix: pass the emailed rows' keys in.
- Evening admin texts get tomorrow's date (`webhook.ts:403`). The admin bypasses the
  window check but has no Customers row, so the `else` branch uses
  `new Date().toISOString().slice(0,10)` — UTC, i.e. tomorrow after 8 PM ET. The order
  lands on a date no cron job processes. `easternDateStr` already exists in
  `orderingWindow.ts:32`. Same UTC default in `/api/sync-delivery` (`index.ts:39`),
  `/trigger-email` (`webhook.ts:722`) and `findNextOrderDate` (`sheets.ts:594`).
- Corrections after 11:30 never reach the route Restaurant_Data sheets or Daily Totals
  (`sheets.ts:804-878`). `updateTodaysOrder` writes the Orders tab and the delivery tab
  only; the sole re-sync is in `afternoonJob`. Fix: call `updateRestaurantDataRow` and
  `updateDailySummaryTab` after a successful update.
- `/trigger-email?date=` honours the param for which orders to send but calls
  `getDeliveryDate()` with no argument (`webhook.ts:722-723`), so a late run emails the
  right orders under the wrong delivery day.
- Daily Totals drops any route that is not 25252 or 25248 — `SUMMARY_ROUTES` is
  hardcoded (`sheets.ts:589`), while the warehouse email groups by whatever routes
  exist, so the tab can undercount silently.
- Dead: `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` are unused (sending is Resend-only);
  only `config.sendgrid.warehouseEmail` is still read. `architecture.md:11` still names
  SendGrid. `generateSummary` / `generateSummariesByRoute` have no non-test callers.

## Known Issues / In Progress
- `afternoonJob()` reads the Orders tab once at the start, then does one delivery-tab
  write per order before composing the email. With ~8 orders that is a 10-15 second
  window in which a manual Orders-tab edit is made too late to reach the email, even
  though the email has not sent yet. Fix is either to re-read the Orders tab just
  before composing, or to drop the delivery-tab sync (see below).
- The delivery spreadsheet (`DELIVERY_SHEET_ID`, the legacy "Restaurants 2026" file)
  is no longer used by the owner, but every order still writes to it in real time and
  the 11:30 job rewrites all of them. Its `DLVR` tabs have no SLIDER column, so every
  run logs `Product column "SLIDER" not found`. Dropping this sync would remove the
  warnings and close the snapshot window above.
- 4 pre-existing failures in `src/__tests__/orderParser.test.ts` (95 of 99 pass).
  Present before the recent parser changes; they involve the AI-fallback paths.
- `render.yaml` is stale and needs a manual fix. `PRODUCTS` is declared with a managed
  `value:` carrying leftover template data ("chicken,ribs,pulled_pork,brisket,
  coleslaw,beans"). Because product reads are positional, re-applying the blueprint
  would silently shift every product column. It should be changed to `sync: false` so
  the Render dashboard stays the source of truth. The blueprint also omits
  RESEND_API_KEY and RESEND_FROM_EMAIL (both `required()` in config.ts — the app
  throws on boot without them) and SHEET_ID_25252 / SHEET_ID_25248 (absence silently
  disables the Restaurant_Data sync); all four should be added as `sync: false`.
  This does not affect the running service — only a blueprint create or re-sync.

## Recent Changes (continued)
- Morning job now automatically syncs any pre-entered orders (e.g. manually entered called-in orders) to the route-specific Restaurant_Data sheets after the SMS blast runs. So if you enter an order the night before, it will land in the right spreadsheet when the 9:30 AM job fires the next morning.

## Troubleshooting Reminder
If something looks like it should be working but isn't — check Render first. Make sure the latest changes have actually been deployed: confirm that Render is running the correct branch and that the most recent commit is live. Many "mystery" bugs turn out to be Render still running an older version of the code.

## Recent Changes (continued)
- Added `slider` (customer-facing name "12 slice") as a product. Aliases: slider(s),
  12 slice, 12-slice, 12slice, slider bun(s), slider roll(s). Column L on the 25252
  Restaurant_Data sheet, column N on 25248.
- IMPORTANT: `PRODUCTS` in Render must exactly match the Orders tab product columns.
  Reads are positional (`sheets.ts:519-521`), so a mismatch silently shifts every
  product. Current Orders tab layout is E-N: toast, 4-inch, long,
  institutional_sandwich, dinner_rolls, hoagie, top_slice, marty, plain_marty, slider
  (10 columns; Raw Reply in O, Emailed in P). The code default in `config.ts` still
  lists 12 including 5-inch and potato_bread, so clearing the env var would break it.
- Added a "Daily Totals" tab to the main spreadsheet: product totals by route, auto-
  detects the next upcoming order date, uses the same friendly names as the warehouse
  email. Updates on every order plus at 11:30. Manual trigger: `/api/daily-totals`.
  It is derived from the Orders tab — editing it directly gets overwritten.
- Blank/empty inbound SMS is now ignored instead of being treated as a decline.
- Multi-location support: a customer with two locations on one phone number gets two
  Customers rows sharing that number, each with a keyword in new column H ("Prefix").
  Texting "main: 3 toast" routes to the row whose prefix matches, and the prefix is
  stripped before parsing. With no prefix match it falls back to the first row and
  logs a warning. The duplicate-order guard is now name-scoped rather than
  phone-scoped so each location can order independently.
- Parser: "hot dog bun(s)" and "hotdog bun(s)" now map to long (previously "buns"
  matched first and sent them to 4-inch).
- Parser: a bare "tray"/"trays" with no leading count now means 1, so "Tray sliders"
  records 1 instead of being dropped.
- Parser: "add" must now START a message to count as a correction. Previously
  CORRECTION_PREFIX allowed any preamble before its keywords, so "Please add 10 toast"
  matched on "add", went to the correction handler, and — because corrections run
  before orders are recorded — never reached `appendOrder`. The customer got an error
  reply and the restaurant was silently absent from the warehouse email.
  change/update/fix/correct keep their preamble; "Add four 4 in to dad's bbq" is
  unaffected.
- Corrections now distinguish adding from setting. `CorrectionRequest` carries
  `mode: 'set' | 'add'` and `updateTodaysOrder` takes it (defaulting to `'set'`).
  "add 5 toast" on an existing 10 now gives 15; previously it overwrote to 5, cutting
  the order while the confirmation SMS made it look deliberate. This applied to the
  admin form too, so "Add four 4 in to dad's bbq" used to set rather than add.
  "change ... to N" still replaces, exactly as before.

## Last Updated
2026-10-07
