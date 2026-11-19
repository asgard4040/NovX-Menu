import { randomUUID } from "node:crypto";
import { ProviderError, uuid } from "./meta";
import { restaurantInstructions } from "./instructions";
import { boundedInteger, scopeViolation, type Policy } from "./policy";
import type { DeliveryZone } from "./delivery-data";

export type Locale = "ar" | "en";
export type CartItem = { id: string; quantity: number; cheeseSelected: boolean; spicySelected: boolean };
export type MenuItem = {
  id: string; name: string; category: string | null; price: number; has_cheese: boolean; is_spicy: boolean;
  cheese_price: number; spicy_price: number; is_available: boolean; ingredients: string | null;
};
export type Price = { items: (CartItem & { name: string; price: number })[]; total: number };
export type Settings = {
  runtime_config?: RuntimeConfig;
  enabled: boolean; ordering_enabled: boolean; welcome: string; language: Locale; tone: "friendly" | "formal";
  opens_at: string | null; closes_at: string | null; timezone: string; handoff_enabled: boolean; daily_ai_limit: number; ai_policy?: Policy;
  delivery_enabled?: boolean; delivery_zones?: DeliveryZone[];
};
export const defaultSettings: Settings = {
  enabled: false, ordering_enabled: false, welcome: "", language: "ar", tone: "friendly",
  opens_at: null, closes_at: null, timezone: "Asia/Baghdad", handoff_enabled: true, daily_ai_limit: 150,
};
export type Decision = {
  action: "greet" | "location" | "hours" | "contact" | "menu" | "details" | "ingredients" | "quote_pickup" | "draft" | "clarify" | "unavailable" |
    "invalid_modifier" | "delivery" | "dine_in" | "cancel_cart" | "status" | "handoff" | "unsupported";
  locale: Locale; items: CartItem[]; menu_ids: string[]; delivery_address?: string | null;
};
const actions = [
  "greet", "location", "hours", "contact", "menu", "details", "ingredients", "quote_pickup", "draft", "clarify", "unavailable", "invalid_modifier",
  "delivery", "dine_in", "cancel_cart", "status", "handoff", "unsupported",
] as const;

export function aiCredentials() {
  return {
    model: process.env.WHATSAPP_OPENAI_MODEL || "gpt-6-luna",
    key: process.env.WHATSAPP_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
  };
}

export type Usage = { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number; estimated_usd?: number };
const itemSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "quantity", "cheeseSelected", "spicySelected"],
  properties: { id: { type: "string" }, quantity: { type: "integer" },
    cheeseSelected: { type: "boolean" }, spicySelected: { type: "boolean" } },
};
const decisionSchema = {
  type: "object", additionalProperties: false, required: ["action", "locale", "items", "menu_ids"],
  properties: {
    action: { type: "string", enum: actions }, locale: { type: "string", enum: ["ar", "en"] },
    items: { type: "array", items: itemSchema }, menu_ids: { type: "array", items: { type: "string" } },
  },
};

export function validDecision(value: any): value is Decision {
  return value !== null && typeof value === "object" && ["action,items,locale,menu_ids","action,delivery_address,items,locale,menu_ids"].includes(Object.keys(value).sort().join()) && actions.includes(value.action) &&
    (value.delivery_address == null || typeof value.delivery_address === "string" && value.delivery_address.length<=400 && !/[\x00-\x1f]/.test(value.delivery_address)) &&
    ["ar", "en"].includes(value.locale) && Array.isArray(value.items) && value.items.length <= 12 &&
    new Set(value.items.map((item: any) => item?.id)).size === value.items.length &&
    value.items.every((item: any) => item && Object.keys(item).sort().join() === "cheeseSelected,id,quantity,spicySelected" && uuid(item?.id) && Number.isInteger(item.quantity) &&
      item.quantity >= 1 && item.quantity <= 20 && typeof item.cheeseSelected === "boolean" &&
      typeof item.spicySelected === "boolean") &&
    Array.isArray(value.menu_ids) && value.menu_ids.length <= 12 && value.menu_ids.every(uuid);
}

