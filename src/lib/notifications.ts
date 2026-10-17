import { supabase } from "./supabase";

const decodeKey = (value: string) => {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
};

export async function enableStaffNotifications(restaurantId: string) {
  if (!window.isSecureContext) throw new Error("notifications_https_required");
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("notifications_unsupported");
  const publicKey = (import.meta as any).env?.VITE_WEB_PUSH_PUBLIC_KEY;
  if (!publicKey) throw new Error("web_push_not_configured");
  if (await Notification.requestPermission() !== "granted") throw new Error("notification_permission_denied");
  const registration = await navigator.serviceWorker.register("/push-sw.js");
  const applicationServerKey = decodeKey(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const currentKey = subscription.options.applicationServerKey ? new Uint8Array(subscription.options.applicationServerKey) : null;
    if (!currentKey || currentKey.length !== applicationServerKey.length || currentKey.some((byte, index) => byte !== applicationServerKey[index])) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("authentication_required");
  const response = await fetch("/api/push-subscriptions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ restaurantId, subscription: subscription.toJSON() }) });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error || "notification_registration_failed");
  }
}
