import test from 'node:test';
import assert from 'node:assert/strict';
import {interpret, requestReservation} from '../whatsapp/agent';
import {testDatabase} from './whatsapp-test-db';
const a='91000000-0000-0000-0000-000000000001', b='91000000-0000-0000-0000-000000000002';
test('SaaS accounting, authorization and billing invariants',async t=>{
 const db=await testDatabase();t.after(()=>db.close());
 await db.exec(`insert into public.restaurants(id,restaurant_name,manager_name,username,start_date,end_date) values('${a}','A','A','saas-a',now()-interval '1 month',now()+interval '1 month'),('${b}','B','B','saas-b',now()-interval '1 month',now()+interval '1 month');`);
 const claims=async(admin=true)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',app_metadata:{system_role:admin?'admin':'restaurant'}})]);};
 const cmd=async(action:string,data:any)=>(await db.query<any>('select public.saas_admin_command($1,$2::jsonb) result',[action,JSON.stringify(data)])).rows[0].result;
 const report=async(start='2026-01-01',end='2026-01-31',restaurant:string|null=null)=>(await db.query<any>('select public.saas_admin_report($1,$2,$3,0) result',[start,end,restaurant])).rows[0].result;
 let plan:any,inv:any,payment:any;
 await t.test('owners cannot call administrative functions or read financial tables',async()=>{
  await claims(false);await assert.rejects(cmd('fx',{effective_date:'2026-01-01',iqd_per_usd:1300}),/admin_required/);
  await assert.rejects(report(),/admin_required/);assert.equal((await db.query('select * from public.saas_invoices')).rows.length,0);
 });
 await claims();
 await t.test('create immutable plan versions with flexible limits',async()=>{
  plan=await cmd('plan',{name:'Test',version:1,currency:'USD',monthly_price:'100',effective_at:'2025-01-01',limits:{conversations:50},overage_rate:'2'});
  assert.equal(Number(plan.monthly_price),100);
  await assert.rejects(db.query("update public.saas_plans set monthly_price=1 where id=$1",[plan.id]),/permission denied/);
  await assert.rejects(cmd('plan',{name:'Bad',version:1,currency:'USD',monthly_price:1,effective_at:'2025-01-01',limits:{conversations:-1}}),/invalid_limits/);
 });
 await t.test('assign a subscription without manufacturing a payment',async()=>{
  await cmd('assign',{restaurant_id:a,plan_id:plan.id,status:'active',period_start:'2026-01-01T00:00:00+03:00',period_end:'2026-02-01T00:00:00+03:00'});
  assert.equal((await db.query('select * from public.saas_payments')).rows.length,0);
 });
 await t.test('missing FX fails closed',async()=>{await assert.rejects(cmd('invoice',{restaurant_id:a,due_at:'2026-02-05Z'}),/exchange_rate_required/);});
 await t.test('effective FX and invoice snapshot',async()=>{
  await cmd('fx',{effective_date:'2026-01-01',iqd_per_usd:'1300'});
  inv=await cmd('invoice',{restaurant_id:a,due_at:'2026-02-05Z',tax:'10'});assert.equal(Number(inv.total),110);assert.equal(Number(inv.fx),1300);
  // Historical fixture only: simulate issuance in January, not backdate a production command.
  await db.exec("reset role; alter table public.saas_invoices disable trigger immutable; update public.saas_invoices set issued_at='2026-01-01T00:00:00+03:00'; alter table public.saas_invoices enable trigger immutable;");await claims();
  assert.equal((await cmd('invoice',{restaurant_id:a,due_at:'2026-02-05Z'})).id,inv.id);
 });
 await t.test('earned revenue excludes tax; unpaid invoices are not cash',async()=>{
  const r=await report();assert.equal(Number(r.earned),130000);assert.equal(Number(r.receivable),143000);assert.equal(Number(r.manual_collected),0);
  assert.equal(r.series.length,31);assert(Math.abs(r.series.reduce((sum:number,d:any)=>sum+Number(d.earned),0)-130000)<0.001);
 });
 await t.test('partial payment and idempotent retry',async()=>{
  payment=await cmd('payment',{invoice_id:inv.id,amount:40,paid_at:'2026-01-10Z',reference:'cash-1',method:'cash'});
  assert.equal((await cmd('payment',{invoice_id:inv.id,amount:40,paid_at:'2026-01-10Z',reference:'cash-1',method:'cash'})).id,payment.id);
  const r=await report();assert.equal(Number(r.manual_collected),52000);assert.equal(Number(r.receivable),91000);
 });
 await t.test('overpayment and conflicting references rejected',async()=>{
  await assert.rejects(cmd('payment',{invoice_id:inv.id,amount:80,method:'cash',reference:'over'}),/invalid_payment/);
  await assert.rejects(cmd('payment',{invoice_id:inv.id,amount:20,method:'cash',reference:'cash-1'}),/payment_reference_conflict/);
 });
 await t.test('refunds are bounded and do not erase payment history',async()=>{
  await cmd('payment',{invoice_id:inv.id,amount:-10,paid_at:'2026-01-11Z',method:'cash',reference:'refund-1',refund_of:payment.id});
  await assert.rejects(cmd('payment',{invoice_id:inv.id,amount:-40,method:'cash',reference:'refund-2',refund_of:payment.id}),/invalid_refund/);
  assert.equal(Number((await report()).manual_collected),39000);
 });
 await t.test('later exchange rates do not rewrite historical invoices',async()=>{
  await cmd('fx',{effective_date:'2026-02-01',iqd_per_usd:'1500'});assert.equal(Number((await report()).earned),130000);
 });
 await t.test('expenses accrue separately from cash and reconcile contribution',async()=>{
  await cmd('expense',{restaurant_id:a,category:'gupshup',vendor:'Test vendor',description:'verified invoice',amount:10,currency:'USD',expense_date:'2026-01-15',cost_class:'direct',source_reference:'bill-1'});
  const r=await report();assert.equal(Number(r.direct_cost),13000);assert.equal(Number(r.cash_expenses),0);assert.equal(Number(r.gross_profit),117000);
  assert.equal(Number(r.profitability.find((p:any)=>p.id===a).attributable_cost),13000);
  await assert.rejects(cmd('expense',{category:'gupshup',vendor:'Test',description:'same invoice',amount:10,currency:'USD',expense_date:'2026-01-15',cost_class:'direct',source_reference:'bill-1'}),/unique/);
 });
 await t.test('restaurant report excludes other tenants',async()=>{const r=await report('2026-01-01','2026-01-31',b);assert.equal(Number(r.earned),0);assert.equal(r.profitability.length,1);assert.equal(r.profitability[0].id,b);});
 await t.test('bounded report windows and paginated reads',async()=>{
  await assert.rejects(report('2020-01-01','2026-01-01'),/invalid_period/);
  const rows=(await db.query<any>("select public.saas_admin_list('invoices',0) result")).rows[0].result;assert.equal(rows.length,1);assert.equal(Number(rows[0].paid),30);
 });
 await t.test('audit is immutable and contains sensitive action history',async()=>{
  assert((await db.query('select id from public.saas_audit')).rows.length>=7);
  await assert.rejects(db.exec('delete from public.saas_audit'),/permission denied/);
 });
 await t.test('cancelled subscriptions cannot generate invoices',async()=>{
  await cmd('assign',{restaurant_id:b,plan_id:plan.id,status:'cancelled',period_start:'2026-01-01T00:00:00+03:00',period_end:'2026-02-01T00:00:00+03:00'});
  await assert.rejects(cmd('invoice',{restaurant_id:b}),/subscription_not_billable/);
 });
 await t.test('AI admin controls are persisted into the existing runtime settings',async()=>{
  await db.exec('reset role');await db.query('insert into public.whatsapp_settings(restaurant_id) values($1)',[a]);await claims();
  await cmd('ai',{restaurant_id:a,enabled:true,daily_ai_limit:100,monthly_budget_usd:5,customer_rpm:6});
  const model=await cmd('model',{restaurant_id:a,model:'gpt-6-luna',input_rate:0.1,cached_rate:0.01,output_rate:0.5,max_output_tokens:1000,timeout_ms:8000});assert.equal(model.model,'gpt-6-luna');
  await assert.rejects(cmd('model',{restaurant_id:a,model:'bad',input_rate:-1,cached_rate:0,output_rate:1,max_output_tokens:1000,timeout_ms:8000}),/invalid_model_config/);
 });
 await t.test('sessions and AI reservations enforce plan caps and explicit overrides',async()=>{
  await db.exec('reset role');
  await db.query(`insert into public.whatsapp_accounts(restaurant_id,phone_id,waba_id,display_phone,status,subscribed) values($1,'12345678','12345678','+9647700000000','connected',true)`,[a]);
  const conversations=(await db.query<any>(`insert into public.whatsapp_conversations(restaurant_id,phone_id,customer_id,last_inbound_at) values($1,'12345678','9647700000001',now()),($1,'12345678','9647700000002',now()) returning id`,[a])).rows;
  const jobs=[];for(const c of conversations){jobs.push((await db.query<any>(`insert into public.whatsapp_jobs(restaurant_id,conversation_id,direction,kind,dedupe_key,payload,state,lease,run_at) values($1,$2::uuid,'in','text',$2::text,'{"text":"menu"}','processing',gen_random_uuid(),now()+interval '90 seconds') returning *`,[a,c.id])).rows[0]);}
  await claims();const limited=await cmd('plan',{name:'Limited',version:1,currency:'IQD',monthly_price:100,effective_at:'2025-01-01',limits:{conversations:1,ai_responses:1}});
  const assignment={restaurant_id:a,plan_id:limited.id,status:'active',period_start:new Date(Date.now()-60000).toISOString(),period_end:new Date(Date.now()+86400000).toISOString()};await cmd('assign',assignment);
  await db.exec('reset role;set role service_role');
  const blocked=(await db.query<any>('select public.whatsapp_prepare_inbound($1,$2) result',[jobs[0].id,jobs[0].lease])).rows[0].result;assert.equal(blocked.gate,'skip');
  await claims();await cmd('assign',{...assignment,overrides:{conversations:3}});
  await db.exec('reset role;set role service_role');
  const reserve=async(j:any)=>(await db.query<any>("select public.whatsapp_reserve_ai($1,$2,'gpt-6-luna',0.001) result",[j.id,j.lease])).rows[0].result;
  const results=await Promise.all(jobs.map(reserve));assert.equal(results.filter(Boolean).length,1);
  await claims();await cmd('assign',{...assignment,overrides:{conversations:3,ai_responses:2}});await db.exec('reset role;set role service_role');
  assert.equal(await reserve(jobs[1]),true);await claims();
  await cmd('assign',{...assignment,status:'suspended'});await db.exec('reset role;set role service_role');assert.equal(await reserve(jobs[0]),false);await claims();
  await cmd('assign',{...assignment,status:'expired'});await db.exec('reset role;set role service_role');assert.equal(await reserve(jobs[0]),false);await claims();
 });

});

test('runtime model settings affect API parameters and snapshot cost estimates',async()=>{
 const input={text:'hello',history:[],draft:[],menu:[],locale:'en' as const};
 const runtime={model:'gpt-6-luna',input:1,cached:0.5,output:4,max_output_tokens:1000,timeout_ms:8000};
 assert(requestReservation(input,'gpt-6-luna',runtime)!>0);
 const result=await interpret(input,'gpt-6-luna','mock',async(_url,init)=>{
  const request=JSON.parse(String(init!.body));assert.equal(request.max_output_tokens,1000);assert.equal(request.model,runtime.model);
  return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:10,input_tokens_details:{cached_tokens:50}},output:[{type:'function_call',name:'interpret_restaurant_message',arguments:JSON.stringify({action:'greet',items:[],menu_ids:[],locale:'en'})}]});
 },runtime);
 assert.equal(result.usage.estimated_usd,0.000115);
});