export function modelRates(model: string) {
  const input = process.env.WHATSAPP_OPENAI_INPUT_USD_PER_MILLION || (model === "gpt-6-luna" ? "0.10" : "");
  const output = process.env.WHATSAPP_OPENAI_OUTPUT_USD_PER_MILLION || (model === "gpt-6-luna" ? "0.50" : "");
  const cached = process.env.WHATSAPP_OPENAI_CACHED_INPUT_USD_PER_MILLION || (model === "gpt-6-luna" ? "0.01" : input);
  if (![input, output, cached].every(rate => /^\d+(\.\d+)?$/.test(rate))) return null;
  const rates = { input: Number(input), output: Number(output), cached: Number(cached) };
  return Object.values(rates).every(n => Number.isFinite(n) && n <= 10000) ? rates : null;
}
export type RuntimeConfig = {model?:string;input:number;output:number;cached:number;max_output_tokens:number;timeout_ms:number};
function cost(input: number, output: number, cached: number, model: string, runtime?: RuntimeConfig) {
  const rates = runtime || modelRates(model);
  return rates ? ((input-cached)*rates.input+cached*rates.cached+output*rates.output)/1_000_000 : undefined;
}
export type AgentInput = {
  text: string; menu: MenuItem[]; draft: CartItem[]; history: string[]; locale: Locale; pickupQuoted?: boolean; hasActiveOrder?: boolean;
  deliveryContext?: { enabled: boolean; awaitingField?: string; hasAddress: boolean; hasContact: boolean; hasSenderPhone: boolean };
};
export const outputTokenLimit = () => boundedInteger("WHATSAPP_OPENAI_MAX_OUTPUT_TOKENS", 1800, 800, 4000);
function inputData(input: AgentInput) {
  return JSON.stringify({ ...input, text: input.text.slice(0,4096), history: input.history.slice(-4).map(text => text.slice(0,240)),
    draft: input.draft.slice(0,12), menu: input.menu.slice(0,24).map(item => ({ id: item.id, name: item.name.slice(0,100),
      category: item.category?.slice(0,55), available: item.is_available, cheese: item.has_cheese, spicy: item.is_spicy })) });
}
export function requestReservation(input: AgentInput, model: string, runtime?: RuntimeConfig) {
  const rates = runtime || modelRates(model);
  if (!rates) return null;
  // Conservative UTF-8 byte bound, plus allowance for the fixed tool schema.
  // Unknown/failed usage keeps this reservation, rather than refunding a call
  // whose billing outcome is unknown. It is a guard, not an exact invoice.
  return (Buffer.byteLength(inputData(input)+restaurantInstructions,"utf8")+3000)*rates.input/1_000_000 + (runtime?.max_output_tokens || outputTokenLimit())*rates.output/1_000_000;
}

export async function interpret(input: AgentInput, model: string, key: string, fetcher = fetch, runtime?: RuntimeConfig): Promise<{ decision: Decision | null; usage: Usage }> {
  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(runtime?.timeout_ms || 16_000),
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model, store: false, instructions: restaurantInstructions, max_output_tokens: runtime?.max_output_tokens || outputTokenLimit(),
        ...(model === "gpt-6-luna" || model.startsWith("gpt-6-luna-") ? { reasoning: {
          effort: process.env.WHATSAPP_OPENAI_REASONING_EFFORT === "low" ? "low" : "none",
        } } : {}),
        tools: [{ type: "function", name: "interpret_restaurant_message", strict: true,
          description: "Classify intent and propose a cart from the provided tenant menu", parameters: input.deliveryContext?.enabled ? {
            ...decisionSchema, required: [...decisionSchema.required,"delivery_address"], properties: { ...decisionSchema.properties,
              delivery_address: { type:["string","null"],description:"Verbatim delivery address substring from the current customer text only, excluding order and phone details. Null if not provided." } },
          } : decisionSchema }],
        tool_choice: { type: "function", name: "interpret_restaurant_message" }, parallel_tool_calls: false,
        input: inputData(input),
      }),
    });
  } catch {
    throw new ProviderError("openai_network", true);
  }
  if (!response.ok) {
    const failure: any = await response.json().catch(() => null);
    const exhausted = ["insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached"].includes(failure?.error?.code);
    throw new ProviderError(exhausted ? "openai_billing_unavailable" : "openai_http_" + response.status,
      !exhausted && (response.status >= 500 || response.status === 429));
  }
  const json: any = await response.json().catch(() => null);
  const calls = Array.isArray(json?.output) ? json.output.filter((x: any) => x?.type === "function_call") : [];
  let decision: unknown = null;
  if (json?.status === "completed" && calls.length === 1 && calls[0].name === "interpret_restaurant_message" &&
      typeof calls[0].arguments === "string" && calls[0].arguments.length <= 5000) {
    try { decision = JSON.parse(calls[0].arguments); } catch { /* invalid output falls back to clarification */ }
  }
  const { input_tokens, output_tokens } = json?.usage ?? {};
  const cached = json?.usage?.input_tokens_details?.cached_tokens;
  const cached_input_tokens = Number.isInteger(cached) && cached >= 0 && cached <= input_tokens ? cached : 0;
  const allowedIds = new Set(input.menu.map(item => item.id));
  const measured = Number.isInteger(input_tokens) && input_tokens >= 0 && Number.isInteger(output_tokens) && output_tokens >= 0;
  return {
    decision: validDecision(decision) && (!decision.delivery_address || input.deliveryContext?.enabled && input.text.includes(decision.delivery_address)) &&
      [...decision.items.map(item => item.id), ...decision.menu_ids].every(id => allowedIds.has(id)) ? decision : null,
    usage: measured ? { input_tokens, cached_input_tokens, output_tokens, estimated_usd: cost(input_tokens, output_tokens, cached_input_tokens, model, runtime) } : {},
  };
}

