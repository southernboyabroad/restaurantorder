import { google, sheets_v4 } from 'googleapis';
import { config } from '../config';
import logger from '../logger';

// ── Sheet layout ────────────────────────────────────────────────
// Sheet "Customers"  → columns: Name | Phone | Default Product (optional) | Route (optional) | Product Order (optional) | SMS Days (optional) | Product Map (optional)
// Sheet "Orders"     → columns: Date | Phone | Name | Route | product1 | product2 | … | Raw Reply
// ────────────────────────────────────────────────────────────────

// ── Abbreviation → canonical product name mapping ───────────────
// Customers often type abbreviations in columns C (defaultProduct)
// and E (productOrder). This map resolves them to canonical names
// that match config.products entries.
const ABBREV_TO_PRODUCT: Record<string, string> = {
  // Full canonical names
  'toast': 'toast',
  '4-inch': '4-inch',
  'long': 'long',
  'institutional_sandwich': 'institutional_sandwich',
  'dinner_rolls': 'dinner_rolls',
  // Common abbreviations (matching PRODUCT_ABBREVS in deliveryTab.ts)
  't': 'toast',
  '4in': '4-inch',
  '4 in': '4-inch',
  '4 inch': '4-inch',
  'h': 'long',
  's': 'institutional_sandwich',
  'd': 'dinner_rolls',
  // Friendly names
  'sandwich': 'institutional_sandwich',
  'sandwiches': 'institutional_sandwich',
  'sand roll': 'institutional_sandwich',
  'sand rolls': 'institutional_sandwich',
  'hot dog': 'long',
  'hot dogs': 'long',
  'hotdog': 'long',
  'hotdogs': 'long',
  'bun': '4-inch',
  'buns': '4-inch',
  'dinner': 'dinner_rolls',
  'hoagie': 'hoagie',
  'hoagies': 'hoagie',
  'sub': 'hoagie',
  'subs': 'hoagie',
  'sub roll': 'hoagie',
  'sub rolls': 'hoagie',
  'sausage roll': 'hoagie',
  'sausage rolls': 'hoagie',
  'top_slice': 'top_slice',
  'top slice': 'top_slice',
  'top slices': 'top_slice',
  'texas toast': 'toast',
  'marty': 'marty',
  'plain_marty': 'plain_marty',
  'plain marty': 'plain_marty',
  'marty no seeds': 'plain_marty',
  'marty no seed': 'plain_marty',
  '5-inch': '5-inch',
  '5 inch': '5-inch',
  '5in': '5-inch',
  '5-in': '5-inch',
  'potato_bread': 'potato_bread',
  'potato bread': 'potato_bread',
  'potato': 'potato_bread',
  'regular bread': 'potato_bread',
  'regular sandwich bread': 'potato_bread',
  'sandwich bread': 'potato_bread',
  'slice bread': 'potato_bread',
  'sliced bread': 'potato_bread',
};

// ── Message Log ─────────────────────────────────────────────────
// Appends one row to the "Message Log" tab in the main spreadsheet.
// Columns: Date | Time | Customer | Phone | Direction | Message
// Auto-creates the sheet with a header row if it doesn't exist yet.

