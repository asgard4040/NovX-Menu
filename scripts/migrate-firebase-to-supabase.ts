import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "crypto";
import WebSocket from "ws";

if (!globalThis.WebSocket) (globalThis as any).WebSocket = WebSocket;

const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const serviceAccount = JSON.parse(Buffer.from(required("FIREBASE_SERVICE_ACCOUNT_BASE64"), "base64").toString("utf8"));
const firebase = getFirestore(initializeApp({ credential: cert(serviceAccount) }), process.env.FIREBASE_DATABASE_ID);
const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const dryRun = process.argv.includes("--dry-run");
const iso = (value: any) => value?.toDate ? value.toDate().toISOString() : new Date(value || Date.now()).toISOString();
const clean = (value: any) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
const emailFor = (username: string) => `${String(username).toLowerCase().replace(/[^a-z0-9._-]/g, "")}@accounts.novx.invalid`;
const counts: Record<string, number> = {};
async function migrateAsset(value: any, restaurantId: string, prefix: string) {
  if (!value || dryRun) return value;
  try {
    let contentType = "image/jpeg"; let bytes: Uint8Array;
    if (String(value).startsWith("data:")) { const match=String(value).match(/^data:(image\/[a-z+]+);base64,(.+)$/); if(!match)return value; contentType=match[1]; bytes=Uint8Array.from(Buffer.from(match[2],"base64")); }
    else { const response=await fetch(String(value)); if(!response.ok)return value; contentType=response.headers.get("content-type")||contentType; bytes=new Uint8Array(await response.arrayBuffer()); }
    const extension=contentType.includes("png")?"png":contentType.includes("webp")?"webp":"jpg"; const path=`${restaurantId}/${prefix}-${randomUUID()}.${extension}`;
    const upload=await supabase.storage.from("restaurant-assets").upload(path,bytes,{contentType,upsert:false}); if(upload.error)throw upload.error;
    return supabase.storage.from("restaurant-assets").getPublicUrl(path).data.publicUrl;
  } catch(error){console.warn(`Asset copy failed for ${prefix}; retaining original URL`,error);return value;}
}

async function upsert(table: string, row: any, conflict = "legacy_id") {
  counts[table] = (counts[table] || 0) + 1;
  if (dryRun) return row;
  const result = await supabase.from(table).upsert(clean(row), { onConflict: conflict }).select().single();
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return result.data;
}
async function ensureUser(username: string, password: string, metadata: any) {
  const email = emailFor(username); if (dryRun) return randomUUID();
  let userId: string | undefined;
  for (let page = 1; !userId; page++) {
    const list = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (list.error) throw list.error;
    userId = (list.data.users as Array<{ id: string; email?: string }>).find((candidate) => candidate.email === email)?.id;
    if (list.data.users.length < 1000) break;
  }
  if (!userId) {
    const created = await supabase.auth.admin.createUser({ email, password: password || randomUUID(), email_confirm: true, user_metadata: { name: metadata.name }, app_metadata: metadata });
    if (created.error || !created.data.user) throw new Error(`Auth ${email}: ${created.error?.message}`); userId = created.data.user.id;
  } else await supabase.auth.admin.updateUserById(userId, { app_metadata: metadata });
  return userId;
}

