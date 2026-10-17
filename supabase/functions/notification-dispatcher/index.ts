import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

Deno.serve(async (request) => {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || request.headers.get("x-cron-secret") !== expected) return new Response("Unauthorized", { status: 401 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com", Deno.env.get("WEB_PUSH_PUBLIC_KEY")!, Deno.env.get("WEB_PUSH_PRIVATE_KEY")!);
  const { data: events, error } = await supabase.rpc("claim_notification_outbox", { p_limit: 50 });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let sent = 0;
  for (const event of events || []) {
    const orderEvent = ["customer_order", "kitchen_order", "order_ready"].includes(event.event_type);
    if (event.event_type !== "waiter_request" && !orderEvent) {
      await supabase.from("notification_outbox").update({ processed_at: new Date().toISOString(), lease_until: null }).eq("id", event.id);
      continue;
    }
    const targetRoles = event.event_type === "kitchen_order" ? ["owner", "manager", "kitchen"] : ["owner", "manager", "waiter"];
    const { data: members, error: membersError } = await supabase.from("restaurant_members")
      .select("user_id").eq("restaurant_id", event.restaurant_id).eq("active", true)
      .in("role", targetRoles);
    if (membersError) return Response.json({ error: membersError.message }, { status: 500 });
    const staffIds = (members || []).map((member) => member.user_id);
    const { data: subscriptions, error: subscriptionsError } = staffIds.length
      ? await supabase.from("push_subscriptions").select("id,subscription")
        .eq("restaurant_id", event.restaurant_id).in("user_id", staffIds)
      : { data: [], error: null };
    if (subscriptionsError) return Response.json({ error: subscriptionsError.message }, { status: 500 });
    const table = String(event.payload.table_number || "").slice(0, 30);
    const orderNumber = String(event.payload.order_number || "").slice(0, 20);
    const title = event.event_type === "customer_order" ? "طلب جديد #" + orderNumber + " - طاولة " + table
      : event.event_type === "kitchen_order" ? "طلب للمطبخ #" + orderNumber + " - طاولة " + table
      : event.event_type === "order_ready" ? "طلب جاهز #" + orderNumber + " - طاولة " + table
      : "طلب ويتر - طاولة " + table;
    const payload = JSON.stringify({ title,
      body: orderEvent ? (event.event_type === "order_ready" ? "الطلب جاهز للتقديم" : "افتح الطلب لمتابعته") : event.payload.reason || "يوجد طلب خدمة جديد",
      requestId: event.payload.request_id, orderId: event.payload.order_id,
      url: "/?loginRestaurantId=" + event.restaurant_id + (orderEvent ? "&orderId=" + event.payload.order_id : "&requestId=" + event.payload.request_id) });
    if (!subscriptions?.length) {
      await supabase.from("notification_outbox").update({ processed_at: new Date().toISOString(), attempts: event.attempts + 1, lease_until: null }).eq("id", event.id);
      continue;
    }
    for (const item of subscriptions || []) {
      await supabase.from("notification_deliveries").upsert({ outbox_id: event.id, subscription_id: item.id }, { onConflict: "outbox_id,subscription_id", ignoreDuplicates: true });
      const { data: delivery } = await supabase.from("notification_deliveries").select("id,status,attempts").eq("outbox_id", event.id).eq("subscription_id", item.id).maybeSingle();
      if (!delivery || ["sent", "expired", "failed"].includes(delivery.status)) continue;
      try {
        await webpush.sendNotification(item.subscription, payload); sent++;
        await supabase.from("notification_deliveries").update({ status: "sent", attempts: delivery.attempts + 1, updated_at: new Date().toISOString(), last_error: null }).eq("id", delivery.id);
      } catch (reason: any) {
        const expired = [404, 410].includes(reason?.statusCode); const attempts = delivery.attempts + 1;
        await supabase.from("notification_deliveries").update({ status: expired ? "expired" : attempts >= 5 ? "failed" : "pending", attempts, last_error: String(reason?.message || reason).slice(0, 500), updated_at: new Date().toISOString() }).eq("id", delivery.id);
        if (expired) await supabase.from("push_subscriptions").delete().eq("id", item.id);
      }
    }
    const { count: pending } = await supabase.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("outbox_id", event.id).eq("status", "pending");
    await supabase.from("notification_outbox").update({ attempts: event.attempts + 1, lease_until: null, ...(pending === 0 || event.attempts >= 4 ? { processed_at: new Date().toISOString() } : {}) }).eq("id", event.id);
  }
  return Response.json({ processed: events?.length || 0, sent });
});