export async function logMessage(
  direction: 'IN' | 'OUT',
  customerName: string,
  customerPhone: string,
  message: string,
): Promise<void> {
  try {
    const sheets = getClient();
    const now = new Date();
    const date = now.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    const time = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

    // Ensure the sheet exists
    const meta = await sheets.spreadsheets.get({ spreadsheetId: config.google.sheetId });
    const exists = (meta.data.sheets || []).some((s) => s.properties?.title === 'Message Log');
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.google.sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: 'Message Log' } } }],
        },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.google.sheetId,
        range: 'Message Log!A1:F1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Date', 'Time', 'Customer', 'Phone', 'Direction', 'Message']] },
      });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: config.google.sheetId,
      range: 'Message Log!A:A',
      valueInputOption: 'RAW',
      requestBody: { values: [[date, time, customerName, customerPhone, direction, message]] },
    });

    // Apply alternating row color by date
    const logMeta = await sheets.spreadsheets.get({ spreadsheetId: config.google.sheetId });
    const logSheet = (logMeta.data.sheets || []).find((s) => s.properties?.title === 'Message Log');
    const logSheetId = logSheet?.properties?.sheetId ?? null;
    if (logSheetId !== null) {
      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: config.google.sheetId,
        range: 'Message Log!A2:A',
      });
      const rows = existing.data.values || [];
      const priorDates = new Set(
        rows.map((r: string[]) => r[0]).filter((d: string) => d && d !== date)
      );
      const colorIndex = priorDates.size % 2;
      const newRowIndex = rows.length;
      const color = ORDER_ROW_COLORS[colorIndex];
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.google.sheetId,
        requestBody: {
          requests: [{
            repeatCell: {
              range: { sheetId: logSheetId, startRowIndex: newRowIndex, endRowIndex: newRowIndex + 1 },
              cell: { userEnteredFormat: { backgroundColor: color } },
              fields: 'userEnteredFormat.backgroundColor',
            },
          }],
        },
      });
    }
  } catch (err) {
    logger.warn('Failed to write to Message Log', { error: err });
  }
}

function resolveProductName(raw: string): string {
  const key = raw.trim().toLowerCase();
  return ABBREV_TO_PRODUCT[key] || key;
}

export interface Customer {
  name: string;
  phone: string; // E.164 format, e.g. +15551234567
  defaultProduct?: string; // canonical product name, e.g. "4-inch"
  route?: string; // delivery route number, e.g. "25252"
  productOrder?: string[]; // positional product mapping, e.g. ["toast", "4-inch"]
  smsDays?: number[]; // days-of-week to send SMS (JS convention: 0=Sun … 6=Sat). If omitted, uses the route's default schedule.
  productMap?: Record<string, string>; // per-customer product remapping, e.g. { long: "top_slice" }
}

export interface OrderRow {
  date: string;
  phone: string;
  name: string;
  route: string; // delivery route number
  quantities: Record<string, number>; // product → qty
  rawReply: string;
  emailed: boolean; // true if this order was already included in a warehouse email
}

let sheetsClient: sheets_v4.Sheets | null = null;

function getClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;

  const keyJson = Buffer.from(config.google.serviceAccountKeyBase64, 'base64').toString('utf-8');
  const key = JSON.parse(keyJson);

  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

// ── Expose the authenticated client for other services ──────────

export function getSheetsClient(): sheets_v4.Sheets {
  return getClient();
}

// ── Read customers ──────────────────────────────────────────────

export async function getCustomers(): Promise<Customer[]> {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: 'Customers!A2:G', // skip header; col C = default product, col D = route, col E = product order, col F = SMS days, col G = product map
  });

  const rows = res.data.values || [];
  const customers: Customer[] = rows
    .filter((row) => row[0] && row[1])
    .map((row) => ({
      name: row[0].trim(),
      phone: row[1].trim(),
      defaultProduct: row[2]
        ? resolveProductName(row[2])
        : undefined,
      route: row[3]?.trim() || undefined,
      productOrder: row[4]
        ? row[4].split(',').map((s: string) => resolveProductName(s)).filter(Boolean)
        : undefined,
      smsDays: row[5]
        ? row[5].split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n))
        : undefined,
      productMap: row[6]
        ? Object.fromEntries(
            row[6].split(',')
              .map((s: string) => s.trim())
              .filter(Boolean)
              .map((pair: string) => pair.split(':').map((p: string) => p.trim().toLowerCase()))
              .filter((parts: string[]) => parts.length === 2),
          )
        : undefined,
    }));

  logger.info(`Loaded ${customers.length} customers from Sheets`);
  return customers;
}

// ── Ensure Orders sheet has the right headers ───────────────────

export async function ensureOrdersSheet(): Promise<void> {
  const sheets = getClient();
  const headers = ['Date', 'Phone', 'Name', 'Route', ...config.products, 'Raw Reply', 'Emailed'];

  // Check if sheet exists — try to read A1
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: 'Orders!A1',
    });
  } catch {
    // Sheet does not exist — create it
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.google.sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: 'Orders' } } }],
      },
    });
    logger.info('Created "Orders" sheet');
  }

  // Write headers
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.google.sheetId,
    range: 'Orders!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
}

