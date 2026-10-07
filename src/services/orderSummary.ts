import { config } from '../config';
import { getTodaysOrders, OrderRow } from './sheets';
import logger from '../logger';

export interface OrderSummary {
  date: string;
  route: string; // route number, or '' for unassigned
  totalsByProduct: Record<string, number>;
  orderCount: number;
  orders: OrderRow[];
}

// ── Friendly product display names for emails ───────────────────
const PRODUCT_DISPLAY_NAMES: Record<string, string> = {
  'toast': 'toast',
  '4-inch': '4 inch',
  'long': 'long',
  'institutional_sandwich': 'sandwich',
  'dinner_rolls': 'dinner rolls',
  'hoagie': 'hoagie',
  'top_slice': 'top slice',
};

export function productDisplayName(product: string): string {
  return PRODUCT_DISPLAY_NAMES[product] || product.replace(/_/g, ' ');
}

// ── Delivery date helpers ───────────────────────────────────────
// The delivery date is the next day after order collection, skipping Sunday.
// Wed orders → Thu delivery, Fri → Sat, Sat → Mon

export function getDeliveryDate(orderDate?: Date): Date {
  const base = orderDate || new Date();
  const delivery = new Date(base);
  delivery.setDate(delivery.getDate() + 1);
  // If delivery lands on Sunday, push to Monday
  if (delivery.getDay() === 0) {
    delivery.setDate(delivery.getDate() + 1);
  }
  return delivery;
}

export function formatDeliveryDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

export function deliveryDayName(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

// ── Summary builder ─────────────────────────────────────────────

function buildSummary(dateStr: string, route: string, orders: OrderRow[]): OrderSummary {
  const totalsByProduct: Record<string, number> = {};
  for (const product of config.products) {
    totalsByProduct[product] = 0;
  }

  for (const order of orders) {
    for (const product of config.products) {
      totalsByProduct[product] += order.quantities[product] || 0;
    }
  }

  return {
    date: dateStr,
    route,
    totalsByProduct,
    orderCount: orders.length,
    orders,
  };
}

export async function generateSummary(dateStr: string): Promise<OrderSummary> {
  const orders = await getTodaysOrders(dateStr);
  const summary = buildSummary(dateStr, '', orders);

  logger.info('Generated order summary', { date: dateStr, orderCount: orders.length, totalsByProduct: summary.totalsByProduct });

  return summary;
}

export async function generateSummariesByRoute(dateStr: string): Promise<OrderSummary[]> {
  const orders = await getTodaysOrders(dateStr);

  // Group orders by route
  const byRoute = new Map<string, OrderRow[]>();
  for (const order of orders) {
    const route = order.route || '';
    if (!byRoute.has(route)) byRoute.set(route, []);
    byRoute.get(route)!.push(order);
  }

  const summaries: OrderSummary[] = [];
  for (const [route, routeOrders] of byRoute) {
    const summary = buildSummary(dateStr, route, routeOrders);
    logger.info('Generated route summary', { date: dateStr, route: route || '(unassigned)', orderCount: routeOrders.length, totalsByProduct: summary.totalsByProduct });
    summaries.push(summary);
  }

  return summaries;
}

export function formatSummaryText(summary: OrderSummary, deliveryDay: string): string {
  const lines: string[] = [
    `please add the following to ${deliveryDay} and confirm:`,
    'ALL INSTITUTIONAL',
  ];

  for (const product of config.products) {
    const qty = summary.totalsByProduct[product] || 0;
    if (qty === 0) continue;
    lines.push(`${qty} - ${productDisplayName(product)}`);
  }

  lines.push('');
  lines.push('Thx,');
  lines.push(config.emailSignOffName);

  return lines.join('\n');
}

export function formatSummaryHtml(summary: OrderSummary, deliveryDay: string): string {
  const productLines = config.products
    .filter((p) => (summary.totalsByProduct[p] || 0) > 0)
    .map((p) => {
      const qty = summary.totalsByProduct[p];
      return `<p style="margin:4px 0;font-size:16px"><strong>${qty}</strong> - ${productDisplayName(p)}</p>`;
    })
    .join('\n');

  return `
<html><body style="font-family:sans-serif">
<p>please add the following to ${deliveryDay} and confirm:</p>
<p><strong>ALL INSTITUTIONAL</strong></p>
${productLines}
<br>
<p>Thx,<br>${config.emailSignOffName}</p>
</body></html>`;
}

// ── Group a given set of orders by route ────────────────────────

export function groupOrdersByRoute(dateStr: string, orders: OrderRow[]): OrderSummary[] {
  const byRoute = new Map<string, OrderRow[]>();
  for (const order of orders) {
    const route = order.route || '';
    if (!byRoute.has(route)) byRoute.set(route, []);
    byRoute.get(route)!.push(order);
  }

  const summaries: OrderSummary[] = [];
  for (const [route, routeOrders] of byRoute) {
    summaries.push(buildSummary(dateStr, route, routeOrders));
  }
  return summaries;
}

// ── Single-order formatters (one email per SMS) ─────────────────

export function formatOrderText(
  quantities: Record<string, number>,
  deliveryDay: string,
): string {
  const lines: string[] = [
    `please add the following to ${deliveryDay} and confirm:`,
    'ALL INSTITUTIONAL',
  ];

  for (const product of config.products) {
    const qty = quantities[product] || 0;
    if (qty === 0) continue;
    lines.push(`${qty} - ${productDisplayName(product)}`);
  }

  lines.push('');
  lines.push('Thx,');
  lines.push(config.emailSignOffName);

  return lines.join('\n');
}

export function formatOrderHtml(
  quantities: Record<string, number>,
  deliveryDay: string,
): string {
  const productLines = config.products
    .filter((p) => (quantities[p] || 0) > 0)
    .map((p) => {
      const qty = quantities[p];
      return `<p style="margin:4px 0;font-size:16px"><strong>${qty}</strong> - ${productDisplayName(p)}</p>`;
    })
    .join('\n');

  return `
<html><body style="font-family:sans-serif">
<p>please add the following to ${deliveryDay} and confirm:</p>
<p><strong>ALL INSTITUTIONAL</strong></p>
${productLines}
<br>
<p>Thx,<br>${config.emailSignOffName}</p>
</body></html>`;
}
