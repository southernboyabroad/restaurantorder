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

## Known Issues / In Progress
- None currently noted

## Recent Changes (continued)
- Morning job now automatically syncs any pre-entered orders (e.g. manually entered called-in orders) to the route-specific Restaurant_Data sheets after the SMS blast runs. So if you enter an order the night before, it will land in the right spreadsheet when the 9:30 AM job fires the next morning.

## Troubleshooting Reminder
If something looks like it should be working but isn't — check Render first. Make sure the latest changes have actually been deployed: confirm that Render is running the correct branch and that the most recent commit is live. Many "mystery" bugs turn out to be Render still running an older version of the code.

## Last Updated
2026-06-10
