import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { testDatabase } from "./whatsapp-test-db";

test("launch protections preserve restaurant operations and tenant boundaries", async t => {
  const db = await testDatabase();
  t.after(() => db.close());
  const restaurantId = randomUUID();
  const otherRestaurantId = randomUUID();
  const owner = randomUUID();
  const admin = randomUUID();
  const item = randomUUID();
  await db.query("insert into auth.users values ($1), ($2)", [owner, admin]);
  await db.query(`insert into public.restaurants
    (id, restaurant_name, manager_name, username, start_date, end_date, latitude, longitude)
    values ($1, 'Fixture A', 'Owner', 'launch-a', now()-interval '1 day', now()+interval '1 day', 33.3, 44.4),
           ($2, 'Fixture B', 'Owner', 'launch-b', now()-interval '1 day', now()+interval '1 day', 33.3, 44.4)`,
    [restaurantId, otherRestaurantId]);
  await db.query("insert into public.restaurant_members(restaurant_id,user_id,role) values ($1,$2,'owner')", [restaurantId, owner]);
  await db.query("insert into public.menu_items(id,restaurant_id,name,price) values ($1,$2,'Fixture item',8000)", [item, restaurantId]);

  const asUser = (id: string, isAdmin: boolean, sql: string, params: unknown[]) => db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: id, role: "authenticated", app_metadata: isAdmin ? { system_role: "admin" } : {} }),
    ]);
    return tx.query(sql, params);
  });

  await t.test("operational edits are allowed, billing and other tenants stay protected", async () => {
    const editLocation = "update public.restaurants set geofence_radius_meters=10 where id=$1 returning id";
    assert.equal((await asUser(owner, false, editLocation, [restaurantId])).rows.length, 1);
    assert.equal((await asUser(owner, false, editLocation, [otherRestaurantId])).rows.length, 0);
    const editSubscription = "update public.restaurants set end_date=end_date+interval '1 day' where id=$1 returning id";
    await assert.rejects(asUser(owner, false, editSubscription, [restaurantId]), /restaurant_settings_forbidden/);
    assert.equal((await asUser(admin, true, editSubscription, [restaurantId])).rows.length, 1);
    await db.query("update public.restaurants set geofence_radius_meters=150 where id=$1", [restaurantId]);
  });

  await t.test("guest writes are available only to the server's database role", async () => {
    const { rows } = await db.query<{ guest: boolean; staff: boolean; server: boolean }>(`
      select has_function_privilege('anon', oid, 'EXECUTE') as guest,
             has_function_privilege('authenticated', oid, 'EXECUTE') as staff,
             has_function_privilege('service_role', oid, 'EXECUTE') as server
      from pg_proc where pronamespace='public'::regnamespace
        and proname in ('create_customer_order', 'create_waiter_request', 'create_security_alert')`);
    assert.equal(rows.length, 3);
    for (const privileges of rows) assert.deepEqual(privileges, { guest: false, staff: false, server: true });
  });

  await t.test("staff read public support settings while configuration stays restricted", async () => {
    await db.exec("insert into public.app_settings(key) values('support'),('ai') on conflict do nothing");
    const settings = "select key from public.app_settings where key in ('support','ai') order by key";
    assert.deepEqual((await asUser(owner, false, settings, [])).rows, [{ key: "support" }]);
    assert.deepEqual((await asUser(admin, true, settings, [])).rows, [{ key: "ai" }, { key: "support" }]);
  });

  const asServer = (sql: string, params: unknown[]) => db.transaction(async tx => {
    await tx.exec("set local role service_role");
    return tx.query<{ result: unknown }>(sql, params);
  }).then(result => result.rows[0].result);

  await t.test("request limits use one counter across callers and preserve tenant isolation", async () => {
    const key = "9".repeat(64);
    const claim = (id: string) => asServer("select public.claim_passcode_attempt($1,$2,2,60) as result", [id, key]);
    const concurrent = await Promise.all([claim(restaurantId), claim(restaurantId), claim(restaurantId)]);
    assert.equal(concurrent.filter(Boolean).length, 2);
    assert.equal(await claim(otherRestaurantId), true);
  });

  await t.test("a retried waiter call reuses the request and queues one notification", async () => {
    const key = randomUUID();
    const request = () => asServer("select public.create_waiter_request($1,'Guest','4','Water',33.3,44.4,5,$2) as result", [restaurantId, key]);
    const [first, retry] = await Promise.all([request(), request()]);
    assert.equal(first, retry);
    const { rows } = await db.query("select id from public.waiter_requests where restaurant_id=$1", [restaurantId]);
    assert.equal(rows.length, 1);
    const queued = await db.query("select id from public.notification_outbox where restaurant_id=$1 and event_type='waiter_request'", [restaurantId]);
    assert.equal(queued.rows.length, 1);
  });

  await t.test("orders from a blocked device are rejected at the database boundary", async () => {
    const fingerprint = "fixture-blocked-device";
    await db.query("insert into public.banned_devices(restaurant_id,fingerprint,reason,banned_at) values($1,$2,'Fixture',$3)", [restaurantId, fingerprint, Date.now()]);
    const order = (client: string) => asServer(
      "select public.create_customer_order($1,'Guest','4',null,$2,33.3,44.4,5,$3,$4,$5) as result",
      [restaurantId, JSON.stringify([{ id: item, quantity: 1 }]), client, randomUUID(), randomUUID()],
    );
    await assert.rejects(order(fingerprint), /device_banned/);
    const confirmed = await order("fixture-allowed-device");
    assert.equal((confirmed as { total_amount: number }).total_amount, 8000);
  });
});
