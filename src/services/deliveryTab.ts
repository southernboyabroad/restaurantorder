import { sheets_v4 } from 'googleapis';
import { config } from '../config';
import { getSheetsClient, getCustomers, Customer } from './sheets';
import logger from '../logger';

// ── Product display names for tab column headers ─────────────────
const PRODUCT_HEADERS: Record<string, string> = {
  toast: 'TOAST',
  '4-inch': '4IN',
  long: 'HOT DOGS',
  institutional_sandwich: 'SANDWICH',
  dinner_rolls: 'DINNER',
};

// Column order for the delivery tab (matches the old spreadsheet layout).
// This is independent of config.products so the delivery tab can have its
// own preferred column order: SANDWICH first, then 4in, TOAST, HOT DOGS, DINNER.
const DELIVERY_PRODUCT_ORDER = [
  'institutional_sandwich',
  '4-inch',
  'toast',
  'long',
  'dinner_rolls',
];

// Short abbreviations shown in column B (customer default product)
const PRODUCT_ABBREVS: Record<string, string> = {
  toast: 'T',
  '4-inch': '4in',
  long: 'H',
  institutional_sandwich: 'S',
  dinner_rolls: 'D',
};

// ── Delivery date calculation ────────────────────────────────────
// Wed orders → Thu delivery, Fri → Sat, Sat → Mon

export function getDeliveryDate(orderDate: Date = new Date()): Date {
  const day = orderDate.getDay(); // 0=Sun … 6=Sat
  const delivery = new Date(orderDate);

  switch (day) {
    case 3: // Wednesday → Thursday
      delivery.setDate(delivery.getDate() + 1);
      break;
    case 5: // Friday → Saturday
      delivery.setDate(delivery.getDate() + 1);
      break;
    case 6: // Saturday → Monday
      delivery.setDate(delivery.getDate() + 2);
      break;
    default:
      // Non-ordering day — default to next day
      delivery.setDate(delivery.getDate() + 1);
      break;
  }

  return delivery;
}

export function getDeliveryTabName(deliveryDate: Date): string {
  const month = deliveryDate.getMonth() + 1;
  const day = deliveryDate.getDate();
  return `DLVR ${month}-${day}`;
}

// ── Helpers ──────────────────────────────────────────────────────

async function getSheetIdByName(
  sheets: sheets_v4.Sheets,
  tabName: string,
): Promise<number | null> {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: config.google.deliverySheetId,
    fields: 'sheets.properties',
  });
  const sheet = spreadsheet.data.sheets?.find(
    (s) => s.properties?.title === tabName,
  );
  return sheet?.properties?.sheetId ?? null;
}

function colLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function getDefaultAbbrev(defaultProduct?: string): string {
  if (!defaultProduct) return '';
  return defaultProduct
    .split(',')
    .map((p) => PRODUCT_ABBREVS[p.trim().toLowerCase()] || p.trim())
    .join(',');
}

// Deduplicate customers so each unique name appears only once.
// When a restaurant has multiple phone contacts, keep the first entry's
// route and defaultProduct (they should be the same across contacts).
function deduplicateCustomers(customers: Customer[]): Customer[] {
  const seen = new Map<string, Customer>();
  for (const c of customers) {
    const key = c.name.toUpperCase().trim();
    if (!seen.has(key)) {
      seen.set(key, c);
    }
  }
  return Array.from(seen.values());
}

function groupByRoute(customers: Customer[]): Map<string, Customer[]> {
  const map = new Map<string, Customer[]>();
  for (const c of customers) {
    const route = c.route || '';
    if (!map.has(route)) map.set(route, []);
    map.get(route)!.push(c);
  }
  return map;
}

// ── Create / ensure delivery tab exists ──────────────────────────

