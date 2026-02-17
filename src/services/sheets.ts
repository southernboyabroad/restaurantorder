import { google, sheets_v4 } from 'googleapis';
import { config } from '../config';
import logger from '../logger';

// ── Sheet layout ────────────────────────────────────────────────
// Sheet "Customers"  → columns: Name | Phone | Default Product (optional) | Route (optional) | Product Order (optional)
// Sheet "Orders"     → columns: Date | Phone | Name | Route | product1 | product2 | … | Raw Reply
// ────────────────────────────────────────────────────────────────

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
      defaultProduct: row[2]?.trim().toLowerCase() || undefined,
      route: row[3]?.trim() || undefined,
      productOrder: row[4]
        ? row[4].split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
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

// ── Normalize a phone string to E.164 (+1XXXXXXXXXX) ────────────

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw.startsWith('+') ? raw : `+${raw}`;
}

// ── Look up a customer by phone ─────────────────────────────────

export async function findCustomerByPhone(phone: string): Promise<Customer | undefined> {
  const normalized = normalizePhone(phone);
  const customers = await getCustomers();
  return customers.find((c) => normalizePhone(c.phone) === normalized);
}
