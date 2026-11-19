import type { Order } from '../types';

export const baghdadDayKey = (value: number | Date) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const amount = (order: Order) => Number.isFinite(order.totalAmount) && order.totalAmount > 0 ? order.totalAmount : 0;

export function summarizeOwnerOrders(orders: Order[], now = Date.now()) {
  const today = baghdadDayKey(now);
  const month = today.slice(0, 7);
  const days = Array.from({ length: 7 }, (_, index) => baghdadDayKey(now - (6 - index) * 86_400_000));
  const dayTotals = Object.fromEntries(days.map(day => [day, 0]));
  const itemTotals = new Map<string, { name: string; quantity: number; value: number }>();
  let todayValue = 0;
  let monthValue = 0;
  let monthServedCount = 0;
  let monthRejectedCount = 0;
  let openValue = 0;

  for (const order of orders) {
    const createdAt = new Date(order.createdAt).getTime();
    if (!Number.isFinite(createdAt)) continue;
    const day = baghdadDayKey(createdAt);
    const value = amount(order);
    if (['pending', 'preparing', 'ready'].includes(order.status)) openValue += value;
    if (!day.startsWith(month)) continue;
    if (order.status === 'rejected' || order.status === 'cancelled') monthRejectedCount += 1;
    if (order.status !== 'served') continue;
    monthServedCount += 1;
    monthValue += value;
    if (day === today) todayValue += value;
    if (day in dayTotals) dayTotals[day] += value;
    for (const item of order.items) {
      const current = itemTotals.get(item.id || item.name) || { name: item.name, quantity: 0, value: 0 };
      current.quantity += item.quantity;
      current.value += item.quantity * item.price;
      itemTotals.set(item.id || item.name, current);
    }
  }

  return {
    todayValue, monthValue, monthServedCount, monthRejectedCount, openValue,
    averageTicket: monthServedCount ? Math.round(monthValue / monthServedCount) : 0,
    week: days.map(day => ({ day, value: dayTotals[day] })),
    topItems: [...itemTotals.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 3),
  };
}
