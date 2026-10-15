import dotenv from "dotenv";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: [".env.local", ".env"], quiet: true });
if (!globalThis.WebSocket) (globalThis as any).WebSocket = WebSocket;

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";
if (!url || !anonKey || !serviceKey) throw new Error("Supabase environment is incomplete");

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = randomUUID().replace(/-/g, "").slice(0, 12);
const username = `codexsmoke${stamp}`;
const password = `S-${randomUUID()}-9`;
const createdUsers: string[] = [];
let restaurantId: string | null = null;
let apiRestaurantId: string | null = null;
const apiRestaurantUsername = `${username}api`;
let realtimeClient: { removeAllChannels: () => Promise<unknown> } | null = null;

function checked<T>(data: T | null, error: { message: string } | null, label: string): T {
  if (error || data === null) throw new Error(`${label}: ${error?.message || "missing data"}`);
  return data;
}

async function request(path: string, method = "GET", body?: object, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => null);
  return { status: response.status, result };
}

async function createUser(role: "owner" | "waiter" | "kitchen", rid: string) {
  const login = `${username}${role}`;
  const created = await admin.auth.admin.createUser({
    email: `${login}@accounts.novx.invalid`, password, email_confirm: true,
    user_metadata: { name: `Smoke ${role}` }, app_metadata: { role, restaurant_id: rid },
  });
  const user = checked(created.data.user, created.error, `create ${role} user`);
  createdUsers.push(user.id);
  const member = await admin.from("restaurant_members").insert({ restaurant_id: rid, user_id: user.id, role });
  checked(true, member.error, `create ${role} membership`);
  if (role !== "owner") {
    const staff = await admin.from("staff").insert({ restaurant_id: rid, auth_user_id: user.id, role, name: `Smoke ${role}`, username: login });
    checked(true, staff.error, `create ${role} staff`);
  }
  const auth = await request("/api/auth/login", "POST", { role: role === "owner" ? "restaurant" : role, username: login, password, restaurantId: rid });
  if (auth.status !== 200 || !auth.result?.accessToken) throw new Error(`${role} login: ${auth.status} ${auth.result?.error}`);
  const token = auth.result.accessToken as string;
  const session = await request("/api/auth/session", "GET", undefined, token);
  if (session.status !== 200 || session.result?.restaurantId !== rid) throw new Error(`${role} session: ${session.status}`);
  console.log(`${role} login/session: PASS`);
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authenticated = await client.auth.setSession({ access_token: token, refresh_token: auth.result.refreshToken });
  checked(authenticated.data.session, authenticated.error, `${role} client session`);
  return client;
}

