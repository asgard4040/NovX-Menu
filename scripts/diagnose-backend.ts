import dotenv from "dotenv";
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: [".env.local", ".env"], quiet: true });
if (!globalThis.WebSocket) (globalThis as any).WebSocket = WebSocket;

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const restaurantId = process.argv[2];
if (!url || !anon || !service || !restaurantId) throw new Error("Supabase configuration and restaurant ID are required");

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const publicClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const restaurant = await admin.from("restaurants").select("id,status,start_date,end_date,grace_period_days,latitude,longitude,geofence_radius_meters,current_order_number").eq("id", restaurantId).single();
if (restaurant.error || !restaurant.data) throw restaurant.error || new Error("Restaurant not found");
const menu = await publicClient.rpc("public_restaurant_menu", { p_restaurant_id: restaurantId });
const items = await admin.from("menu_items").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId);
const members = await admin.from("restaurant_members").select("role,active").eq("restaurant_id", restaurantId);
const staff = await admin.from("staff").select("role,status").eq("restaurant_id", restaurantId);
const lastOrder = await admin.from("orders").select("order_number,status").eq("restaurant_id", restaurantId).order("order_number", { ascending: false }).limit(1);
console.log(JSON.stringify({
  restaurant: { status: restaurant.data.status, hasCoordinates: restaurant.data.latitude !== null && restaurant.data.longitude !== null, radius: restaurant.data.geofence_radius_meters, subscriptionEnd: restaurant.data.end_date, currentOrderNumber: restaurant.data.current_order_number, highestHistoricalOrderNumber: lastOrder.data?.[0]?.order_number ?? null, orderQueryError: lastOrder.error?.message || null },
  menu: { error: menu.error?.message || null, publicItems: menu.data?.menu_items?.length ?? null, storedItems: items.count, storedError: items.error?.message || null },
  membership: { error: members.error?.message || null, roles: members.data },
  staff: { error: staff.error?.message || null, roles: staff.data },
}));

for (const accuracy of [100, 139]) {
  const result = await publicClient.rpc("create_customer_order", {
    p_restaurant_id: restaurantId,
    p_customer_name: "__diagnostic__",
    p_table_number: "__diagnostic__",
    p_notes: "",
    p_items: [], // Forces rejection without creating an order.
    p_lat: restaurant.data.latitude,
    p_lon: restaurant.data.longitude,
    p_accuracy: accuracy,
    p_fingerprint: "__diagnostic__",
    p_idempotency_key: crypto.randomUUID(),
    p_tracking_token: crypto.randomUUID(),
  });
  console.log(JSON.stringify({ accuracy, error: result.error && { code: result.error.code, message: result.error.message, details: result.error.details }, unexpectedlyCreated: !!result.data }));
}
