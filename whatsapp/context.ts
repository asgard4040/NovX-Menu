import type { Locale, Settings } from "./agent";
import { agentText, publicText } from "./agent";
import { normalizeMessage } from "./policy";
import type { Db } from "./worker";
import { result } from "./worker";

export const restaurantFields = "restaurant_name,province,area,landmark,latitude,longitude";
export function searchTerms(text: string) {
  return [...new Set(normalizeMessage(text).split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 2 && word.length <= 32 && !/^(?:the|me|my|want|please|اريد|عندكم|شنو|شكد|تحب|طلب|for|pickup|price|how|much)$/.test(word))
    .flatMap(word=> /^[و][\u0600-\u06ff]{3,}$/.test(word) ? [word.slice(1),word] : [word]))].slice(0,8);
}
export async function restaurantFacts(db: Db, restaurantId: string) {
  return result(await db.from("restaurants").select(restaurantFields).eq("id", restaurantId).single());
}
export function factReply(intent: "location" | "hours" | "contact", restaurant: any, settings: Settings, locale: Locale) {
  if (intent === "hours") return settings.opens_at && settings.closes_at
    ? (locale === "ar" ? "أوقات طلبات الاستلام " : "Pickup ordering hours ") + settings.opens_at.slice(0,5)+"–"+settings.closes_at.slice(0,5)+" ("+settings.timezone+")"
    : agentText.noDetails(locale);
  // manager_phone is private ownership data, not a verified public contact.
  if (intent === "contact") return agentText.noDetails(locale);
  const address = [restaurant.province,restaurant.area,restaurant.landmark].filter(value => typeof value === "string").map(publicText).filter(Boolean).join("، ");
  const lat = restaurant.latitude, lon = restaurant.longitude;
  const map = typeof lat === "number" && typeof lon === "number" && lat>=-90 && lat<=90 && lon>=-180 && lon<=180
    ? "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(lat+","+lon) : "";
  return address || map ? [publicText(restaurant.restaurant_name),address,map].filter(Boolean).join("\n") : agentText.noDetails(locale);
}
