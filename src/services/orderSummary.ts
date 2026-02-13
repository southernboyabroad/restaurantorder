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
    'Please add the following and confirm:',
    '',
  ];

  for (const product of config.products) {
    const qty = summary.totalsByProduct[product] || 0;
    if (qty === 0) continue;
    const displayName = product.replace(/_/g, ' ');
    lines.push(`${qty} - ${displayName}`);
  }

  return lines.join('\n');
}

export function formatSummaryHtml(summary: OrderSummary): string {
  const productLines = config.products
    .filter((p) => (summary.totalsByProduct[p] || 0) > 0)
    .map((p) => {
      const displayName = p.replace(/_/g, ' ');
      const qty = summary.totalsByProduct[p];
      return `<p style="margin:4px 0;font-size:16px"><strong>${qty}</strong> - ${displayName}</p>`;
    })
    .join('\n');

  return `
<html><body style="font-family:sans-serif">
<p>Please add the following and confirm:</p>
${productLines}
</body></html>`;
}
