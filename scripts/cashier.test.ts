import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { testDatabase } from "./whatsapp-test-db";
import { buildFloor, moveTable } from "../src/lib/floor-plan";
import { staffPortalUrl } from "../src/lib/public-urls";

test("layout retains saved positions when table count changes", () => {
  const floor = buildFloor(3, [{ table: 2, slot: 10, shape: "rect" }, { table: 6, slot: 0, shape: "square" }]);
  assert.deepEqual(floor, [
    { table: 1, slot: 0, shape: "round" }, { table: 2, slot: 10, shape: "rect" },
    { table: 3, slot: 1, shape: "round" },
  ]);
  assert.deepEqual(moveTable(floor, 2, 0).map(placement => placement.slot), [10, 0, 1]);
  assert.deepEqual(moveTable(floor, 2, 11).map(placement => placement.slot), [0, 11, 1]);
  assert.equal(new URL(staffPortalUrl("venue", "cashier")).searchParams.get("portal"), "cashier");
});

test("cashier floor, menu orders, kitchen handoff and statistics use the existing tenant workflow", async t => {
  const db = await testDatabase();
  t.after(() => db.close());
  const restaurant = randomUUID(), other = randomUUID(), owner = randomUUID();
  const cashier = randomUUID(), waiter = randomUUID(), kitchen = randomUUID(), product = randomUUID();
  await db.query("insert into auth.users values ($1),($2),($3),($4)", [owner, cashier, waiter, kitchen]);
  await db.query(`insert into public.restaurants
    (id,restaurant_name,manager_name,username,table_count,start_date,end_date,latitude,longitude)
    values($1,'Test','Test','cashier-qa',3,now()-interval '1 day',now()+interval '1 day',33.3,44.4),
    ($2,'Other','Other','cashier-qa-other',2,now()-interval '1 day',now()+interval '1 day',33.3,44.4)`, [restaurant, other]);
  await db.query(`insert into public.restaurant_members(restaurant_id,user_id,role)
    values($1,$2,'owner'),($1,$3,'cashier'),($1,$4,'waiter'),($1,$5,'kitchen')`, [restaurant, owner, cashier, waiter, kitchen]);
  await db.query("insert into public.staff(restaurant_id,auth_user_id,role,name,username) values($1,$2,'cashier','Cashier','cashier-qa-staff')", [restaurant, cashier]);
  await db.query("insert into public.menu_items(id,restaurant_id,name,price,has_cheese,cheese_price) values($1,$2,'Burger',8000,true,1000)", [product, restaurant]);
  const run = (user: string | null, sql: string, params: unknown[]) => db.transaction(async tx => {
    await tx.exec(user ? "set local role authenticated" : "set local role service_role");
    if (user) await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    return tx.query<any>(sql, params);
  });
  const staffOrder = (user: string, table: string, key = randomUUID(), venue = restaurant, spicy = false) =>
    run(user, "select public.create_cashier_order($1,$2,'Guest','No onion',$3,$4) result",
      [venue, table, JSON.stringify([{ id: product, quantity: 2, price: 10, cheeseSelected: true, spicySelected: spicy }]), key]);

  await t.test("cashier can read the owner's layout, with tenant isolation and validated placement", async () => {
    const write = "insert into public.restaurant_table_layouts values($1,$2::jsonb)";
    const map = JSON.stringify([{ table: 1, slot: 2, shape: "round" }, { table: 2, slot: 4, shape: "rect" }]);
    await assert.rejects(run(cashier, write, [restaurant, map]), /row-level security/);
    await assert.rejects(run(owner, write, [restaurant, JSON.stringify([{ table: 1, slot: 0, shape: "circle" }])]), /invalid_table_layout/);
    await run(owner, write, [restaurant, map]);
    assert.deepEqual((await run(cashier, "select placements from public.restaurant_table_layouts where restaurant_id=$1", [restaurant])).rows[0].placements, JSON.parse(map));
    assert.equal((await run(cashier, "select placements from public.restaurant_table_layouts where restaurant_id=$1", [other])).rows.length, 0);
    await assert.rejects(run(cashier, "select public.cashier_snapshot($1)", [other]), /cashier_required/);
  });

  await t.test("direct orders use verified prices and send one notification through the kitchen queue", async () => {
    await assert.rejects(staffOrder(waiter, "1"), /cashier_required/);
    await assert.rejects(staffOrder(cashier, "99"), /invalid_table/);
    await assert.rejects(staffOrder(cashier, "1", randomUUID(), restaurant, true), /invalid_menu_item/);
    const key = randomUUID();
    const first = (await staffOrder(cashier, "counter", key)).rows[0].result;
    const retry = (await staffOrder(cashier, "counter", key)).rows[0].result;
    assert.deepEqual(first, retry);
    const kitchenQueue = await run(kitchen, "select status,total_amount,notes from public.orders where id=$1", [first.id]);
    assert.deepEqual(kitchenQueue.rows[0], { status: "preparing", total_amount: "18000.00", notes: "No onion" });
    const events = await db.query<{ event_type: string }>("select event_type from public.notification_outbox where payload->>'order_id'=$1", [first.id]);
    assert.deepEqual(events.rows.map(row => row.event_type), ["kitchen_order"]);
  });

  await t.test("cashier approves the digital menu order and tracks the table through service", async () => {
    const menu = (await run(null, "select public.create_customer_order($1,'Ali','3',null,$2,33.3,44.4,5,'fixture',$3,$4) result",
      [restaurant, JSON.stringify([{ id: product, quantity: 1 }]), randomUUID(), randomUUID()])).rows[0].result;
    const read = () => run(cashier, "select public.cashier_snapshot($1) result", [restaurant]).then(result => result.rows[0].result);
    let data = await read();
    const incoming = data.orders.find((order: { id: string }) => order.id === menu.id);
    assert.equal(incoming.source, "menu");
    assert.equal(incoming.tableNumber, "3");
    assert.equal(incoming.customerName, "Ali");
    await assert.rejects(run(cashier, "update public.orders set status='served' where id=$1", [menu.id]), /invalid_cashier_transition/);
    await assert.rejects(run(cashier, "update public.orders set total_amount=1,status='preparing' where id=$1", [menu.id]), /immutable_order_fields|invalid_cashier_transition/);
    const approve = () => run(cashier, "update public.orders set status='preparing' where id=$1 and status='pending' returning id", [menu.id]);
    assert.equal((await approve()).rows.length, 1);
    assert.equal((await approve()).rows.length, 0);
    await run(kitchen, "update public.orders set status='ready' where id=$1", [menu.id]);
    await run(cashier, "update public.orders set status='served' where id=$1", [menu.id]);
    data = await read();
    assert.equal(data.orders.some((order: { id: string }) => order.id === menu.id), false);
    assert.deepEqual(data.stats, { total: 2, served: 1, servedValue: 8000 });
    await assert.rejects(run(cashier, "select public.reset_restaurant_shift($1)", [restaurant]), /unauthorized/);
    assert.equal((await run(owner, "select public.reset_restaurant_shift($1) count", [restaurant])).rows[0].count, 2);
  });
});
