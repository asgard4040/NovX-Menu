import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { decryptPasscode, encryptPasscode, passcodeDigest, passcodeKey } from "../passcodes";
import { invitationTemplate } from "../src/lib/platform-whatsapp-templates";
import { defaultSettings } from "../whatsapp/agent";
import { defaultPolicy } from "../whatsapp/policy";
import { platformPhone, queuePlatformInvitation } from "../whatsapp/platform";
import { whatsappRouter } from "../whatsapp/routes";
import { testDatabase } from "./whatsapp-test-db";
import { fixtureClient } from "./whatsapp-test-transport";

const appId = "61be2c1e-3aa0-41c3-909d-134400000000";
const apiKey = "fake-provider-key-for-test";
const manualId = "61be2c1e-3aa0-41c3-909d-134400000001";
const inviteId = "61be2c1e-3aa0-41c3-909d-134400000002";
const renewedId = "61be2c1e-3aa0-41c3-909d-134400000003";
const expiredId = "61be2c1e-3aa0-41c3-909d-134400000004";
const unapprovedId = "61be2c1e-3aa0-41c3-909d-134400000005";
const workerSecret = "test-platform-worker-secret";

test("owner setup, tenant controls, and independent ORDOVA WhatsApp delivery", async t => {
  const db = await testDatabase();
  t.after(() => db.close());
  process.env.WHATSAPP_CREDENTIAL_KEY = randomBytes(32).toString("base64url");
  process.env.WHATSAPP_WORKER_SECRET = workerSecret;
  process.env.PASSCODE_SECRET = randomBytes(32).toString("hex");
  const users = { admin: randomUUID(), ownerA: randomUUID(), ownerB: randomUUID(), kitchen: randomUUID() };
  const a = randomUUID(), b = randomUUID(), staff = randomUUID();
  for (const id of Object.values(users)) await db.query("insert into auth.users values($1)", [id]);
  await db.query(`
    insert into public.restaurants(id,restaurant_name,manager_name,manager_phone,username,start_date,end_date)
    values($1,'One','Owner One','07700000001','one',now()-interval '1 day',now()+interval '30 days'),
          ($2,'Two','Owner Two','07700000002','two',now()-interval '1 day',now()+interval '30 days');
  `, [a, b]);
  await db.query(`insert into public.restaurant_members(restaurant_id,user_id,role)
    values($1,$3,'owner'),($2,$4,'owner'),($1,$5,'kitchen')`, [a, b, users.ownerA, users.ownerB, users.kitchen]);
  await db.query(`insert into public.staff(id,restaurant_id,auth_user_id,role,name,username,phone)
    values($1,$2,$3,'kitchen','Cook','cook','07700000003')`, [staff, a, users.kitchen]);
  const key = passcodeKey(process.env.PASSCODE_SECRET);
  for (const [id, role, pin] of [[users.ownerA, "owner", "4837"], [users.kitchen, "kitchen", "7358"]]) {
    await db.query("insert into public.staff_passcodes(restaurant_id,user_id,role,code_digest,code_ciphertext) values($1,$2,$3,$4,$5)",
      [a, id, role, passcodeDigest(pin, key), encryptPasscode(pin, key)]);
  }

  const providerCalls: { id: string; destination: string; params: string[] }[] = [];
  let nextSend: "network" | null = null;
  let onProviderSend: (id: string) => Promise<void> = async () => {};
  const bodies = new Map([
    [manualId, "Hello {{1}}, this is ORDOVA."], [inviteId, invitationTemplate.en],
    [renewedId, "Hi {{1}}, your subscription was renewed until {{2}}."],
    [expiredId, "Hi {{1}}, your subscription expired on {{2}}."],
    [unapprovedId, "Hello {{1}}, this template was rejected."],
  ]);
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.host, "api.gupshup.io");
    assert.equal(new Headers(init?.headers).get("apikey"), apiKey);
    if (url.pathname.endsWith("/business")) return Response.json({ status: "success", business: { id: appId } });
    if (url.pathname === "/wa/api/v1/template/msg") {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("source"), "9647700000099");
      assert.equal(form.get("src.name"), "OrdovaPlatform");
      providerCalls.push({ ...JSON.parse(form.get("template")!), destination: form.get("destination")! });
      if (nextSend === "network") { nextSend = null; throw new TypeError("network interrupted"); }
      const id = "gs.platform." + providerCalls.length;
      await onProviderSend(id);
      return Response.json({ status: "submitted", messageId: id });
    }
    const id = url.pathname.split("/").at(-1)!;
    const template = (id: string) => ({
      id, appId, category: "UTILITY", status: id === unapprovedId ? "REJECTED" : "APPROVED",
      templateType: "TEXT", elementName: "ordova_" + id.slice(-1), containerMeta: JSON.stringify({ data: bodies.get(id) }),
    });
    if (id === "template") return Response.json({ status: "success", templates: [...bodies.keys()].map(template) });
    assert(bodies.has(id));
    return Response.json({ status: "success", template: template(id) });
  };
  const client = fixtureClient(db, users);
  const app = express();
  app.use("/api/whatsapp", whatsappRouter(client, fetcher));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const root = "http://127.0.0.1:" + (server.address() as { port: number }).port + "/api/whatsapp";
  const api = (url = "", method = "GET", body?: unknown, user = "admin") => fetch(root + "/platform" + url, {
    method, headers: { Authorization: "Bearer " + user, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const rows = async (query: string, params: unknown[] = []) => (await db.query<any>(query, params)).rows;
  const worker = async () => {
    const response = await api("/worker", "POST", undefined, workerSecret);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).processed;
  };
  const setup = (user: string, restaurant: string, count: number, theme: string) => db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    const result = await tx.query<any>("select public.complete_owner_setup($1,$2,$3) result", [restaurant, count, theme]);
    return result.rows[0].result;
  });

  await t.test("only the restaurant owner can save setup, and later sessions preserve the first saved values", async () => {
    assert.equal((await rows("select owner_setup_completed_at from public.restaurants where id=$1", [a]))[0].owner_setup_completed_at, null);
    await assert.rejects(setup(users.ownerB, a, 5, "cafe"), /owner_required/);
    await assert.rejects(setup(users.kitchen, a, 5, "cafe"), /owner_required/);
    await assert.rejects(setup(users.ownerA, a, 501, "cafe"), /invalid_owner_setup/);
    await assert.rejects(setup(users.ownerA, a, 4, "invented"), /invalid_owner_setup/);
    assert.deepEqual(await setup(users.ownerA, a, 0, "cafe"), { tableCount: 0, themeId: "cafe", themeColors: {} });
    assert.deepEqual(await setup(users.ownerA, a, 8, "heritage"), { tableCount: 0, themeId: "cafe", themeColors: {} });
    assert((await rows("select owner_setup_completed_at from public.restaurants where id=$1", [a]))[0].owner_setup_completed_at);
  });

  await t.test("sender is admin-only, encrypted, and cannot reuse a restaurant number", async () => {
    const credentials = { appId, apiKey, appName: "OrdovaPlatform", source: "07700000099" };
    assert.equal(platformPhone("٠٧٧٠٠٠٠٠٠٩٩"), "9647700000099");
    assert.equal(platformPhone("++9647700000099"), null);
    assert.equal((await api("", "GET", undefined, "ownerA")).status, 403);
    assert.equal((await api("/connection", "PUT", credentials, "ownerA")).status, 403);
    assert.equal((await api("/worker", "POST")).status, 401);
    const connect = await api("/connection", "PUT", credentials);
    assert.equal(connect.status, 200, await connect.clone().text());
    assert.equal((await api("/connection/test", "POST")).status, 200);
    const response = await (await api()).text();
    assert(!response.includes(apiKey), response);
    assert(!response.includes("key_ciphertext"), response);
    assert.notEqual((await rows("select key_ciphertext from public.platform_whatsapp_sender"))[0].key_ciphertext, apiKey);
    await assert.rejects(db.transaction(async tx => {
      await tx.exec("set local role authenticated");
      await tx.query("select key_ciphertext from public.platform_whatsapp_sender");
    }), { code: "42501" });
    await assert.rejects(db.query(`insert into public.whatsapp_accounts(restaurant_id,phone_id,waba_id,display_phone,status)
      values($1,'22222','33333','+964 770 0000099','connecting')`, [a]), /platform_sender_already_in_use/);
  });

  await t.test("owner preference updates preserve admin-only AI limits and redact them in the response", async () => {
    const endpoint = root + "/restaurants/" + a;
    const limits = { daily_ai_limit: 37, ai_policy: { ...defaultPolicy, monthly_budget_usd: 5 } };
    const write = (path: string, body: object, user: string) => fetch(endpoint + path, {
      method: "PUT", headers: { Authorization: "Bearer " + user, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal((await write("/limits", limits, "ownerA")).status, 403);
    assert.equal((await write("/limits", limits, "admin")).status, 200);
    const changed = await write("/settings", { ...defaultSettings, welcome: "Welcome", daily_ai_limit: 499,
      ai_policy: { ...defaultPolicy, monthly_budget_usd: 999 } }, "ownerA");
    assert.equal(changed.status, 200);
    const saved = (await changed.json()).settings;
    assert.equal(saved.welcome, "Welcome");
    assert.equal(saved.ai_policy, undefined);
    assert.equal(saved.daily_ai_limit, undefined);
    assert.deepEqual((await rows("select daily_ai_limit,ai_policy from public.whatsapp_settings where restaurant_id=$1", [a]))[0], limits);
  });

  const input = (id: string, destinations: string[], requestId?: string) => ({ templateId: id, restaurants: destinations, ...(requestId ? { requestId } : {}) });
  const callback = new URL((await (await api()).json()).sender.callback);
  const event = (kind: string, payload: unknown, token = callback.searchParams.get("token")!, appName = "OrdovaPlatform") =>
    fetch(root + "/platform/webhook?" + new URLSearchParams({ token }), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app: appName, timestamp: Date.now(), version: 2, type: kind, payload }),
    });

  await t.test("manual preview reads a verified template and bulk queue is idempotent", async () => {
    assert.equal((await api("/manual", "POST", input(manualId, [a]))).status, 409);
    assert.equal((await api("/templates", "PUT", { invite: unapprovedId })).status, 422);
    assert.equal((await api("/templates", "PUT", { invite: inviteId, renewed: renewedId, expired: expiredId })).status, 200);
    assert.deepEqual((await (await api("/templates")).json()).templates.map((template: any) => template.id), [manualId]);
    for (const restaurant of [a, b]) assert.equal((await api("/receivers/" + restaurant, "PUT", { allowed: true })).status, 200);
    const draft = await api("/manual", "POST", input(manualId, [a, b]));
    assert.equal(draft.status, 200, await draft.clone().text());
    const preview = await draft.json();
    assert.equal(preview.count, 2);
    assert.equal(preview.excluded, 0);
    assert.match(preview.sample, /One|Two/);
    const id = randomUUID();
    assert.deepEqual(await (await api("/manual", "POST", input(manualId, [a, b], id))).json(), { count: 2, queued: 2 });
    assert.deepEqual(await (await api("/manual", "POST", input(manualId, [a, b], id))).json(), { count: 2, queued: 0 });
    assert.equal((await event("message-event", { type: "delivered", gsId: "gs.platform.1" }, "wrong-token")).status, 401);
    assert.equal((await event("message-event", { type: "delivered", gsId: "gs.platform.1" }, undefined, "Imposter")).status, 401);
    // Delivery status may arrive before Gupshup returns a send identifier.
    onProviderSend = async id => {
      assert.equal((await event("message-event", { type: "delivered", gsId: id })).status, 200);
    };
    const processed = await Promise.all([worker(), worker()]);
    assert.equal(processed.reduce((total, count) => total + count, 0), 2);
    assert.equal(providerCalls.length, 2);
    assert.deepEqual(new Set(providerCalls.map(call => call.destination)), new Set(["9647700000001", "9647700000002"]));
    await event("message-event", { type: "sent", gsId: "gs.platform.1" });
    assert.deepEqual((await rows("select state from public.platform_whatsapp_outbox where kind='manual'")).map(row => row.state), ["delivered", "delivered"]);
    onProviderSend = async () => {};
  });

  await t.test("owner and staff receive different portal links and PINs never enter the history", async () => {
    for (const [userId, phone] of [[users.ownerA, "07700000001"], [users.kitchen, "07700000003"]]) {
      const options = { restaurantId: a, userId, actorId: users.admin, phone };
      assert.equal(await queuePlatformInvitation(client, options), "queued");
      assert.equal(await queuePlatformInvitation(client, options), "queued");
    }
    assert.equal(await worker(), 2);
    const invites = providerCalls.filter(call => call.id === inviteId);
    for (const [number, portal, pin] of [["9647700000001", "restaurant", "4837"], ["9647700000003", "kitchen", "7358"]]) {
      const sent = invites.find(call => call.destination === number)!;
      assert.equal(new URL(sent.params[1]).searchParams.get("portal"), portal);
      assert.equal(new URL(sent.params[1]).searchParams.get("loginRestaurantId"), a);
      assert.equal(sent.params[2], pin);
    }
    const history = await (await api()).text();
    assert(!history.includes("4837") && !history.includes("7358") && !history.includes("9647700000003"));
    assert.equal(decryptPasscode((await rows("select code_ciphertext from public.staff_passcodes where user_id=$1", [users.ownerA]))[0].code_ciphertext, key), "4837");
  });

  await t.test("STOP, grace, renewal and expiry are checked at dispatch", async () => {
    assert.equal((await event("message", { type: "text", sender: { phone: "9647700000002" }, payload: { text: "STOP" } })).status, 200);
    assert.equal((await api("/manual", "POST", input(manualId, [b]))).status, 409);
    await db.query("update public.restaurants set end_date=end_date+interval '30 days' where id=$1", [a]);
    assert.equal(await worker(), 1);
    assert.equal(providerCalls.at(-1)?.id, renewedId);
    assert.equal(await worker(), 0);
    // Expiry occurs after the grace period, even if the base date is past.
    await db.query("update public.restaurants set end_date=now()-interval '1 hour', grace_period_days=1 where id=$1", [a]);
    assert.equal(await worker(), 0);
    await db.query("update public.platform_whatsapp_consents set granted_at=now()-interval '2 days' where restaurant_id=$1", [a]);
    await db.query("update public.restaurants set grace_period_days=0 where id=$1", [a]);
    assert.equal(await worker(), 1);
    assert.equal(providerCalls.at(-1)?.id, expiredId);
    assert.equal(await worker(), 0);

    const updated = await api("/manual", "POST", input(manualId, [a], randomUUID()));
    assert.equal(updated.status, 200);
    await db.query("update public.restaurants set manager_phone='07700000009' where id=$1", [a]);
    assert.equal(await worker(), 1);
    assert.equal((await rows("select state,reason from public.platform_whatsapp_outbox order by created_at desc limit 1"))[0].reason, "consent_missing");
    assert.equal((await api("/manual", "POST", input(manualId, [a]))).status, 409);
  });

  await t.test("a network failure is marked uncertain and never resubmitted", async () => {
    assert.equal((await api("/receivers/" + a, "PUT", { allowed: true })).status, 200);
    assert.equal((await api("/manual", "POST", input(manualId, [a], randomUUID()))).status, 200);
    nextSend = "network";
    const before = providerCalls.length;
    assert.equal(await worker(), 1);
    assert.equal((await rows("select state from public.platform_whatsapp_outbox order by created_at desc limit 1"))[0].state, "uncertain");
    assert.equal(await worker(), 0);
    assert.equal(providerCalls.length, before + 1);
  });

  await t.test("managed renewals notify once and supersede an already-queued expiry", async () => {
    assert.equal((await api("/receivers/" + b, "PUT", { allowed: true })).status, 200);
    const plan = randomUUID();
    await db.query("insert into public.saas_plans(id,name,version,currency,monthly_price,effective_at) values($1,'Managed',1,'IQD',5000,now())", [plan]);
    const [previous] = await rows(
      "insert into public.saas_subscriptions(restaurant_id,plan_id,status,period_start,period_end,price,currency) values($1,$2,'active',now()-interval '1 day',now()+interval '29 days',5000,'IQD') returning period_end",
      [b, plan]);
    await db.query("insert into public.platform_whatsapp_outbox(restaurant_id,user_id,kind,event_key,period_end) values($1,$2,'expired','stale-expiry',$3)",
      [b, users.ownerB, previous.period_end]);
    await db.query("update public.saas_subscriptions set period_end=period_end+interval '30 days' where restaurant_id=$1", [b]);
    const before = providerCalls.length;
    assert.equal(await worker(), 2);
    assert.equal(providerCalls.length, before + 1);
    assert.equal(providerCalls.at(-1)?.id, renewedId);
    assert.deepEqual((await rows("select state, reason from public.platform_whatsapp_outbox where event_key='stale-expiry'"))[0],
      { state: "skipped", reason: "subscription_changed" });
    assert.equal(await worker(), 0);
  });
});
