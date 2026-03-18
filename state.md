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

## Known Issues / In Progress
- None currently noted

## Troubleshooting Reminder
If something looks like it should be working but isn't — check Render first. Make sure the latest changes have actually been deployed: confirm that Render is running the correct branch and that the most recent commit is live. Many "mystery" bugs turn out to be Render still running an older version of the code.

## Last Updated
2026-03-18
