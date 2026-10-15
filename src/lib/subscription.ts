export type SubscriptionRecord = {
  status?: string;
  startDate?: string | number | Date;
  endDate?: string | number | Date;
  gracePeriodDays?: number;
};

function asMillis(value: SubscriptionRecord["endDate"]): number | null {
  if (value == null || value === "") return null;
  const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

/** End dates are exclusive instants. The server clock must be supplied in protected paths. */
export function getSubscriptionAccess(
  subscription: SubscriptionRecord,
  nowMs: number = Date.now(),
) {
  const startsAt = asMillis(subscription.startDate);
  const endsAt = asMillis(subscription.endDate);
  // The existing product grants a three-day grace period unless a restaurant
  // record explicitly overrides it (including zero).
  const graceDays = subscription.gracePeriodDays ?? 3;
  const graceMs = Math.max(0, Number(graceDays) || 0) * 86_400_000;
  const enabled = subscription.status === "active";
  const started = startsAt === null || nowMs >= startsAt;
  const expiresAt = endsAt === null ? null : endsAt + graceMs;
  const unexpired = expiresAt !== null && nowMs < expiresAt;

  return {
    allowed: enabled && started && unexpired,
    startsAt,
    endsAt,
    expiresAt,
    reason: !enabled
      ? "inactive"
      : !started
        ? "not_started"
        : endsAt === null
          ? "invalid_expiration"
          : !unexpired
            ? "expired"
            : "active",
  } as const;
}

export function calculateSubscriptionEnd(start: string | number | Date, duration: "week" | "month" | "six-months" | "year") {
  const date = new Date(start);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_start_date");
  if (duration === "week") return new Date(date.getTime() + 7 * 86_400_000);
  const months = duration === "month" ? 1 : duration === "six-months" ? 6 : 12;
  const originalDay = date.getUTCDate();
  const target = new Date(date.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const finalDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(originalDay, finalDay));
  return target;
}
