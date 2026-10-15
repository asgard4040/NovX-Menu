import { supabase } from "./supabase";

const decodeKey = (value: string) => {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
};

export async function enableStaffNotifications(restaurantId: string) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("notifications_unsupported");
  const publicKey = (import.meta as any).env?.VITE_WEB_PUSH_PUBLIC_KEY;
  if (!publicKey) throw new Error("web_push_not_configured");
  if (await Notification.requestPermission() !== "granted") throw new Error("notification_permission_denied");
  const registration = await navigator.serviceWorker.register("/push-sw.js");
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(publicKey) });
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("authentication_required");
  const response = await fetch("/api/push-subscriptions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ restaurantId, subscription: subscription.toJSON() }) });
  if (!response.ok) throw new Error("notification_registration_failed");
}
