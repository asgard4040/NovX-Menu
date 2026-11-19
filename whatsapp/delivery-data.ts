export type DeliveryZone = { id: string; city: string; area: string; fee: number };
export type DeliveryLocation = { latitude: number; longitude: number; address?: string };
export type DeliveryState = {
  fulfillment?: "delivery" | "pickup"; address?: { city?: string; area?: string; details?: string; latitude?: number; longitude?: number };
  deliveryContactPhone?: string; deliveryPhoneSource?: "whatsapp" | "alternative";
  awaitingField?: "items" | "address" | "address_details" | "phone_choice" | "alternative_phone" | "confirmation" | "coverage";
  awaitingConfirmation?: boolean; confirmedOrderId?: string; phoneError?: boolean;
};
export const asciiDigits = (text: string) => text.replace(/[٠-٩۰-۹]/g, digit => {
  const arabic = "٠١٢٣٤٥٦٧٨٩".indexOf(digit);
  return String(arabic >= 0 ? arabic : "۰۱۲۳۴۵۶۷۸۹".indexOf(digit));
});
export function deliveryPhone(value: unknown, webhook = false): string | null {
  if (typeof value !== "string" || value.length>80) return null;
  let phone = asciiDigits(value).replace(/[\s()\-]/g, "");
  if (phone.startsWith("00")) phone = "+"+phone.slice(2);
  if (!webhook && /^07\d{9}$/.test(phone)) phone = "+964"+phone.slice(1);
  else if (!phone.startsWith("+") && /^[1-9]\d{6,14}$/.test(phone)) phone = "+"+phone;
  return /^\+[1-9]\d{6,14}$/.test(phone) && !/^\+9640/.test(phone) ? phone : null;
}
export function phoneCandidates(text: string) {
  return [...text.matchAll(/(?:\+|00)?[0-9٠-٩۰-۹](?:[0-9٠-٩۰-۹ ()-]{5,24})[0-9٠-٩۰-۹]/g)].map(match => ({ raw: match[0].trim(), phone: deliveryPhone(match[0]) }));
}
export function validLocation(value: any): DeliveryLocation | null {
  const numeric = (v: unknown) => (typeof v === "number" || typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v)) ? Number(v) : NaN;
  const latitude=numeric(value?.latitude),longitude=numeric(value?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude< -90 || latitude>90 || longitude< -180 || longitude>180) return null;
  return { latitude,longitude,...(typeof value.address === "string" && value.address.length<=400 && !/[\x00-\x1f]/.test(value.address) ? {address:value.address} : {}) };
}
export function parseDeliveryZones(value: unknown): DeliveryZone[] {
  if (!Array.isArray(value) || value.length>100) throw new Error("invalid_delivery_zones");
  const ids=new Set<string>(),areas=new Set<string>();
  return value.map(zone => {
    if (!zone || Object.keys(zone).sort().join()!=="area,city,fee,id" || typeof zone.id!=="string" ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(zone.id) || ids.has(zone.id.toLowerCase()) ||
      ![zone.city,zone.area].every(text=>typeof text==="string" && text.trim().length>=2 && text.length<=80 && !/[\x00-\x1f]/.test(text)) ||
      typeof zone.fee!=="number" || !Number.isFinite(zone.fee) || zone.fee<0 || zone.fee>1_000_000 || Number(zone.fee.toFixed(2))!==zone.fee) throw new Error("invalid_delivery_zones");
    const area=zone.city.trim().toLowerCase()+":"+zone.area.trim().toLowerCase();
    if (areas.has(area)) throw new Error("duplicate_delivery_zone");
    ids.add(zone.id.toLowerCase());areas.add(area);
    return { id:zone.id.toLowerCase(),city:zone.city.trim(),area:zone.area.trim(),fee:zone.fee };
  });
}