try {
  const restaurant = await admin.from("restaurants").insert({
    manager_name: "Smoke Test", restaurant_name: "Codex temporary test", username,
    start_date: new Date(Date.now() - 86_400_000).toISOString(),
    end_date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    grace_period_days: 0, latitude: 30.6135, longitude: 47.7524,
    geofence_radius_meters: 150, categories: ["Test"],
  }).select("id").single();
  restaurantId = checked(restaurant.data?.id || null, restaurant.error, "create temporary restaurant");
  const rid = restaurantId;
  const owner = await createUser("owner", rid);
  const waiter = await createUser("waiter", rid);
  realtimeClient = waiter;
  const kitchen = await createUser("kitchen", rid);

  const item = await owner.from("menu_items").insert({ restaurant_id: rid, name: "Smoke test item", price: 1000, category: "Test" }).select("id").single();
  const itemId = checked(item.data?.id || null, item.error, "create menu item");
  const publicMenu = await request(`/api/public/restaurants/${rid}`);
  if (publicMenu.status !== 200 || !publicMenu.result?.menuItems?.some((entry: any) => entry.id === itemId)) throw new Error(`public menu: ${publicMenu.status}`);
  console.log("public menu: PASS");

  const wrongPassword = await request("/api/auth/login", "POST", { role: "waiter", username: `${username}waiter`, password: "wrong-password", restaurantId: rid });
  const wrongRole = await request("/api/auth/login", "POST", { role: "kitchen", username: `${username}waiter`, password, restaurantId: rid });
  if (wrongPassword.status !== 401 || wrongRole.status !== 403) throw new Error(`login rejection: ${wrongPassword.status}/${wrongRole.status}`);
  console.log("incorrect password/role rejection: PASS");

  let onOrderInserted: ((id: string) => void) | null = null;
  const orderEvent = new Promise<string>((resolve) => { onOrderInserted = resolve; });
  const subscriptionReady = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("realtime subscription timeout")), 10_000);
    waiter.channel(`smoke-orders-${stamp}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders", filter: `restaurant_id=eq.${rid}` }, (event) => onOrderInserted?.(String(event.new.id)))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(); }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); reject(new Error(`realtime ${status}`)); }
      });
  });
  await subscriptionReady;

  const trackingToken = randomUUID();
  const payload = { restaurantId: rid, customerName: "Smoke customer", tableNumber: "TEST", items: [{ id: itemId, quantity: 2 }],
    location: { latitude: 30.6135, longitude: 47.7524, accuracy: 139 }, idempotencyKey: randomUUID(), trackingToken };
  for (const location of [undefined, null, { latitude: null, longitude: 47.7524, accuracy: 0 }, { latitude: 30.6135, longitude: 47.7524, accuracy: 151 }]) {
    const invalidOrder = await request("/api/orders", "POST", { ...payload, location, idempotencyKey: randomUUID() });
    if (invalidOrder.status !== 400 || invalidOrder.result?.error !== "invalid_location") throw new Error(`invalid order location accepted: ${invalidOrder.status} ${invalidOrder.result?.error}`);
  }
  const invalidWaiterLocation = await request("/api/waiter-requests", "POST", { restaurantId: rid, customerName: "Smoke", tableNumber: "TEST", reason: "Help", location: null, idempotencyKey: randomUUID() });
  if (invalidWaiterLocation.status !== 400 || invalidWaiterLocation.result?.error !== "invalid_location") throw new Error(`invalid waiter location accepted: ${invalidWaiterLocation.status}`);
  console.log("missing/coarse location rejection: PASS");
  const createdOrder = await request("/api/orders", "POST", payload);
  if (createdOrder.status !== 201 || !createdOrder.result?.id) throw new Error(`customer order: ${createdOrder.status} ${createdOrder.result?.error}`);
  const orderId = createdOrder.result.id as string;
  const pushedOrderId = await Promise.race([orderEvent, new Promise<string>((_resolve, reject) => setTimeout(() => reject(new Error("realtime order insert missing")), 10_000))]);
  if (pushedOrderId !== orderId) throw new Error("realtime order ID mismatch");
  console.log("realtime order receipt: PASS");
  if (Number(createdOrder.result.totalAmount) !== 2000) throw new Error("order total mismatch");
  const duplicate = await request("/api/orders", "POST", payload);
  if (duplicate.status !== 201 || duplicate.result?.id !== orderId) throw new Error(`order idempotency: ${duplicate.status} ${duplicate.result?.error}`);
  console.log("customer order/price/idempotency: PASS");

  const waiterOrders = await waiter.from("orders").select("id,status").eq("id", orderId).single();
  checked(waiterOrders.data, waiterOrders.error, "waiter receives order");
  const preparing = await waiter.from("orders").update({ status: "preparing", approved_at: new Date().toISOString() }).eq("id", orderId).select("id,status").single();
  checked(preparing.data, preparing.error, "waiter starts order");
  const kitchenOrders = await kitchen.from("orders").select("id,status").eq("id", orderId).single();
  if (checked(kitchenOrders.data, kitchenOrders.error, "kitchen receives order").status !== "preparing") throw new Error("kitchen status mismatch");
  const ready = await kitchen.from("orders").update({ status: "ready", ready_at: new Date().toISOString() }).eq("id", orderId).select("id,status").single();
  checked(ready.data, ready.error, "kitchen completes order");
  const served = await waiter.from("orders").update({ status: "served" }).eq("id", orderId).select("id,status").single();
  checked(served.data, served.error, "waiter serves order");
  const tracked = await request(`/api/orders/${orderId}/status?token=${encodeURIComponent(trackingToken)}`);
  if (tracked.status !== 200 || tracked.result?.status !== "served") throw new Error(`customer tracking: ${tracked.status}`);
  const unauthorizedTracking = await request(`/api/orders/${orderId}/status?token=${randomUUID()}`);
  if (unauthorizedTracking.status !== 403) throw new Error("unauthorized tracking was allowed");
  console.log("waiter/kitchen/served/tracking: PASS");

  const staffOrder = await waiter.rpc("create_staff_order", { p_restaurant_id: rid, p_customer_name: "Smoke staff customer", p_table_number: "TEST", p_notes: "",
    p_items: [{ id: itemId, quantity: 1 }], p_waiter_name: "Smoke waiter", p_idempotency_key: randomUUID() });
  checked(staffOrder.data, staffOrder.error, "staff order");
  console.log("staff order: PASS");

  const waiterRequest = await request("/api/waiter-requests", "POST", { restaurantId: rid, customerName: "Smoke customer", tableNumber: "TEST", reason: "Need help",
    location: { latitude: 30.6135, longitude: 47.7524, accuracy: 100 }, idempotencyKey: randomUUID() });
  if (waiterRequest.status !== 201 || !waiterRequest.result?.id) throw new Error(`waiter request: ${waiterRequest.status} ${waiterRequest.result?.error}`);
  const receivedRequest = await waiter.from("waiter_requests").select("id,status").eq("id", waiterRequest.result.id).single();
  checked(receivedRequest.data, receivedRequest.error, "waiter receives request");
  const acceptedRequest = await waiter.from("waiter_requests").update({ status: "accepted", waiter_name: "Smoke waiter", accepted_at: Date.now() }).eq("id", waiterRequest.result.id).select("id,status").single();
  checked(acceptedRequest.data, acceptedRequest.error, "waiter accepts request");
  console.log("waiter request/receive/accept: PASS");

  const crossTenant = await waiter.from("restaurants").select("id").neq("id", rid);
  if (crossTenant.error || crossTenant.data?.length) throw new Error(`cross-tenant restaurant read: ${crossTenant.error?.message || crossTenant.data?.length}`);
  const unauthenticated = await request("/api/auth/session");
  if (unauthenticated.status !== 401) throw new Error("unauthenticated session allowed");
  console.log("cross-tenant/unauthorized access: PASS");

  const adminLogin = `${username}admin`;
  const adminUser = await admin.auth.admin.createUser({ email: `${adminLogin}@accounts.novx.invalid`, password, email_confirm: true, app_metadata: { system_role: "admin" } });
  const adminUserId = checked(adminUser.data.user?.id || null, adminUser.error, "temporary admin user");
  createdUsers.push(adminUserId);
  const adminSession = await request("/api/auth/login", "POST", { role: "admin", username: adminLogin, password });
  if (adminSession.status !== 200 || !adminSession.result?.accessToken) throw new Error(`admin login: ${adminSession.status}`);
  const apiRestaurant = await request("/api/admin/restaurants", "POST", {
    managerName: "Smoke owner", restaurantName: "Codex API smoke test", username: apiRestaurantUsername,
    startDate: new Date(Date.now() - 86_400_000).toISOString(), endDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    subscriptionType: "normal", subscriptionDuration: "month", monthlyCost: 0, totalCost: 0, status: "active", password,
  }, adminSession.result.accessToken);
  if (apiRestaurant.status !== 201 || !apiRestaurant.result?.id) throw new Error(`admin restaurant creation: ${apiRestaurant.status} ${apiRestaurant.result?.error || ""}`);
  apiRestaurantId = apiRestaurant.result.id;
  const apiOwner = await admin.from("restaurant_members").select("user_id").eq("restaurant_id", apiRestaurantId).eq("role", "owner").single();
  const apiOwnerId = checked(apiOwner.data?.user_id || null, apiOwner.error, "API owner membership");
  createdUsers.push(apiOwnerId);
  const ownerLogin = await request("/api/auth/login", "POST", { role: "restaurant", username: apiRestaurantUsername, password, restaurantId: apiRestaurantId });
  if (ownerLogin.status !== 200 || ownerLogin.result?.session?.restaurantId !== apiRestaurantId) throw new Error(`API-created owner login: ${ownerLogin.status}`);
  console.log("admin restaurant creation/owner login: PASS");

  const waiterMenuWrite = await waiter.from("menu_items").insert({ restaurant_id: rid, name: "Unauthorized waiter edit", price: 1 }).select("id").single();
  if (waiterMenuWrite.data?.id) {
    await admin.from("menu_items").delete().eq("id", waiterMenuWrite.data.id).eq("restaurant_id", rid);
    throw new Error("waiter menu write: unauthorized insert succeeded");
  } else {
    if (!waiterMenuWrite.error) throw new Error("waiter menu write: expected an RLS error");
    console.log(`waiter menu write: BLOCKED (${waiterMenuWrite.error?.code || "policy"})`);
  }

  const reset = await owner.rpc("reset_restaurant_shift", { p_restaurant_id: rid });
  if (reset.error) throw new Error(`shift reset: ${reset.error.message}`);
  const afterReset = await request("/api/orders", "POST", { ...payload, idempotencyKey: randomUUID(), trackingToken: randomUUID() });
  if (afterReset.status !== 201) throw new Error(`order after shift reset: ${afterReset.result?.error || afterReset.status}`);
  console.log("order after shift reset: PASS");

  const expired = await admin.from("restaurants").update({ end_date: new Date(Date.now() - 86_400_000).toISOString(), grace_period_days: 0 }).eq("id", rid);
  checked(true, expired.error, "expire temporary restaurant");
  const expiredMenu = await request(`/api/public/restaurants/${rid}`);
  const expiredOrder = await request("/api/orders", "POST", { ...payload, idempotencyKey: randomUUID(), trackingToken: randomUUID() });
  if (expiredMenu.status !== 403 || expiredOrder.status !== 403) throw new Error(`expired subscription access: ${expiredMenu.status}/${expiredOrder.status}`);
  console.log("expired subscription blocks menu/order: PASS");
} finally {
  if (realtimeClient) await realtimeClient.removeAllChannels();
  if (apiRestaurantId) {
    const deleted = await admin.from("restaurants").delete().eq("id", apiRestaurantId).eq("username", apiRestaurantUsername).select("id");
    console.log(`API-created restaurant cleanup: ${deleted.error ? deleted.error.message : deleted.data?.length === 1 ? "PASS" : "NOT CONFIRMED"}`);
  }
  if (restaurantId) {
    const deleted = await admin.from("restaurants").delete().eq("id", restaurantId).eq("username", username).select("id");
    console.log(`temporary restaurant cleanup: ${deleted.error ? deleted.error.message : deleted.data?.length === 1 ? "PASS" : "NOT CONFIRMED"}`);
  }
  for (const userId of createdUsers) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) console.log(`temporary user cleanup failed: ${deleted.error.message}`);
  }
  console.log(`temporary users cleanup: ${createdUsers.length} attempted`);
}