// ── Append an order row ─────────────────────────────────────────

// ── Column layout expected by the Restaurant_Data tab ────────────────────────
// Columns always start at C. Each route may have a different number of product
// columns depending on what has been set up in that spreadsheet.

// Route 25252: C = SANDWICH | D = 4IN | E = TOAST | F = HOT DOGS | G = DINNER | H = TOP SLICE | I = HOAGIE
const RESTAURANT_DATA_COLUMNS_25252 = [
  'institutional_sandwich', // C
  '4-inch',                 // D
  'toast',                  // E
  'long',                   // F
  'dinner_rolls',           // G
  'top_slice',              // H
  'hoagie',                 // I
];

// Route 25248: same as 25252 plus the three new products in J, K, L, and potato_bread in M
const RESTAURANT_DATA_COLUMNS_25248 = [
  'institutional_sandwich', // C
  '4-inch',                 // D
  'toast',                  // E
  'long',                   // F
  'dinner_rolls',           // G
  'top_slice',              // H
  'hoagie',                 // I
  'marty',                  // J
  'plain_marty',            // K
  '5-inch',                 // L
  'potato_bread',           // M
];

// Routes that have a dedicated Restaurant_Data sheet
const RESTAURANT_DATA_SHEETS: Record<string, { sheetId: string; columns: string[] } | undefined> = {
  '25252': config.google.sheetId25252 ? { sheetId: config.google.sheetId25252, columns: RESTAURANT_DATA_COLUMNS_25252 } : undefined,
  '25248': config.google.sheetId25248 ? { sheetId: config.google.sheetId25248, columns: RESTAURANT_DATA_COLUMNS_25248 } : undefined,
};

// ── Find the row in Restaurant_Data whose column A matches the customer name,
// then update column B (date) and columns C–I (quantities) in place.
// Name matching is case-insensitive and apostrophe-insensitive so that
// e.g. "WALDO'S RESTAURANT" matches a row labelled "WALDOS".