async function main() {
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    const adminId = await ensureUser(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD, { system_role: "admin", name: "Super Admin" });
    if (!dryRun) await supabase.auth.admin.updateUserById(adminId, { app_metadata: { system_role: "admin" } });
  }
  const restaurantMap = new Map<string, string>();
  const staffMap = new Map<string, string>();
  const restaurants = await firebase.collection("restaurants").get();
  for (const document of restaurants.docs) {
    const d = document.data();
    const row = await upsert("restaurants", { legacy_id: document.id, manager_name: d.managerName || "Unknown", manager_phone: d.managerPhone, restaurant_name: d.restaurantName || "Restaurant", username: d.username || `restaurant-${document.id}`, province: d.province, area: d.area, landmark: d.landmark, subscription_type: d.subscriptionType || "normal", subscription_duration: d.subscriptionDuration || "month", start_date: iso(d.startDate), end_date: iso(d.endDate), grace_period_days: d.gracePeriodDays ?? 3, monthly_cost: Number(d.monthlyCost)||0, total_cost: Number(d.totalCost)||0, logo_url: d.logoUrl, status: d.status || "active", categories: d.categories || [], latitude: d.latitude, longitude: d.longitude, geofence_radius_meters: d.geofenceRadiusMeters || 150, current_order_number: Number(d.currentOrderNumber)||0, last_shift_reset_time: d.lastShiftResetTime, theme_id: d.themeId || "italian-luxury", theme_colors: d.themeColors || {} });
    const restaurantId = row.id || document.id; restaurantMap.set(document.id, restaurantId);
    if (d.logoUrl && !dryRun) { const logoUrl=await migrateAsset(d.logoUrl,restaurantId,"logo"); await supabase.from("restaurants").update({logo_url:logoUrl}).eq("id",restaurantId); }
    const ownerId = await ensureUser(d.username || `restaurant-${document.id}`, d.password, { role: "restaurant", restaurant_id: restaurantId, name: d.restaurantName });
    await upsert("restaurant_members", { restaurant_id: restaurantId, user_id: ownerId, role: "owner", active: true }, "restaurant_id,user_id");
  }
  const migrateStaff = async (source: string, role: "waiter"|"kitchen") => {
    const snapshot = await firebase.collection(source).get();
    for (const document of snapshot.docs) { const d=document.data(); const restaurantId=restaurantMap.get(d.restaurantId); if(!restaurantId) throw new Error(`${source}/${document.id}: missing restaurant`); const uid=await ensureUser(d.username||`${role}-${document.id}`,d.password,{role,restaurant_id:restaurantId,name:d.name}); const row=await upsert("staff",{legacy_id:document.id,restaurant_id:restaurantId,auth_user_id:uid,role,name:d.name||role,phone:d.phone,username:d.username||`${role}-${document.id}`,status:d.status||"active"}); staffMap.set(document.id,row.id||document.id); await upsert("restaurant_members",{restaurant_id:restaurantId,user_id:uid,role,active:d.status!=="suspended"},"restaurant_id,user_id"); }
  };
  await migrateStaff("waiters","waiter"); await migrateStaff("kitchen_staff","kitchen");
  const menuMap = new Map<string,string>(); const menu = await firebase.collection("menuItems").get();
  for(const document of menu.docs){const d=document.data();const restaurantId=restaurantMap.get(d.restaurantId);if(!restaurantId)continue;const imageUrl=await migrateAsset(d.imageUrl,restaurantId,"menu-item");const row=await upsert("menu_items",{legacy_id:document.id,restaurant_id:restaurantId,name:d.name||"Unnamed",price:Number(d.price)||0,image_url:imageUrl,is_spicy:!!d.isSpicy,has_cheese:!!d.hasCheese,cheese_price:Number(d.cheesePrice)||0,spicy_price:Number(d.spicyPrice)||0,ingredients:d.ingredients,calories:d.calories,protein:d.protein,carbs:d.carbs,notes:d.notes,category:d.category,is_available:d.isAvailable!==false});menuMap.set(document.id,row.id||document.id);}
  const orders=await firebase.collection("orders").get();
  for(const document of orders.docs){
    const d=document.data();const restaurantId=restaurantMap.get(d.restaurantId);if(!restaurantId)continue;
    const sourceItems=Array.isArray(d.items)?d.items:[];
    const items=sourceItems.map((item:any)=>({...item,id:menuMap.get(item.id)||null}));
    const order=await upsert("orders",{legacy_id:document.id,restaurant_id:restaurantId,customer_name:d.customerName||"Unknown",table_number:String(d.tableNumber||""),items,total_amount:Number(d.totalAmount)||0,status:d.status||"pending",notes:d.notes,order_number:Number(d.orderNumber)||0,created_at:iso(d.createdAt),approved_at:d.approvedAt?iso(d.approvedAt):null,ready_at:d.readyAt?iso(d.readyAt):null,cleared_for_staff:!!d.clearedForStaff,rejected_by:d.rejectedBy,rejected_role:d.rejectedRole,rejection_reason:d.rejectionReason,placed_by_waiter:!!d.placedByWaiter,waiter_name:d.waiterName,device_metadata:d.deviceMetadata||{},tracking_token_hash:createHash("sha256").update(randomUUID()).digest("hex")});
    const orderId=order.id||document.id;
    for(const [index,item] of sourceItems.entries()) await upsert("order_items",{legacy_key:`${document.id}:${index}`,order_id:orderId,menu_item_id:menuMap.get(item.id)||null,item_name:item.name||"Unknown",quantity:Math.max(1,Math.min(99,Number(item.quantity)||1)),unit_price:Math.max(0,Number(item.price)||0),cheese_selected:!!item.cheeseSelected,spicy_selected:!!item.spicySelected,customization_text:item.customizationText},"legacy_key");
  }
  for(const [source,table] of [["waiter_requests","waiter_requests"],["security_alerts","security_alerts"],["banned_devices","banned_devices"],["announcements","announcements"]] as const){const snapshot=await firebase.collection(source).get();for(const document of snapshot.docs){const d=document.data();const rid=d.restaurantId?restaurantMap.get(d.restaurantId):undefined;const base:any={legacy_id:document.id,...d};delete base.restaurantId;if(rid)base.restaurant_id=rid;if(base.waiterId)base.waiterId=staffMap.get(base.waiterId)||null;if(base.targetRestaurantId&&base.targetRestaurantId!=="all")base.targetRestaurantId=restaurantMap.get(base.targetRestaurantId)||base.targetRestaurantId;for(const key of Object.keys(base)){const snake=key.replace(/[A-Z]/g,(letter)=>`_${letter.toLowerCase()}`);if(snake!==key){base[snake]=base[key];delete base[key];}}await upsert(table,base);}}
  const settings=await firebase.collection("settings").get();for(const document of settings.docs){const d=document.data();await upsert("app_settings",{key:document.id,phone:d.phone,logo_url:d.logoUrl,model:d.model,prompt:d.prompt,temperature:d.temperature,updated_at:d.updatedAt?iso(d.updatedAt):new Date().toISOString()},"key");if(d.apiKey)console.warn("Gemini key was not copied to PostgreSQL; configure GEMINI_API_KEY on the server.");}
  const validation: Record<string, any> = {};
  if (!dryRun) for (const [table, expected] of Object.entries(counts)) {
    const result = await supabase.from(table).select("*", { count: "exact", head: true });
    validation[table] = { expectedAtLeast: expected, actual: result.count, ok: !result.error && Number(result.count) >= expected };
    if (result.error || Number(result.count) < expected) throw new Error(`Validation failed for ${table}: ${result.error?.message || `${result.count} < ${expected}`}`);
  }
  console.log(JSON.stringify({ dryRun, sourceRestaurants: restaurants.size, migrated: counts, validation },null,2));
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
