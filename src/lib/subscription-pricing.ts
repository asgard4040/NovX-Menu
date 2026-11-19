export type PlanPrices = { normal: number | null; pro: number | null };

export const emptyPlanPrices: PlanPrices = { normal: null, pro: null };

export function parsePlanPrices(value: unknown): PlanPrices {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object') return emptyPlanPrices;
    const price = (name: 'normal' | 'pro') => {
      const amount = (parsed as Record<string, unknown>)[name];
      return Number.isSafeInteger(amount) && Number(amount) > 0 && Number(amount) <= 1_000_000_000
        ? Number(amount) : null;
    };
    return { normal: price('normal'), pro: price('pro') };
  } catch { return emptyPlanPrices; }
}

export function planMonthlyPrice(type: string, storedMonthlyCost: unknown, prices: PlanPrices): number | null {
  if (type === 'trial') return null;
  const configured = type === 'normal' || type === 'pro' ? prices[type] : null;
  const fallback = Number(storedMonthlyCost);
  const amount = configured ?? fallback;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