export async function ensureDeliveryTab(deliveryDate?: Date): Promise<void> {
  const date = deliveryDate || getDeliveryDate();
  const tabName = getDeliveryTabName(date);
  const sheets = getSheetsClient();

  // Check if tab already exists
  const existingId = await getSheetIdByName(sheets, tabName);
  if (existingId !== null) {
    logger.info(`Delivery tab "${tabName}" already exists`);
    return;
  }

  logger.info(`Creating delivery tab "${tabName}"`);

  // Create the sheet
  const addResult = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.google.deliverySheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabName } } }],
    },
  });

  const newSheetId =
    addResult.data.replies?.[0]?.addSheet?.properties?.sheetId;

  // Fetch customers, deduplicate (one row per unique name), group by route
  const allCustomers = await getCustomers();
  const uniqueCustomers = deduplicateCustomers(allCustomers);
  const routeGroups = groupByRoute(uniqueCustomers);
  const products = DELIVERY_PRODUCT_ORDER.filter((p) => config.products.includes(p));

  // Build tab data row by row
  const headerRow = ['', '', ...products.map((p) => PRODUCT_HEADERS[p] || p.toUpperCase())];
  const rows: (string | number)[][] = [headerRow, []]; // header + blank row

  let currentRow = 3; // 1-indexed: row 1 = header, row 2 = blank

  for (const [route, members] of routeGroups) {
    const routeLabel = route || 'Unassigned';

    // Route header row
    rows.push([`Route ${routeLabel}`, '', ...products.map(() => '')]);
    currentRow++;

    // Blank row after route header
    rows.push([]);
    currentRow++;

    const firstCustomerRow = currentRow;

    for (const customer of members) {
      const abbrev = getDefaultAbbrev(customer.defaultProduct);
      rows.push([customer.name.toUpperCase(), abbrev, ...products.map(() => '')]);
      currentRow++;
    }

    const lastCustomerRow = currentRow - 1;

    // TOTAL row with SUM formulas
    const totalRow: string[] = ['TOTAL', ''];
    for (let i = 0; i < products.length; i++) {
      const col = colLetter(2 + i); // products start at column C (index 2)
      totalRow.push(`=SUM(${col}${firstCustomerRow}:${col}${lastCustomerRow})`);
    }
    rows.push(totalRow);
    currentRow++;

    // Blank separator row
    rows.push([]);
    currentRow++;
  }

  // Write all values (USER_ENTERED so SUM formulas are evaluated)
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.google.deliverySheetId,
    range: `'${tabName}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  // Apply formatting (bold headers, route labels, TOTAL rows)
  if (newSheetId !== undefined && newSheetId !== null) {
    await formatDeliveryTab(sheets, newSheetId, rows);
  }

  logger.info(`Delivery tab "${tabName}" created with ${uniqueCustomers.length} customers`);
}

// ── Apply bold formatting to header / route / TOTAL rows ─────────

async function formatDeliveryTab(
  sheets: sheets_v4.Sheets,
  sheetId: number,
  rows: (string | number)[][],
): Promise<void> {
  const requests: sheets_v4.Schema$Request[] = [];

  // Bold header row (row 0)
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: { textFormat: { bold: true } },
      },
      fields: 'userEnteredFormat.textFormat.bold',
    },
  });

  // Bold route headers; bold + orange background for TOTAL rows
  for (let i = 1; i < rows.length; i++) {
    const cellA = String(rows[i]?.[0] || '');
    if (cellA.startsWith('Route ')) {
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: i, endRowIndex: i + 1 },
          cell: {
            userEnteredFormat: { textFormat: { bold: true } },
          },
          fields: 'userEnteredFormat.textFormat.bold',
        },
      });
    } else if (cellA === 'TOTAL') {
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: i, endRowIndex: i + 1 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: { red: 1.0, green: 0.835, blue: 0.4 },
            },
          },
          fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor',
        },
      });
    }
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.google.deliverySheetId,
      requestBody: { requests },
    });
  }
}

// ── Update a customer's order on the delivery tab ────────────────

export async function updateDeliveryTabOrder(
  customerName: string,
  quantities: Record<string, number>,
  deliveryDate?: Date,
): Promise<void> {
  const date = deliveryDate || getDeliveryDate();
  const tabName = getDeliveryTabName(date);
  const sheets = getSheetsClient();

  // Ensure tab exists (creates it if needed)
  let sheetId = await getSheetIdByName(sheets, tabName);
  if (sheetId === null) {
    logger.info(`Delivery tab "${tabName}" not found — creating it now`);
    await ensureDeliveryTab(date);
    sheetId = await getSheetIdByName(sheets, tabName);
    if (sheetId === null) {
      logger.error(`Failed to create delivery tab "${tabName}"`);
      return;
    }
  }

  // Read column A to find the customer's row
  const colARes = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.deliverySheetId,
    range: `'${tabName}'!A:A`,
  });

  const colAValues = colARes.data.values || [];
  const customerRow = colAValues.findIndex(
    (row) => row[0]?.toString().toUpperCase().trim() === customerName.toUpperCase().trim(),
  );

  if (customerRow === -1) {
    logger.warn(
      `Customer "${customerName}" not found on delivery tab "${tabName}" — skipping tab update`,
    );
    return;
  }

  // Read header row to map product names → column indices
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.deliverySheetId,
    range: `'${tabName}'!1:1`,
  });

  const headers = (headerRes.data.values?.[0] || []).map((h: string) =>
    h.toString().toUpperCase().trim(),
  );

  // Determine which cells to update
  const updates: { col: number; value: number }[] = [];

  for (const [product, qty] of Object.entries(quantities)) {
    const displayHeader = (PRODUCT_HEADERS[product] || product).toUpperCase();
    const colIndex = headers.indexOf(displayHeader);
    if (colIndex === -1) {
      logger.warn(`Product column "${displayHeader}" not found on tab "${tabName}"`);
      continue;
    }
    updates.push({ col: colIndex, value: qty });
  }

  if (updates.length === 0) {
    logger.info(`No product columns matched for "${customerName}" on "${tabName}"`);
    return;
  }

  // Write quantity values
  const rowNum = customerRow + 1; // 0-indexed → 1-indexed for A1 notation
  const valueUpdates = updates.map((u) => ({
    range: `'${tabName}'!${colLetter(u.col)}${rowNum}`,
    values: [[u.value]],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.google.deliverySheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: valueUpdates,
    },
  });

  // Set green background on the updated cells
  const formatRequests: sheets_v4.Schema$Request[] = updates.map((u) => ({
    repeatCell: {
      range: {
        sheetId: sheetId!,
        startRowIndex: customerRow,
        endRowIndex: customerRow + 1,
        startColumnIndex: u.col,
        endColumnIndex: u.col + 1,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.714, green: 0.843, blue: 0.659 },
        },
      },
      fields: 'userEnteredFormat.backgroundColor',
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.google.deliverySheetId,
    requestBody: { requests: formatRequests },
  });

  logger.info(
    `Delivery tab "${tabName}" updated for "${customerName}": ` +
      updates.map((u) => `${headers[u.col]}=${u.value}`).join(', '),
  );
}
