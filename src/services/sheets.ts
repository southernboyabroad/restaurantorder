import { google, sheets_v4 } from 'googleapis';
import { config } from '../config';
import logger from '../logger';

// ── Sheet layout ────────────────────────────────────────────────
// Sheet "Customers"  → columns: Name | Phone | Default Product (optional) | Route (optional) | Product Order (optional)
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
  'hot dog': 'long',
  'hot dogs': 'long',
  'hotdog': 'long',
  'hotdogs': 'long',
  'bun': '4-inch',
  'buns': '4-inch',
  'dinner': 'dinner_rolls',
  'texas toast': 'toast',
};

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
    range: 'Customers!A2:E', // skip header; col C = default product, col D = route, col E = product order
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
  const lower = hint.toLowerCase().trim();

  // Exact match first (case-insensitive)
  const exact = customers.find((c) => c.name.toLowerCase().trim() === lower);
  if (exact) return { customer: exact };

  // Partial match — name contains the hint
  const partial = customers.filter((c) => c.name.toLowerCase().includes(lower));
  if (partial.length === 1) return { customer: partial[0] };
  if (partial.length > 1) {
    // If all matches share the same name (e.g. same restaurant, multiple phone numbers),
    // treat it as a single match — the order row uses the name, not the phone.
    const uniqueNames = new Set(partial.map((c) => c.name.toLowerCase().trim()));
    if (uniqueNames.size === 1) return { customer: partial[0] };
    return { customer: partial[0], ambiguous: partial.map((c) => c.name) };
  }

  // Try the other direction — hint contains the customer name
  const reverse = customers.filter((c) => lower.includes(c.name.toLowerCase().trim()));
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
