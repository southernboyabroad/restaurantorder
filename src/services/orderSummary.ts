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

export function formatSummaryText(summary: OrderSummary): string {
  const lines: string[] = [
    `ORDER SUMMARY — ${summary.date}`,
    `Total orders received: ${summary.orderCount}`,
    '',
    '─── TOTALS BY PRODUCT ───',
  ];

  for (const product of config.products) {
    const displayName = product.replace(/_/g, ' ').toUpperCase();
    const qty = summary.totalsByProduct[product] || 0;
    lines.push(`  ${displayName}: ${qty}`);
  }

  lines.push('', '─── INDIVIDUAL ORDERS ───');

  for (const order of summary.orders) {
    const items = config.products
      .filter((p) => (order.quantities[p] || 0) > 0)
      .map((p) => `${p.replace(/_/g, ' ')} ×${order.quantities[p]}`)
      .join(', ');
    lines.push(`  ${order.name} (${order.phone}): ${items || 'none'}`);
  }

  return lines.join('\n');
}

export function formatSummaryHtml(summary: OrderSummary): string {
  const productRows = config.products
    .map((p) => {
      const displayName = p.replace(/_/g, ' ');
      const qty = summary.totalsByProduct[p] || 0;
      return `<tr><td style="padding:4px 12px;text-transform:capitalize">${displayName}</td><td style="padding:4px 12px;font-weight:bold">${qty}</td></tr>`;
    })
    .join('\n');

  const orderRows = summary.orders
    .map((order) => {
      const items = config.products
        .filter((p) => (order.quantities[p] || 0) > 0)
        .map((p) => `${p.replace(/_/g, ' ')} &times;${order.quantities[p]}`)
        .join(', ');
      return `<tr><td style="padding:4px 12px">${order.name}</td><td style="padding:4px 12px">${order.phone}</td><td style="padding:4px 12px">${items || 'none'}</td></tr>`;
    })
    .join('\n');

  return `
<html><body style="font-family:sans-serif">
<h2>Order Summary &mdash; ${summary.date}</h2>
<p>Total orders received: <strong>${summary.orderCount}</strong></p>

<h3>Totals by Product</h3>
<table border="1" cellspacing="0" style="border-collapse:collapse">
<tr style="background:#f0f0f0"><th style="padding:4px 12px">Product</th><th style="padding:4px 12px">Quantity</th></tr>
${productRows}
</table>

<h3>Individual Orders</h3>
<table border="1" cellspacing="0" style="border-collapse:collapse">
<tr style="background:#f0f0f0"><th style="padding:4px 12px">Name</th><th style="padding:4px 12px">Phone</th><th style="padding:4px 12px">Items</th></tr>
${orderRows}
</table>
</body></html>`;
}