const normalize = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[\u064b-\u065f\u0670]/g, "")
  .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[گڨق]/g, "ك")
  .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).trim();

export function shortlist(menu: MenuItem[], text: string, cart: CartItem[]) {
  const words = normalize(text).split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 2);
  const score = (item: MenuItem) => {
    const name = normalize(item.name + " " + (item.category || ""));
    return words.reduce((sum, word) => sum + (name.includes(word) ? word.length : 0), 0);
  };
  const draftIds = new Set(cart.map(item => item.id));
  return menu.map(item => ({ item, score: score(item) + (draftIds.has(item.id) ? 1000 : 0) }))
    .sort((a, b) => b.score - a.score).slice(0, 24).map(({ item }) => item);
}

const pick = (locale: Locale, ar: string, en: string) => locale === "ar" ? ar : en;
const cleanLabel = (value: string) => value.replace(/[\x00-\x1f\u202a-\u202e\u2066-\u2069]/g, " ").slice(0, 65);
export const verifiedPrice = (value: unknown) => value !== null && value !== undefined && value !== "" && /^(?:\d+)(?:\.\d+)?$/.test(String(value)) && Number.isFinite(Number(value));
export const publicText = (value: string) => !scopeViolation(value) ? value.replace(/[\x00-\x1f\u202a-\u202e\u2066-\u2069]/g, " ") : "";
const money = (value: number, locale: Locale) =>
  value.toLocaleString("en-IQ", { maximumFractionDigits: 2 }) + pick(locale, " د.ع", " IQD");

export const confirmationCode = (id: string) => id.slice(0, 8);
export function confirmation(
  input: { text?: string; button?: string; context?: string }, quoteId: string | null, quoteProviderId?: string | null,
): boolean {
  if (!quoteId) return false;
  if (input.button === "confirm:" + quoteId) return true;
  const text = normalize(input.text || "").replace(/[!.؟]+$/, "").trim();
  if (text === "confirm " + confirmationCode(quoteId) || text === "ثبت " + confirmationCode(quoteId)) return true;
  return !!quoteProviderId && input.context === quoteProviderId &&
    /^(?:اي ثبت|ثبت|ثبت الطلب|yes confirm|confirm(?: my order)?)$/.test(text);
}

export type Reply = { text: string; button?: string; title?: string; handoff?: boolean };
export function quoteReply(price: Price, locale: Locale, quoteId = randomUUID()): { id: string; reply: Reply } {
  const lines = price.items.map(item =>
    item.quantity + " × " + item.name.replace(/[\x00-\x1f\u202a-\u202e\u2066-\u2069]/g, " ").slice(0, 200)
      .replace(/[\uD800-\uDBFF]$/, "") +
    (item.cheeseSelected ? pick(locale, " + جبن", " + cheese") : "") +
    (item.spicySelected ? pick(locale, " + حار", " + spicy") : "") +
    " | " + money(item.price, locale) + pick(locale, " للواحد", " each"));
  const code = confirmationCode(quoteId);
  return { id: quoteId, reply: {
    text: [pick(locale, "طلب استلام من المطعم", "Pickup order"), ...lines,
      pick(locale, "المجموع ", "Total ") + money(Number(price.total), locale),
      pick(locale, "للتأكيد اضغط الزر أو اكتب ثبت ", "Tap the button or type confirm ") + code].join("\n"),
    button: "confirm:" + quoteId, title: pick(locale, "تأكيد الطلب", "Confirm order"),
  } };
}

