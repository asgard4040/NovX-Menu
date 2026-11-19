import { createHmac, timingSafeEqual } from "node:crypto";

export const WAYL_API = "https://api.thewayl.com/api/v1/links";
export const WAYL_PAID_STATUSES = new Set(["Complete", "Delivered"]);

export function renewalAmount(monthlyCost: unknown, duration: string): number | null {
  const months = duration === "month" ? 1 : duration === "six-months" ? 6 : duration === "year" ? 12 : null;
  const cost = Number(monthlyCost);
  const amount = months === null ? NaN : cost * months;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function validWaylCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "checkout.thewayl.com" || url.hostname === "link.thewayl.com");
  } catch { return false; }
}

export function verifyWaylSignature(body: Buffer, signature: unknown, secret: string): boolean {
  if (!Buffer.isBuffer(body) || typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature) || !secret) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function waylLinkIsPaid(link: any, referenceId: string, amount: number, linkId: string): boolean {
  return link?.referenceId === referenceId && link?.id === linkId
    && link?.currency === "IQD" && Number(link?.total) === amount
    && WAYL_PAID_STATUSES.has(link?.status);
}
