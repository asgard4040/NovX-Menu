import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from './whatsapp-test-db';
const a='92000000-0000-0000-0000-000000000001',b='92000000-0000-0000-0000-000000000002';
test('managed lifecycle, recurring accruals and verified gateway reconciliation',async t=>{
 const db=await testDatabase();t.after(()=>db.close());
 const admin=async()=>{await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',app_metadata:{system_role:'admin'}})]);};
 const service=async()=>{await db.exec('reset role;set role service_role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'service_role'})]);};
 const cmd=async(action:string,data:any)=>(await db.query<any>('select public.saas_admin_command($1,$2) result',[action,JSON.stringify(data)])).rows[0].result;
 const report=async(start:string,end:string)=>(await db.query<any>('select public.saas_admin_report($1,$2,null,0) result',[start,end])).rows[0].result;
 await db.query(`insert into public.restaurants(id,restaurant_name,manager_name,username,start_date,end_date) values($1,'A','A','life-a',now()-interval '1 year',now()-interval '1 day'),($2,'B','B','life-b',now()-interval '1 year',now()-interval '1 day')`,[a,b]);
 await admin();const plan=await cmd('plan',{name:'Life',version:1,currency:'IQD',monthly_price:100,effective_at:'2025-01-01'});
 const assign=async(rid=a,status='active',from='2026-01-01T00:00:00+03:00',to='2026-02-01T00:00:00+03:00',more:any={})=>cmd('assign',{restaurant_id:rid,plan_id:plan.id,status,period_start:from,period_end:to,...more});
 await t.test('explicit admin assignment synchronizes operational access without recording payment',async()=>{
  const from=new Date(Date.now()-60000).toISOString(),to=new Date(Date.now()+86400000).toISOString();await assign(a,'active',from,to);
  await db.exec('reset role');assert.equal((await db.query<any>('select public.restaurant_subscription_active($1) allowed',[a])).rows[0].allowed,true);
  assert.equal((await db.query('select * from public.saas_payments')).rows.length,0);await admin();
 });
 await t.test('suspension denies access and explicit reactivation restores it',async()=>{
  const from=new Date(Date.now()-60000).toISOString(),to=new Date(Date.now()+86400000).toISOString();await assign(a,'suspended',from,to);
  await db.exec('reset role');assert.equal((await db.query<any>('select public.restaurant_subscription_active($1) allowed',[a])).rows[0].allowed,false);await admin();await assign(a,'active',from,to);
 });
 await t.test('month-end accruals preview and post once using historical FX',async()=>{
  await cmd('fx',{effective_date:'2026-01-01',iqd_per_usd:1300});await cmd('fx',{effective_date:'2026-02-01',iqd_per_usd:1400});
  const rule=await cmd('recurring',{category:'hosting',vendor:'Example',description:'Signed monthly contract',amount:10,currency:'USD',cost_class:'operating',starts_on:'2026-01-31',ends_on:'2026-03-31',frequency:'month',evidence_reference:'contract-1'});
  const preview=await cmd('preview_recurring',{through:'2026-03-31'});assert.deepEqual(preview.map((x:any)=>x.due_date),['2026-01-31','2026-02-28','2026-03-31']);
  assert.equal((await db.query('select * from public.saas_expenses')).rows.length,0);
  assert.equal((await cmd('post_recurring',{through:'2026-03-31'})).posted,3);assert.equal((await cmd('post_recurring',{through:'2026-03-31'})).posted,0);
  const rows=(await db.query<any>('select expense_date,fx from public.saas_expenses order by expense_date')).rows;assert.deepEqual(rows.map(x=>Number(x.fx)),[1300,1400,1400]);
  await cmd('pause_recurring',{id:rule.id,active:false});assert.equal((await cmd('preview_recurring',{through:'2026-04-30'})).length,0);
 });
 await t.test('yearly leap-day anchoring and missing FX roll back the whole posting',async()=>{
  await cmd('recurring',{category:'domains',vendor:'Example',description:'Annual contract',amount:10,currency:'USD',cost_class:'operating',starts_on:'2024-02-29',ends_on:'2025-02-28',frequency:'year',evidence_reference:'contract-2'});
  const preview=await cmd('preview_recurring',{through:'2025-02-28'});assert.deepEqual(preview.map((x:any)=>x.due_date),['2024-02-29','2025-02-28']);
  const n=(await db.query('select * from public.saas_expenses')).rows.length;await assert.rejects(cmd('post_recurring',{through:'2025-02-28'}),/exchange_rate_required/);assert.equal((await db.query('select * from public.saas_expenses')).rows.length,n);
 });
 await t.test('partial expense settlements preserve accrual history and separate cash dates',async()=>{
  const expense=(await db.query<any>('select * from public.saas_expenses order by expense_date limit 1')).rows[0];
  const data={expense_id:expense.id,amount:4,paid_at:'2026-04-05T00:00:00+03:00',reference:'settle-1',method:'cash'};const first=await cmd('expense_payment',data);assert.equal((await cmd('expense_payment',data)).id,first.id);
  await assert.rejects(cmd('expense_payment',{...data,reference:'over',amount:7}),/invalid_expense_payment/);
  const april=await report('2026-04-01','2026-04-30');assert.equal(Number(april.cash_expenses),5200);assert.equal(Number(april.operating_cost),0);
  assert.equal(Number((await report('2026-01-01','2026-01-31')).operating_cost),13000);
 });
 await t.test('expense refunds are correction records bounded by the original payment',async()=>{
  const original=(await db.query<any>("select * from public.saas_expense_settlements where reference='settle-1'")).rows[0];
  const data={expense_id:original.expense_id,refund_of:original.id,amount:-2,paid_at:'2026-04-06T00:00:00+03:00',reference:'refund-exp-1',method:'vendor_refund'};
  await cmd('expense_payment',data);assert.equal(Number((await report('2026-04-01','2026-04-30')).cash_expenses),2600);
  await assert.rejects(cmd('expense_payment',{...data,reference:'refund-exp-over',amount:-3}),/invalid_expense_refund/);
 });
 await t.test('unallocated legacy gateway cash can be allocated once without double-counting',async()=>{
  await service();await db.query(`insert into public.subscription_payments(reference_id,restaurant_id,amount_iqd,environment,duration,webhook_secret,status,paid_at) values('legacy-receipt',$1,50,'live','month','mock','paid','2026-04-15T00:00:00+03:00')`,[b]);await admin();
  await assign(b,'active','2026-04-01T00:00:00+03:00','2026-05-01T00:00:00+03:00');const inv=await cmd('invoice',{restaurant_id:b});
  const before=await report('2026-04-01','2026-04-30');assert.equal(Number(before.total_collected),50);
  const receipt=await cmd('reconcile_wayl',{invoice_id:inv.id,gateway_reference:'legacy-receipt'});assert.equal((await cmd('reconcile_wayl',{invoice_id:inv.id,gateway_reference:'legacy-receipt'})).id,receipt.id);
  const after=await report('2026-04-01','2026-04-30');assert.equal(Number(after.total_collected),50);assert.equal(Number(after.gateway_collected),0);
  await assert.rejects(cmd('payment',{invoice_id:inv.id,amount:50,reference:'wayl:duplicate',method:'WAYL'}),/use_gateway_reconciliation/);
 });
 await t.test('managed checkout terms are snapshotted; verified live payment renews and reconciles once',async()=>{
  await assign(a);await service();const quote=(await db.query<any>('select public.saas_gateway_quote($1) result',[a])).rows[0].result;
  assert.equal(Number(quote.amount),100);
  await db.query(`insert into public.subscription_payments(reference_id,restaurant_id,amount_iqd,environment,duration,webhook_secret,saas_snapshot) values('managed-receipt',$1,100,'live','month','mock',$2)`,[a,quote.snapshot]);
  assert.equal((await db.query<any>("select public.apply_paid_subscription('managed-receipt') result")).rows[0].result,true);
  assert.equal((await db.query<any>("select public.apply_paid_subscription('managed-receipt') result")).rows[0].result,false);
  const sub=(await db.query<any>('select * from public.saas_subscriptions where restaurant_id=$1',[a])).rows[0];assert(new Date(sub.period_end).getTime()>Date.now());
  assert.equal((await db.query("select * from public.saas_payments where gateway_reference='managed-receipt'")).rows.length,1);
  await admin();
 });
 await t.test('stale gateway quotes cannot create checkout records',async()=>{
  await service();await assert.rejects(db.query(`insert into public.subscription_payments(reference_id,restaurant_id,amount_iqd,environment,duration,webhook_secret,saas_snapshot) values('wrong-price',$1,1,'live','month','mock','{}')`,[a]),/checkout_terms_changed/);await admin();
 });
 await t.test('cancelled agreement is not reactivated by a late verified payment',async()=>{
  await service();const quote=(await db.query<any>('select public.saas_gateway_quote($1) result',[a])).rows[0].result;
  await db.query(`insert into public.subscription_payments(reference_id,restaurant_id,amount_iqd,environment,duration,webhook_secret,saas_snapshot) values('late-receipt',$1,100,'live','month','mock',$2)`,[a,quote.snapshot]);await admin();
  const sub=(await db.query<any>("select public.saas_admin_list('subscriptions',0) result")).rows[0].result.find((r:any)=>r.restaurant_id===a);
  await assign(a,'cancelled',sub.period_start,sub.period_end);await service();await db.query("select public.apply_paid_subscription('late-receipt')");
  assert.equal((await db.query<any>('select public.restaurant_subscription_active($1) allowed',[a])).rows[0].allowed,false);
  assert.equal((await db.query("select * from public.saas_payments where gateway_reference='late-receipt'")).rows.length,0);await admin();
 });
 await t.test('owner access to new write and scheduling helpers is denied',async()=>{
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',app_metadata:{system_role:'restaurant'}})]);
  await assert.rejects(cmd('post_recurring',{through:'2026-03-31'}),/admin_required/);await assert.rejects(db.query("select public.saas_materialize_expenses('2026-03-31')"),/permission denied/);await assert.rejects(db.query('select public.saas_gateway_quote($1)',[a]),/permission denied/);
  assert.equal((await db.query('select * from public.saas_recurring_expenses')).rows.length,0);
 });
});
