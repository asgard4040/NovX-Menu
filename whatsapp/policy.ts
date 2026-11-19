// Server policy. This module does not contain credentials or customer data.
export const defaultPolicy = {
  customer_daily_requests: 100, customer_rpm: 12, restaurant_rpm: 120,
  monthly_requests: 4500, conversation_responses: 80,
  daily_budget_usd: 1, monthly_budget_usd: 10, request_max_usd: 0.02,
  max_input_chars: 2000, max_response_chars: 1200,
};
export type Policy = typeof defaultPolicy;
export function parsePolicy(value: unknown): Policy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_policy");
  const ranges: Record<keyof Policy, [number, number]> = {
    customer_daily_requests: [1, 1000], customer_rpm: [1, 60], restaurant_rpm: [1, 1000],
    monthly_requests: [1, 100000], conversation_responses: [1, 500],
    daily_budget_usd: [0, 1000], monthly_budget_usd: [0, 10000], request_max_usd: [0, 1],
    max_input_chars: [100, 4096], max_response_chars: [200, 2000],
  };
  const result = { ...defaultPolicy };
  for (const [key, number] of Object.entries(value)) {
    if (!(key in ranges) || typeof number !== "number" || !Number.isFinite(number)) throw new Error("invalid_policy");
    const [min, max] = ranges[key as keyof Policy];
    if (number < min || number > max || (!key.endsWith("_usd") && !Number.isInteger(number))) throw new Error("invalid_policy");
    result[key as keyof Policy] = number;
  }
  return result;
}
export const normalizeMessage = (text: string) => text.toLowerCase().normalize("NFKC")
  .replace(/[\u064b-\u065f\u0670\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "")
  .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[گڨ]/g, "ك")
  .replace(/[؟?!.,،]+$/g, "").replace(/\s+/g, " ").trim();
export function messageLocale(text: string, fallback: "ar" | "en"): "ar" | "en" {
  return /[\u0600-\u06ff]/.test(text) ? "ar" : /[a-z]{2}/i.test(text) ? "en" : fallback;
}
// This only intercepts explicit high-confidence attempts. It is not a security
// boundary: unknown attacks still face allowlisted actions, IDs and SQL checks.
export function scopeViolation(text: string) {
  const t = normalizeMessage(text);
  return /ignore (?:all |your |the |previous )*(?:instructions|rules)|(?:reveal|print|show|give).{0,30}(?:system prompt|api.?key|secret|database)|(?:act as|you are now).{0,25}(?:developer|chatgpt|system)|another (?:restaurant|tenant).{0,25}(?:data|menu)|(?:write|generate).{0,20}(?:python|javascript|code)|quantum physics|president of|(?:ignore|override).{0,20}(?:system|developer)|(?:10000|10,000) words|(?:اكشف|اطبع|اعرض).{0,25}(?:مفتاح|تعليمات النظام|قاعده البيانات)|تجاهل.{0,25}(?:التعليمات|القواعد)|(?:بيانات|منيو) مطعم اخر|اكتب.{0,15}(?:كود|بايثون)/i.test(t);
}
export function fastIntent(text: string): "menu" | "location" | "hours" | "contact" | null {
  const t = normalizeMessage(text);
  if (/^(?:المنيو|منيو|القائمه|رابط الطلب|رابط المنيو|اريد المنيو|اريد اشوف المنيو|menu|the menu|show me the menu|menu link|order link|ordering link)$/.test(t)) return "menu";
  if (/^(?:الموقع|العنوان|موقع المطعم|وين مكانكم|وين المطعم|location|address|restaurant address)$/.test(t)) return "location";
  if (/^(?:اوقات الدوام|اوقات العمل|ساعات العمل|متى تفتحون|opening hours|hours|pickup hours)$/.test(t)) return "hours";
  if (/^(?:رقم المطعم|رقم الهاتف|رقمكم|restaurant phone|phone number|contact number)$/.test(t)) return "contact";
  return null;
}
export function boundedInteger(name: string, fallback: number, min: number, max: number) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
