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
- Orders texted between 12:30 and 1:00 PM are recorded but never emailed.
  `isLateOrderEmailWindow` (`webhook.ts`) runs 11:30-12:30, but the ordering window
  stays open until 1:00 (`WINDOW_CLOSE_MINUTES`). An order in that half hour reaches
  the Orders tab, Restaurant_Data and the delivery tab, and the customer gets a
  confirmation — but no email goes to the warehouse, the Emailed column stays blank,
  and nothing retries. Fix: extend the late-email window to 1:00 to match, or flag
  orders left recorded-but-un-emailed once the window closes.
- Hand-entered orders only reach the delivery spreadsheet if entered before 11:30.
  Nothing writes to the delivery tab at entry time (no webhook runs); the only sweep is
  `afternoonJob`'s per-order sync at 11:30. Anything typed in after that is absent from
  Restaurants 2026, which the owner uses as the per-date history of what each
  restaurant ordered. `/api/sync-delivery` fixes it manually but must be remembered,
  and it derives the delivery date from today rather than from the order, so it writes
  into the wrong DLVR tab if run on a later day.
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
- Emails now mark only the rows they actually covered. `OrderRow` carries `rowNumber`,
  `appendOrder` returns the row it wrote, and `markOrdersAsEmailed` takes an optional
  list of rows. Previously it stamped every un-emailed row for the date, so a
  hand-entered called-in order could be marked sent by someone else's late-order email
  and never reach the warehouse — `/trigger-email` would then report `no_unsent`.
- All order dates now use `easternDateStr()` (exported from `orderingWindow.ts`)
  instead of `toISOString().slice(0,10)`. The UTC form returns TOMORROW after 8 PM ET,
  so an order texted in during the evening landed on a date no cron job reads. Changed
  in `webhook.ts` (order date, correction fallback, `/trigger-email` default),
  `scheduler.ts` (`todayDateStr`), `sheets.ts` (`findNextOrderDate`) and `index.ts`
  (`/api/sync-delivery`). Cron-time behaviour is unchanged — 9:30-11:30 ET is the same
  calendar day in both.
- `/trigger-email?date=` now derives the delivery day from the date being sent rather
  than from today, so a late run no longer emails the right orders under the wrong day.