export async function syncOrdersToRestaurantDataSheets(dateStr: string): Promise<void> {
  const orders = await getTodaysOrders(dateStr);
  const routeOrders = orders.filter((o) => RESTAURANT_DATA_SHEETS[o.route]);

  if (routeOrders.length === 0) {
    logger.info('syncOrdersToRestaurantDataSheets: no orders found for route-specific sheets');
    return;
  }

  logger.info(`syncOrdersToRestaurantDataSheets: syncing ${routeOrders.length} order(s) to Restaurant_Data sheets`);

  const results = await Promise.allSettled(
    routeOrders.map((order) => {
      const sheet = RESTAURANT_DATA_SHEETS[order.route]!;
      return updateRestaurantDataRow(sheet.sheetId, sheet.columns, order.name, order.date, order.quantities);
    }),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  logger.info(`syncOrdersToRestaurantDataSheets complete: ${succeeded} synced, ${failed} failed`);
}

async function updateRestaurantDataRow(
  sheetId: string,
  columns: string[],
  customerName: string,
  date: string,
  quantities: Record<string, number>,
): Promise<void> {
  const sheets = getClient();
  const norm = (s: string) => s.toLowerCase().trim().replace(/[''']/g, '');
  const target = norm(customerName);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Restaurant_Data!A:A',
  });

  const rows = res.data.values || [];
  let rowNumber = -1;

  // Exact match (after normalisation)
  for (let i = 0; i < rows.length; i++) {
    if (norm(rows[i][0] || '') === target) { rowNumber = i + 1; break; }
  }

  // Fallback: row label is contained in the customer name, or vice-versa
  if (rowNumber === -1) {
    for (let i = 0; i < rows.length; i++) {
      const label = norm(rows[i][0] || '');
      if (label && (target.includes(label) || label.includes(target))) {
        rowNumber = i + 1; break;
      }
    }
  }

  if (rowNumber === -1) {
    logger.warn(`Restaurant_Data: no row found for "${customerName}" on sheet ${sheetId} — skipping`);
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `Restaurant_Data!B${rowNumber}`, values: [[date]] },
        {
          range: `Restaurant_Data!C${rowNumber}:${columnLetter(2 + columns.length - 1)}${rowNumber}`,
          values: [columns.map((p) => quantities[p] || '')],
        },
      ],
    },
  });

  logger.info(`Restaurant_Data row ${rowNumber} updated for "${customerName}" on sheet ${sheetId}`);
}


// Two alternating row colors for the Orders sheet (soft blue / soft green)
const ORDER_ROW_COLORS = [
  { red: 0.80, green: 0.90, blue: 1.00 }, // light blue
  { red: 0.82, green: 0.96, blue: 0.82 }, // light green
];

async function getOrdersSheetNumericId(sheets: sheets_v4.Sheets): Promise<number | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.google.sheetId });
  const sheet = (meta.data.sheets || []).find((s) => s.properties?.title === 'Orders');
  return sheet?.properties?.sheetId ?? null;
}

async function applyOrderRowColors(
  sheets: sheets_v4.Sheets,
  numericSheetId: number,
  rowIndices: number[],
  colorIndex: number,
): Promise<void> {
  const color = ORDER_ROW_COLORS[colorIndex];
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.google.sheetId,
    requestBody: {
      requests: rowIndices.map((rowIndex) => ({
        repeatCell: {
          range: {
            sheetId: numericSheetId,
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
          },
          cell: { userEnteredFormat: { backgroundColor: color } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      })),
    },
  });
}

export async function appendOrder(order: OrderRow): Promise<void> {
  const sheets = getClient();
  const row = [
    order.date,
    order.phone,
    order.name,
    order.route,
    ...config.products.map((p) => order.quantities[p] ?? 0),
    order.rawReply,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.google.sheetId,
    range: 'Orders!A:A',
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });

  // Apply alternating row color — all rows for the same date get the same color,
  // switching to the other color each new date.
  // Also backfills any manually pre-entered rows for today that are still white.
  try {
    const numericSheetId = await getOrdersSheetNumericId(sheets);
    if (numericSheetId !== null) {
      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: config.google.sheetId,
        range: 'Orders!A2:A',
      });
      const rows = existing.data.values || [];
      // Count distinct dates that appeared BEFORE today's date — that determines parity.
      const priorDates = new Set(
        rows.map((r: string[]) => r[0]).filter((d: string) => d && d !== order.date)
      );
      const colorIndex = priorDates.size % 2;
      // Color all rows for today's date (including any manually pre-entered ones).
      // rows[] covers A2:A, so row i in the array is sheet row index i+1 (0-based).
      const todayIndices = rows
        .map((r: string[], i: number) => (r[0] === order.date ? i + 1 : -1))
        .filter((i: number) => i !== -1);
      if (todayIndices.length > 0) {
        await applyOrderRowColors(sheets, numericSheetId, todayIndices, colorIndex);
      }
    }
  } catch (colorErr) {
    logger.warn('Failed to apply row color to Orders sheet', { error: colorErr });
  }

  // If this route has a dedicated Restaurant_Data sheet, find the matching
  // row by name and update quantities in place (never append).
  const restaurantSheet = RESTAURANT_DATA_SHEETS[order.route];
  if (restaurantSheet) {
    await updateRestaurantDataRow(restaurantSheet.sheetId, restaurantSheet.columns, order.name, order.date, order.quantities);
  }

  logger.info(`Order recorded for ${order.name} (${order.phone})`);
}

// ── Read today's orders ─────────────────────────────────────────

export async function getTodaysOrders(dateStr: string): Promise<OrderRow[]> {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: 'Orders!A2:ZZ',
  });

  const rows = res.data.values || [];
  const orders: OrderRow[] = [];
  const emailedCol = 4 + config.products.length + 1; // after Raw Reply

  for (const row of rows) {
    if (row[0] !== dateStr) continue;
    const quantities: Record<string, number> = {};
    config.products.forEach((p, i) => {
      quantities[p] = parseInt(row[4 + i] || '0', 10) || 0;
    });
    orders.push({
      date: row[0],
      phone: row[1],
      name: row[2],
      route: row[3] || '',
      quantities,
      rawReply: row[4 + config.products.length] || '',
      emailed: (row[emailedCol] || '').toUpperCase() === 'Y',
    });
  }

  logger.info(`Found ${orders.length} orders for ${dateStr}`);
  return orders;
}

// ── Check if today's batch email has already been sent ─────────

export async function hasBatchBeenSent(dateStr: string): Promise<boolean> {
  const orders = await getTodaysOrders(dateStr);
  return orders.some((o) => o.emailed);
}

// ── Mark all of today's un-emailed orders as emailed ──────────

export async function markOrdersAsEmailed(dateStr: string): Promise<void> {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: 'Orders!A2:ZZ',
  });

  const rows = res.data.values || [];
  const emailedCol = 4 + config.products.length + 1; // 0-indexed within row
  const emailedColLetter = columnLetter(emailedCol); // spreadsheet column letter

  const updates: { range: string; values: string[][] }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] !== dateStr) continue;
    if ((row[emailedCol] || '').toUpperCase() === 'Y') continue; // already marked
    const sheetRow = i + 2; // +2 because row 1 is headers, and i is 0-indexed
    updates.push({
      range: `Orders!${emailedColLetter}${sheetRow}`,
      values: [['Y']],
    });
  }

  if (updates.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.google.sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates,
    },
  });

  logger.info(`Marked ${updates.length} orders as emailed for ${dateStr}`);
}

// Convert 0-based column index to spreadsheet letter (0=A, 1=B, …, 25=Z, 26=AA)
function columnLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

// ── Get the most recent order for a customer (by phone) ─────────

export async function getLastOrderForCustomer(phone: string): Promise<OrderRow | null> {
  const normalized = normalizePhone(phone);
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: 'Orders!A2:ZZ',
  });

  const rows = res.data.values || [];
  let lastOrder: OrderRow | null = null;

  for (const row of rows) {
    if (normalizePhone(row[1] || '') !== normalized) continue;
    const quantities: Record<string, number> = {};
    let hasItems = false;
    config.products.forEach((p, i) => {
      const qty = parseInt(row[4 + i] || '0', 10) || 0;
      quantities[p] = qty;
      if (qty > 0) hasItems = true;
    });
    if (!hasItems) continue;
    const emailedCol = 4 + config.products.length + 1;
    lastOrder = {
      date: row[0],
      phone: row[1],
      name: row[2],
      route: row[3] || '',
      quantities,
      rawReply: row[4 + config.products.length] || '',
      emailed: (row[emailedCol] || '').toUpperCase() === 'Y',
    };
  }

  if (lastOrder) {
    logger.info('Found last order for customer', { phone: normalized, date: lastOrder.date, quantities: lastOrder.quantities });
  } else {
    logger.info('No previous order found for customer', { phone: normalized });
  }

  return lastOrder;
}

// ── Normalize a phone string to E.164 (+1XXXXXXXXXX) ────────────

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw.startsWith('+') ? raw : `+${raw}`;
}

// ── Find other contacts for the same restaurant ─────────────────
// Returns all Customer records with the same name but a different phone number.
// Used to notify other contacts when one person places an order.

export async function getOtherContactsForCustomer(name: string, excludePhone: string): Promise<Customer[]> {
  const customers = await getCustomers();
  const normalizedExclude = normalizePhone(excludePhone);
  return customers.filter(
    (c) =>
      c.name.toLowerCase().trim() === name.toLowerCase().trim() &&
      normalizePhone(c.phone) !== normalizedExclude,
  );
}

// ── Look up a customer by phone ─────────────────────────────────

export async function findCustomerByPhone(phone: string): Promise<Customer | undefined> {
  const normalized = normalizePhone(phone);
  const customers = await getCustomers();
  return customers.find((c) => normalizePhone(c.phone) === normalized);
}

// ── Look up a customer by partial name ──────────────────────────
// Used for admin corrections like "change Waldo's toast to 15" where
// "Waldo" is a partial match against "WALDO'S RESTAURANT" in the sheet.

export async function findCustomerByNameHint(hint: string): Promise<{ customer: Customer; ambiguous?: string[] } | null> {
  const customers = await getCustomers();
  // Strip apostrophes so "Dad's BBQ" matches "Dads BBQ" and vice-versa
  const norm = (s: string) => s.toLowerCase().trim().replace(/[''']/g, '');
  const lower = norm(hint);

  // Exact match first (case-insensitive, apostrophe-insensitive)
  const exact = customers.find((c) => norm(c.name) === lower);
  if (exact) return { customer: exact };

  // Partial match — name contains the hint
  const partial = customers.filter((c) => norm(c.name).includes(lower));
  if (partial.length === 1) return { customer: partial[0] };
  if (partial.length > 1) {
    // If all matches share the same name (e.g. same restaurant, multiple phone numbers),
    // treat it as a single match — the order row uses the name, not the phone.
    const uniqueNames = new Set(partial.map((c) => norm(c.name)));
    if (uniqueNames.size === 1) return { customer: partial[0] };
    return { customer: partial[0], ambiguous: partial.map((c) => c.name) };
  }

  // Try the other direction — hint contains the customer name
  const reverse = customers.filter((c) => lower.includes(norm(c.name)));
  if (reverse.length === 1) return { customer: reverse[0] };

  return null;
}

// ── Update an existing order row in place ────────────────────────
// Finds the most recent order for the given customer name + date,
// merges in new quantities, and resets the emailed flag.

export interface UpdateResult {
  found: boolean;
  wasEmailed: boolean;
  mergedQuantities: Record<string, number>;
  previousQuantities: Record<string, number>;
}

export async function updateTodaysOrder(
  customerName: string,
  dateStr: string,
  newQuantities: Record<string, number>,
): Promise<UpdateResult> {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: 'Orders!A2:ZZ',
  });

  const rows = res.data.values || [];
  const emailedCol = 4 + config.products.length + 1; // after Raw Reply

  // Find the last matching row for this customer today
  let matchRowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (
      rows[i][0] === dateStr &&
      rows[i][2]?.toString().toLowerCase().trim() === customerName.toLowerCase().trim()
    ) {
      matchRowIndex = i;
    }
  }

  if (matchRowIndex === -1) {
    return { found: false, wasEmailed: false, mergedQuantities: {}, previousQuantities: {} };
  }

  const row = rows[matchRowIndex];
  const previousQuantities: Record<string, number> = {};
  config.products.forEach((p, i) => {
    previousQuantities[p] = parseInt(row[4 + i] || '0', 10) || 0;
  });
  const wasEmailed = (row[emailedCol] || '').toUpperCase() === 'Y';

  // Merge: keep existing quantities, override with the new ones
  const mergedQuantities: Record<string, number> = { ...previousQuantities };
  for (const [product, qty] of Object.entries(newQuantities)) {
    mergedQuantities[product] = qty;
  }

  // Build cell updates
  const sheetRow = matchRowIndex + 2; // +2: row 1 = header, i is 0-indexed
  const updates: { range: string; values: (string | number)[][] }[] = [];

  for (let i = 0; i < config.products.length; i++) {
    const col = columnLetter(4 + i);
    updates.push({
      range: `Orders!${col}${sheetRow}`,
      values: [[mergedQuantities[config.products[i]] || 0]],
    });
  }

  // Reset the emailed flag so the 11:30 job will re-send with corrected numbers
  updates.push({
    range: `Orders!${columnLetter(emailedCol)}${sheetRow}`,
    values: [['']],
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.google.sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates,
    },
  });

  logger.info(`Updated order for ${customerName} on ${dateStr}`, {
    previousQuantities,
    mergedQuantities,
  });

  return { found: true, wasEmailed, mergedQuantities, previousQuantities };
}
