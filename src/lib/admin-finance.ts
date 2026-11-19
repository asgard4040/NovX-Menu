export type PaidSubscriptionPayment = { amount_iqd: number; paid_at: string };

export function baghdadMonth(value: string | Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date(value));
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
}

export function summarizeWaylPayments(paid: PaidSubscriptionPayment[], pendingCount: number, now = new Date()) {
  const currentMonth = baghdadMonth(now);
  const [year, month] = currentMonth.split('-').map(Number);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 6 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  const totals = Object.fromEntries(months.map(key => [key, 0]));
  let paidTotal = 0;
  let paidCount = 0;
  let lastPaidAt: string | null = null;
  for (const payment of paid) {
    const amount = Number(payment.amount_iqd);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isFinite(Date.parse(payment.paid_at))) continue;
    paidCount += 1;
    paidTotal += amount;
    const key = baghdadMonth(payment.paid_at);
    if (key in totals) totals[key] += amount;
    if (!lastPaidAt || payment.paid_at > lastPaidAt) lastPaidAt = payment.paid_at;
  }
  return { paidTotal, paidThisMonth: totals[currentMonth] || 0, paidCount,
    pendingCount, lastPaidAt, monthlySeries: months.map(month => ({ month, amount: totals[month] })) };
}
