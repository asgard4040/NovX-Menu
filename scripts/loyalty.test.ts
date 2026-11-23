import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loyaltyRouter } from "../loyalty/routes";
import { testDatabase } from "./whatsapp-test-db";

test("restaurant loyalty from guest enrollment through paid orders and single-use rewards", async t => {
  const db = await testDatabase();
  t.after(() => db.close());
  const restaurant = randomUUID(), otherRestaurant = randomUUID();
  const owner = randomUUID(), waiter = randomUUID(), kitchen = randomUUID();
  const otherOwner = randomUUID(), burger = randomUUID();
  await db.query("insert into auth.users values ($1), ($2), ($3), ($4)", [owner, waiter, kitchen, otherOwner]);
  await db.query(`insert into public.restaurants
    (id, restaurant_name, manager_name, username, start_date, end_date, latitude, longitude)
    values ($1, 'Test', 'Test', 'loyalty-a', now()-interval '1 day', now()+interval '1 day', 33.3, 44.4),
           ($2, 'Other', 'Other', 'loyalty-b', now()-interval '1 day', now()+interval '1 day', 33.3, 44.4)`,
    [restaurant, otherRestaurant]);
  await db.query(`insert into public.restaurant_members(restaurant_id,user_id,role)
    values ($1,$2,'owner'),($1,$3,'waiter'),($1,$4,'kitchen'),($5,$6,'owner')`,
    [restaurant, owner, waiter, kitchen, otherRestaurant, otherOwner]);
  await db.query("insert into public.menu_items(id,restaurant_id,name,price,is_available) values ($1,$2,'Burger',8000,true)", [burger, restaurant]);
  const configure = { enabled: true, iqdPerPoint: 1000, rewardName: "Free tea", rewardPoints: 5, rewardCostIqd: 500 };
  const staff = (id: string, action: string, data = {}, tenant = restaurant) => db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id, role: "authenticated" })]);
    return (await tx.query<any>("select public.loyalty_staff($1,$2,$3::jsonb) result", [tenant, action, JSON.stringify(data)])).rows[0].result;
  });
  const guest = (tenant: string, hash: string | null, action: string) => db.transaction(async tx => {
    await tx.exec("set local role service_role");
    return (await tx.query<any>("select public.loyalty_guest($1,$2,$3) result", [tenant, hash, action])).rows[0].result;
  });
  const client = { rpc: async (_name: string, { p_restaurant, p_token_hash, p_action }: any) => {
    try { return { data: await guest(p_restaurant, p_token_hash, p_action), error: null }; }
    catch (error) { return { data: null, error: { message: (error as Error).message } }; }
  } } as unknown as SupabaseClient;
  const app = express();
  app.use(express.json());
  app.use("/api/loyalty", loyaltyRouter(client, (_req, _res, next) => next()));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}/api/loyalty`;
  const post = (id: string, action: string, headers?: Record<string, string>) => fetch(`${origin}/${id}/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}",
  });
  let cookie = "", hash = "", claim = "";
  let firstId = "", secondId = "";
  const tracking = randomUUID();
  const orderParams = [restaurant, "Guest", "4", "private note", JSON.stringify([{ id: burger, quantity: 1, price: 10 }]),
    33.3, 44.4, 5, "private device", randomUUID(), tracking];
  const setOrderStatus = (id: string, status: string) => db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: owner, role: "authenticated" })]);
    await tx.query("update public.orders set status=$2 where id=$1", [id, status]);
  });
  const createOrder = (params: unknown[], cardHash = hash, loyalty = true) => db.transaction(async tx => {
    await tx.exec("set local role service_role");
    const fn = loyalty ? "loyalty_create_order" : "create_customer_order";
    const call = [ ...params, ...(loyalty ? [cardHash] : []) ];
    return (await tx.query<any>(`select public.${fn}(${call.map((_, i) => "$" + (i + 1)).join(",")}) result`, call)).rows[0].result;
  });

  await t.test("disabled by default and only tenant managers can configure", async () => {
    assert.deepEqual(await guest(restaurant, null, "read"), { enabled: false });
    await assert.rejects(staff(waiter, "configure", configure), /loyalty_forbidden/);
    await assert.rejects(staff(otherOwner, "configure", configure), /loyalty_forbidden/);
    await assert.rejects(staff(kitchen, "read"), /loyalty_forbidden/);
    await staff(owner, "configure", configure);
    await staff(otherOwner, "configure", configure, otherRestaurant);
  });
  await t.test("guest can opt in with a host-only, HTTP-only cookie and no account", async () => {
    const response = await post(restaurant, "join", { "X-Forwarded-Proto": "https" });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get("set-cookie")!;
    assert.match(setCookie, /^__Host-ordova_loyalty_/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    cookie = setCookie.split(";")[0];
    hash = createHash("sha256").update(cookie.slice(cookie.indexOf("=") + 1)).digest("hex");
    assert.equal((await response.json()).joined, true);
    const own = await fetch(`${origin}/${restaurant}`, { headers: { Cookie: cookie, "X-Forwarded-Proto": "https" } });
    assert.equal((await own.json()).joined, true);
    const other = await fetch(`${origin}/${otherRestaurant}`, { headers: { Cookie: cookie, "X-Forwarded-Proto": "https" } });
    assert.equal((await other.json()).joined, false);
    assert.equal((await post(restaurant, "claim", { "Sec-Fetch-Site": "same-site" })).status, 403);
    assert.equal((await post(restaurant, "claim")).status, 403);
    const repeated = await post(restaurant, "join", { Cookie: cookie, "X-Forwarded-Proto": "https" });
    assert.equal(repeated.headers.get("set-cookie"), null);
  });
  await t.test("uses existing order pricing and geofence and attaches exactly once", async () => {
    const far = [...orderParams]; far[5] = 31;
    await assert.rejects(createOrder(far), /location_rejected/);
    const order = await createOrder(orderParams);
    firstId = order.id;
    assert.equal(order.total_amount, 8000);
    assert.equal(order.loyalty_attached, true);
    assert.equal((await createOrder(orderParams)).id, firstId);
    const foreignCard = "e".repeat(64);
    const retry = await createOrder(orderParams, foreignCard);
    assert.equal(retry.loyalty_attached, false);
    const wallet = await guest(restaurant, hash, "read");
    assert.equal(wallet.orders.length, 1);
    assert.equal(wallet.orders[0].paid, false);
    assert.equal(wallet.orders[0].points, 8);
    assert.equal(wallet.balance, 0);
    assert(!JSON.stringify(wallet).includes("private note"));
    assert(!JSON.stringify(wallet).includes(tracking));
    const guestParams = [...orderParams]; guestParams[9] = randomUUID();
    const noCard = await createOrder(guestParams, hash, false);
    const retried = await createOrder(guestParams);
    assert.equal(retried.id, noCard.id);
    assert.equal(retried.loyalty_attached, false);
  });
  await t.test("only a served and staff-confirmed paid order earns points", async () => {
    await assert.rejects(staff(waiter, "confirm_paid", { orderId: firstId }), /loyalty_order_not_served/);
    await assert.rejects(staff(otherOwner, "confirm_paid", { orderId: firstId }), /loyalty_forbidden/);
    await setOrderStatus(firstId, "served");
    assert.equal((await guest(restaurant, hash, "read")).balance, 0);
    await staff(waiter, "confirm_paid", { orderId: firstId });
    await staff(waiter, "confirm_paid", { orderId: firstId });
    assert.equal((await guest(restaurant, hash, "read")).balance, 8);
    assert.equal((await guest(restaurant, hash, "read")).orders[0].paid, true);
  });
  await t.test("staff can redeem exactly once within the issuing restaurant", async () => {
    const oldClaim = await guest(restaurant, hash, "claim");
    await db.query("update public.loyalty_claims set expires_at=now()-interval '1 second' where restaurant_id=$1", [restaurant]);
    await assert.rejects(staff(waiter, "redeem", { code: oldClaim.code }), /loyalty_invalid_code/);
    const response = await post(restaurant, "claim", { Cookie: cookie, "X-Forwarded-Proto": "https" });
    assert.equal(response.status, 200);
    claim = (await response.json()).code;
    assert.match(claim, /^[\dA-F]{12}$/);
    await assert.rejects(staff(otherOwner, "redeem", { code: claim }, otherRestaurant), /loyalty_invalid_code/);
    const outcomes = await Promise.allSettled([staff(waiter, "redeem", { code: claim }), staff(waiter, "redeem", { code: claim })]);
    assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
    assert.equal((await guest(restaurant, hash, "read")).balance, 3);
    assert.equal((await staff(owner, "read")).stats.rewardCostIqd, 500);
    await assert.rejects(guest(restaurant, hash, "claim"), /loyalty_insufficient_points/);
  });
  await t.test("tracks returning customers and reverses cancelled and refunded awards", async () => {
    const secondParams = [...orderParams]; secondParams[9] = randomUUID();
    secondId = (await createOrder(secondParams)).id;
    await setOrderStatus(secondId, "served");
    await staff(waiter, "confirm_paid", { orderId: secondId });
    assert.equal((await staff(owner, "read")).stats.returningMembers, 1);
    await assert.rejects(staff(waiter, "reverse_payment", { orderId: firstId }), /loyalty_forbidden/);
    await staff(owner, "reverse_payment", { orderId: firstId });
    await staff(owner, "reverse_payment", { orderId: firstId });
    assert.equal((await guest(restaurant, hash, "read")).balance, 3);
    await setOrderStatus(secondId, "cancelled");
    assert.equal((await guest(restaurant, hash, "read")).balance, 0);
    assert.equal((await staff(owner, "read")).stats.paidOrders, 0);
  });
  await t.test("guest and staff clients cannot query raw credentials or tenant ledgers", async () => {
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(db.transaction(async tx => {
        await tx.exec(`set local role ${role}`);
        await tx.query("select token_hash from public.loyalty_cards");
      }), /permission denied/);
      await assert.rejects(db.transaction(async tx => {
        await tx.exec(`set local role ${role}`);
        await tx.query("select public.loyalty_guest($1,$2,'read')", [restaurant, hash]);
      }), /permission denied/);
    }
  });
});