- Corrections now sync downstream. `updateTodaysOrder` calls `updateRestaurantDataRow`
  (route taken from the matched row's column D) and `updateDailySummaryTab` after
  writing the Orders tab, matching what `appendOrder` already did. Previously a
  correction reached only the Orders tab and the delivery tab, so the route sheet and
  Daily Totals kept the old number — and since the only re-sync is the 11:30 job,
  anything corrected after that stayed stale permanently. The Restaurant_Data write is
  wrapped in try/catch: the Orders tab is already committed by that point, so a failure
  there must not fail the correction.

## Recent Changes (continued)
- FIXED the Sheets rate limit that was dropping orders. Google allows 60 reads per
  minute per user. Counting the 9:30 job with 18 customers came to exactly 60, which
  is why the fastest responders got a 429, the webhook threw, and their orders were
  never recorded (JNN Oxford and JNN Newnan, 2026-10-14). Three changes:
  - `getSheetIdByTitle` caches tab ids in a module-level map. `logMessage` was issuing
    TWO full `spreadsheets.get` calls per message purely to resolve a tab id; so were
    `getOrdersSheetNumericId` and `updateDailySummaryTab`. Tab ids never change. A miss
    refreshes the whole map, so a tab created later is still picked up.
  - `logMessages(entries[])` batches the write. The blast logged one row at a time at
    three API calls each — 54 calls in the tightest minute. Now three calls total
    regardless of customer count. `logMessage` delegates to it, so single-message
    callers are unchanged.
  - `getCustomers` caches for 60s. It ran on nearly every inbound SMS, sometimes twice,
    while the Customers tab changes about weekly. `invalidateCustomerCache()` is
    exported if an immediate re-read is ever needed.
  Net: that minute went from 60 reads to 6, and no longer grows with the customer list.
- FIXED `appendOrder` overwriting hand-typed rows. `values.append` defaults to
  `insertDataOption: OVERWRITE`, which writes into the cells after the last populated
  row — so an order arriving while someone types into that row lands on top of it. Cost
  JNN Newnan's order on 2026-10-14 (row 912). Now passes `INSERT_ROWS`, which gives the
  append its own row. Applied to the Message Log append too.
  NOTE: the Message Log colour block reads `A2:A` AFTER appending. M values there means
  sheet rows 2..M+1, i.e. 0-based indices 1..M, so the new rows are indices
  `M-k+1`..`M`. Getting this off by one silently colours the wrong rows.

## Recent Changes (continued)
- FIXED the 11:30 job aborting on a single email failure. On 2026-10-23 Resend
  returned a 520 (their outage; recovered minutes later) while sending route 25248.
  `await sendWarehouseEmail(...)` sat bare inside the per-route loop, so the throw
  escaped to the outer catch and killed everything after it: route 25252's email was
  never attempted, no rows were marked emailed, Restaurant_Data never synced and Daily
  Totals never rebuilt. The log said only "Afternoon job failed" and nothing else
  surfaced it.
  - Each route's send is wrapped individually; a failure logs and continues.
  - `markOrdersAsEmailed` now receives only the rows whose email actually went out, so
    a failed route stays un-emailed and `/trigger-email` retries just that route.
    All-decline routes are still marked, as before.
  - The Restaurant_Data and Daily Totals syncs now run regardless of email outcome.
  - A failed route sends an alert SMS to ADMIN_PHONE_NUMBER naming the route and
    pointing at /trigger-email.
  - `sendWarehouseEmail` retries transient failures (5xx, 429, or no status at all)
    with 2s/8s/20s backoff. 4xx is not retried.
- NOTE for anyone debugging a missed 11:30 email: `/trigger-email` is NOT a full
  substitute for the afternoon job. It sends email and marks rows, and does nothing
  else — no delivery tab, no Restaurant_Data, no Daily Totals. The delivery tab sync
  runs BEFORE the emails in afternoonJob, so it survives an email failure; the other
  two run after and do not.

## Recent Changes (continued)
- FIXED a decline row silently swallowing the real order that followed. On
  2026-10-23 Waldo's texted "Please include Michael Lawrence in this chat thread, he
  is my new GM" — no order in it, so the AI classified it as a DECLINE, which wrote
  an all-zero row and replied with the usual confirmation. Their actual order ("4 and
  2") arrived two minutes later, hit the already-ordered guard, and was dropped with
  no reply and no row. Three changes:
  - The already-ordered guard now only fires when the existing row HAS ITEMS. An
    all-zero row is a decline, and a customer who declines then changes their mind
    must be able to order.
  - When a zero row exists, the incoming order OVERWRITES that row rather than
    appending a second one. `updateTodaysOrder` takes an optional rawReply so the row
    stops showing the decline text.
  - The AI prompt now distinguishes "says they are not ordering" from "does not
    mention an order". Staff changes, phone numbers, questions and pleasantries are
    explicitly not declines, and it is told to leave declined false when unsure.
- FIXED duplicate rows for one customer racing each other. Every row for a customer
  targets the SAME Restaurant_Data row and the SAME delivery-tab row, and the 11:30
  sync fired them concurrently (`Promise.allSettled`), so whichever landed last won —
  a zero decline row could overwrite a real order. `mergeOrdersByCustomer()` sums rows
  per customer+route before syncing, matching what the warehouse email already does.
  Applied to `syncOrdersToRestaurantDataSheets` and the delivery-tab loop in
  `afternoonJob`. Daily Totals already summed and was unaffected.
  Duplicate rows arise from a decline followed by an order, a hand-entered row
  alongside a texted one, or two contacts at the same restaurant.

## Recent Changes (continued)
- FIXED a second text being dropped when the customer had already ordered. On
  2026-10-24 Mad Hogg sent "4 toast" then "1 hoagie" seconds apart; the toast was
  recorded and the hoagie was discarded with no reply. The already-ordered guard
  rejected on WHO sent the message rather than on whether it contained an order — it
  exists so "thanks!" and emoji do not re-trigger ordering, but none of those parse
  as orders anyway.
  The decision now happens AFTER parsing. A message carrying real quantities is
  folded into the existing row via `updateTodaysOrder(..., 'add')`, the delivery tab
  is refreshed, and the customer gets the full updated total. Anything without
  quantities is ignored exactly as before.
  Only products NOT already on the row are added. That is deliberate: a customer who
  re-sends the same text because they did not see a reply (there is a 15s delay)
  cannot double a quantity. Raising an existing quantity is what "change toast to 15"
  is for.
  For a product ALREADY on the order the higher of the two numbers wins; a product
  not on the order is added. Owner's rule, and the owner's stated preference is that
  over-ordering is far cheaper than coming up short. Never going down also means an
  anxious re-send cannot double a quantity. Lowering a quantity is what
  "change toast to 15" is for.
  The lookup is keyed on customer NAME, not phone, so a SECOND PERSON at the same
  restaurant is treated as the same order under the same rule — higher wins. That
  replaced the old "Heads up, an order has already been placed" reply, which
  discarded their text. Multi-location customers sharing one phone have distinct
  names, so their locations stay separate.
  When nothing would be raised the customer still gets their current total back
  rather than silence — silence is usually why they re-sent. Other contacts at the
  restaurant are told when the order changes.

## Recent Changes (continued)
- The Orders tab now carries the day's totals. After the 11:30 job, one row per
  route is written beneath that day's orders, separated by a single blank row, so
  the orders, the totals and the warehouse email can be reconciled without leaving
  the tab. Cleared at the start of the next ordering day (9:30) before anything new
  is written. `clearOrdersTabTotalsRows()` / `writeOrdersTabTotalsRows()`.
  CRITICAL INVARIANT: column A (Date) is BLANK on these rows. Every read path finds
  orders by matching column A against the date — getTodaysOrders, markOrdersAsEmailed,
  updateTodaysOrder, the row colouring. A date there would make the totals read as an
  order and silently DOUBLE every figure, in the sheet and in the email. The blank
  date plus the "TOTAL " label in column C is also how the rows are found for
  deletion. Do not put a date in column A of a totals row.
  Routes whose products are all zero (all-decline) are skipped. Both functions are
  wrapped so a failure can never take down the job — this is a convenience, not part
  of the order path.
  SIDE EFFECT: the blank gap row is not deleted with the totals, so one blank row
  accumulates between each ordering day's block. It reads as a day separator and is
  harmless (blank column A means every read skips it).

## Recent Changes (continued)
- Orders now record the Twilio Message SID in column Q of the Orders tab. Twilio
  sends `MessageSid` with every inbound webhook; it was simply not being read.
  Stored so a future reconciliation pass can ask Twilio what it actually received
  and match EXACTLY against the sheet, instead of guessing from message text —
  text matching cannot tell an already-applied correction from a missed order,
  which was the main argument against building that sweep.
  Column Q sits to the RIGHT of Emailed (P), so no product column shifts. appendOrder
  writes Emailed as blank; markOrdersAsEmailed still owns that cell. Rows predating
  this change simply have no Q value and read back as undefined.
  Blank for hand-entered and admin-placed orders, which have no originating text.
  Useful on its own: an order that looks wrong can be traced to the exact message.

## Verified about Twilio (2026-10-26)
Checked before designing the reconciliation sweep.
- Listing message history via the REST API has NO per-request charge. Billing is per
  message sent/received. Only the sweep's own alert/confirmation texts would cost.
- Message bodies for INBOUND messages are readable after the fact — confirmed in the
  console on a live inbound row. Message Body Redaction is NOT enabled. If it ever is,
  Twilio drops inbound bodies after webhook delivery and the sweep has nothing to
  parse. Setting: Messaging -> Settings -> General -> Message Redaction.
- Default retention is 400 days, configurable 7-400.
- Default page size 50, max 1000; bodies are included in the list response.
- IMPORTANT: Twilio's date filters are GMT, not local. Same trap as the UTC order-date
  bug — fetch a wide window and apply the Eastern cutoff in our own code.
- Restricted API keys need `twilio/messaging/messages/list`.

## Recent Changes (continued)
- ADMIN_PHONE_NUMBER now accepts several numbers, comma-separated, e.g.
  `+16785550001,+16785559999`. Added so the owner's girlfriend can cover while he
  travels without him dropping out of the loop.
  - The FIRST number gets every forwarded customer text. One copy only — each
    forward is a billed outbound SMS, and a second recipient would double that.
  - ALL numbers get failure alerts (`alertAdmins()` in sms.ts). Rare, and exactly
    what more than one person should see.
  - ALL numbers count as admin senders (`isAdminPhone()`), so either can send
    corrections and "order for ..." commands, and neither gets bot replies.
  - A single number behaves exactly as before.
  Write numbers WITH the +1 country code: matching works without it, but Twilio may
  refuse to send to a number missing it. Changing the setting in Render restarts the
  service — never during an ordering window.

## Recent Changes (continued)
- FIXED five problems with admin commands, found 2026-10-30 when "For B52s order two
  4-inch and one toast" silently did nothing. Matters most when someone less familiar
  with the formats is covering.
  1. An admin text that is not a recognised command but LOOKS like one (has a digit,
     or order/add/change/update/fix/correct) now gets a reply listing the formats.
     It used to be ignored with no reply. Plain chatter is still ignored silently.
  2. Spelled-out quantities no longer end up in the customer name. "order for B52
     two 4-inch" read the customer as "B52 two" and dropped the quantity. Real number
     words now end the name, except as the first word ("Five Guys" still works). The
     voice-to-text quirks in WORD_NUMBERS ("to", "for", "ate") are excluded since they
     can sit inside a name.
  3. `order for` had NO email step. After 11:30 the order was recorded and never sent.
     It now emails the warehouse straight away if today's batch has already gone (no
     12:30 cutoff — an admin order is deliberate) and marks that one row. Before
     11:30 it waits for the batch as before.
  4. `order for` was refused by ANY existing row, including a zero/decline row. It is
     now refused only by a row with items, and overwrites a decline row instead of
     adding a second one — matching the customer-side fix.
  5. Admin orders were always dated TODAY: the admin is not in the Customers tab, so
     the early-order logic never applied, and an order placed on a non-ordering day
     was filed under a date no scheduled job reads. It now gets the date the customer
     would have got: today during the window or an ordering day's afternoon,
     otherwise that customer's next ordering day.
  The confirmation now names the DELIVERY DAY and says whether it was emailed or will
  go at 11:30, so a misread date or a failed email is visible at once.

## Last Updated
2026-10-19
