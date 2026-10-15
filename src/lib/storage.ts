import { supabase } from "./supabase";

export async function persistRestaurantImage(restaurantId: string, value: string, prefix: string) {
  if (!value.startsWith("data:")) return value;
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!match) throw new Error("unsupported_image_format");
  const extension = match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1];
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  const path = `${restaurantId}/${prefix}-${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("restaurant-assets").upload(path, bytes, { contentType: match[1], upsert: false, cacheControl: "31536000" });
  if (error) throw error;
  return supabase.storage.from("restaurant-assets").getPublicUrl(path).data.publicUrl;
}