export function orderStatusText(status: string, orderNumber: number, locale: Locale, fulfillment?: string): string {
  const prefix = pick(locale, "طلبك رقم #", "Order #") + orderNumber + " ";
  const states: Record<string, [string, string]> = {
    pending: ["انرسل للمراجعة وينتظر موافقة المطعم.", "was submitted and is awaiting restaurant approval."],
    preparing: ["وافق عليه المطعم ودا يتحضّر.", "was accepted and is being prepared."],
    ready: fulfillment === "delivery" ? ["صار جاهز للتوصيل.", "is ready for delivery."] : ["صار جاهز للاستلام ✅", "is ready for pickup ✅"],
    served: ["اكتمل. شكراً إلك!", "is complete. Thank you!"],
    rejected: ["ما قدر المطعم يقبله. تواصل وياهم للمساعدة.", "was declined. Contact the restaurant for assistance."],
    cancelled: ["انلغى.", "was cancelled."],
  };
  const state = states[status];
  return state ? prefix + pick(locale, ...state) : pick(locale, "حالة الطلب غير متوفرة.", "Order status is unavailable.");
}

export const agentText = {
  clarify: (l: Locale) => pick(l, "ممكن توضح اسم الصنف والكمية اللي تريدها؟", "Which menu item and quantity would you like?"),
  unavailable: (l: Locale) => pick(l, "هالصنف مو متوفر بالمنيو الحالي. تحب تختار غيره؟", "That item is unavailable on the current menu. Would you like another?"),
  invalid_modifier: (l: Locale) => pick(l, "هالإضافة مو متوفرة لهالصنف. تحبه بدونها؟", "That option is unavailable for this item. Would you like it without the option?"),
  delivery: (l: Locale) => pick(l, "طلب التوصيل مو مفعّل آلياً هنا حالياً. احچي ويا موظف المطعم حتى يساعدك.", "Automatic delivery ordering is not enabled here. Ask the restaurant staff for help."),
  dine_in: (l: Locale) => pick(l, "للطلب على الطاولة امسح رمز الـQR الموجود عليها.", "For table orders, scan the QR code at your table."),
  cancel_cart: (l: Locale) => pick(l, "مسحت السلة. شتحب تطلب؟", "Your cart was cleared. What would you like?"),
  unsupported: (l: Locale) => pick(l, "أگدر أساعدك بالمنيو والطلبات الخاصة بالمطعم. شنو تحتاج؟", "I can help with this restaurant’s menu and orders. What would you like to know?"),
  closed: (l: Locale) => pick(l, "طلبات الاستلام مو مفتوحة هسه. تكدر تشوف المنيو.", "Pickup orders are currently closed. You can still browse the menu."),
  changed: (l: Locale) => pick(l, "السعر أو التوفر تغيّر. اطلب ملخص جديد قبل التأكيد.", "Price or availability changed. Ask for a new summary before confirming."),
  expired: (l: Locale) => pick(l, "هذا التأكيد انتهت صلاحيته. اطلب ملخص جديد.", "That confirmation expired. Ask for a new summary."),
  pickup: (l: Locale) => pick(l, "ضفت الأصناف لسلتك. تريده استلام من المطعم؟", "I updated your cart. Would you like pickup at the restaurant?"),
  quota: (l: Locale) => pick(l, "المساعد مشغول هسه. جرّب بعدين أو تواصل ويا المطعم.", "The assistant is busy. Try later or contact the restaurant."),
  handoff: (l: Locale) => pick(l, "وصل طلب المساعدة للمطعم. الفريق يرد عليك من هنا إن أمكن.", "Your request was sent to the restaurant. Staff can reply here when available."),
  noHandoff: (l: Locale) => pick(l, "تواصل ويا المطعم مباشرة حتى يساعدوك.", "Contact the restaurant directly for help."),
  noDetails: (l: Locale) => pick(l, "هالمعلومة مو مسجّلة عدنا. اسأل موظف المطعم إذا تحب.", "That information is unavailable here. You can ask the restaurant staff."),
  noOrder: (l: Locale) => pick(l, "ماكو طلب مسجّل لهالمحادثة.", "There is no submitted order in this conversation."),
};

export function menuText(rows: MenuItem[], locale: Locale, menuUrl: string) {
  const shown = rows.filter(item => item.is_available && verifiedPrice(item.price) && publicText(item.name)).slice(0, 3);
  if (!shown.length) return agentText.unavailable(locale) + "\n" + menuUrl;
  return shown.map(item => {
    const modifiers = [
      item.has_cheese && verifiedPrice(item.cheese_price) ? pick(locale, "جبن +", "Cheese +") + money(Number(item.cheese_price), locale) : "",
      item.is_spicy && verifiedPrice(item.spicy_price) ? pick(locale, "حار +", "Spicy +") + money(Number(item.spicy_price), locale) : "",
    ].filter(Boolean);
    return cleanLabel(item.name) + " | " + money(Number(item.price), locale) + (modifiers.length ? " (" + modifiers.join("، ") + ")" : "");
  }).join("\n") + "\n" + pick(locale, "المنيو الكامل ", "Full menu ") + menuUrl;
}
