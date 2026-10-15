import { supabase } from "./supabase";

type Ref = { kind: "collection" | "doc"; source: string; table: string; id?: string; role?: string };
type Constraint = { kind: "where"; field: string; op: string; value: any } | { kind: "orderBy"; field: string; direction: "asc" | "desc" };
type QueryRef = { kind: "query"; ref: Ref; constraints: Constraint[] };

const TABLES: Record<string, { table: string; role?: string }> = {
  restaurants: { table: "restaurants" }, waiters: { table: "staff", role: "waiter" },
  kitchen_staff: { table: "staff", role: "kitchen" }, menuItems: { table: "menu_items" },
  orders: { table: "orders" }, security_alerts: { table: "security_alerts" },
  banned_devices: { table: "banned_devices" }, waiter_requests: { table: "waiter_requests" },
  settings: { table: "app_settings" }, announcements: { table: "announcements" },
};
const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const camel = (key: string) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
const toDb = (data: Record<string, any>) => Object.fromEntries(Object.entries(data).map(([key, value]) => [snake(key), value instanceof Date ? value.toISOString() : value]));
const fromDb = (data: Record<string, any>) => Object.fromEntries(Object.entries(data).map(([key, value]) => {
  const normalized = typeof value === "string" && key.endsWith("_at") && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : value;
  return [camel(key), normalized];
}));
const mapped = (source: string) => TABLES[source] || { table: source };

export const db = {};
export const Timestamp = { now: () => new Date().toISOString() };
export const collection = (_db: unknown, source: string): Ref => ({ kind: "collection", source, ...mapped(source) });
export const doc = (_db: unknown, source: string, id: string): Ref => ({ kind: "doc", source, id, ...mapped(source) });
export const where = (field: string, op: string, value: any): Constraint => ({ kind: "where", field, op, value });
export const orderBy = (field: string, direction: "asc" | "desc" = "asc"): Constraint => ({ kind: "orderBy", field, direction });
export const query = (ref: Ref, ...constraints: Constraint[]): QueryRef => ({ kind: "query", ref, constraints });

function build(refOrQuery: Ref | QueryRef, select = "*") {
  const ref = refOrQuery.kind === "query" ? refOrQuery.ref : refOrQuery;
  const constraints = refOrQuery.kind === "query" ? refOrQuery.constraints : [];
  let builder: any = supabase.from(ref.table).select(select);
  if (ref.id) builder = builder.eq(ref.source === "settings" ? "key" : "id", ref.id);
  if (ref.role) builder = builder.eq("role", ref.role);
  for (const constraint of constraints) {
    if (constraint.kind === "orderBy") builder = builder.order(snake(constraint.field), { ascending: constraint.direction === "asc" });
    else {
      const field = snake(constraint.field);
      if (constraint.op === "==") builder = builder.eq(field, constraint.value);
      else if (constraint.op === "in") builder = builder.in(field, constraint.value);
      else if (constraint.op === ">=") builder = builder.gte(field, constraint.value);
      else if (constraint.op === "<=") builder = builder.lte(field, constraint.value);
      else throw new Error(`Unsupported Supabase query operator: ${constraint.op}`);
    }
  }
  return { builder, ref };
}

const documentSnapshot = (row: any, fallbackId?: string) => ({
  id: row?.id || row?.key || fallbackId,
  exists: () => Boolean(row),
  data: () => row ? fromDb(row) : undefined,
});

export async function getDoc(ref: Ref) {
  const { builder } = build(ref);
  const { data, error } = await builder.maybeSingle();
  if (error) throw error;
  return documentSnapshot(data, ref.id);
}

export async function getDocs(ref: Ref | QueryRef) {
  const { builder } = build(ref);
  const { data, error } = await builder;
  if (error) throw error;
  const docs = (data || []).map((row: any) => documentSnapshot(row));
  return { docs, empty: docs.length === 0, size: docs.length };
}

export async function addDoc(ref: Ref, value: Record<string, any>) {
  const payload = { ...toDb(value), ...(ref.role ? { role: ref.role } : {}) };
  const identityColumn = ref.source === "settings" ? "key" : "id";
  const { data, error } = await supabase.from(ref.table).insert(payload).select(identityColumn).single();
  if (error) throw error;
  return { id: data[identityColumn] };
}

export async function updateDoc(ref: Ref, value: Record<string, any>) {
  let builder: any = supabase.from(ref.table).update(toDb(value)).eq(ref.source === "settings" ? "key" : "id", ref.id!);
  if (ref.role) builder = builder.eq("role", ref.role);
  const { data, error } = await builder.select(ref.source === "settings" ? "key" : "id");
  if (error) throw error;
  if (!data?.length) throw new Error("not_found_or_not_authorized");
}

export async function setDoc(ref: Ref, value: Record<string, any>, options?: { merge?: boolean }) {
  const key = ref.source === "settings" ? { key: ref.id } : { id: ref.id };
  const payload = { ...key, ...toDb(value), ...(ref.role ? { role: ref.role } : {}) };
  const { error } = await (supabase.from(ref.table) as any).upsert(payload, { onConflict: ref.source === "settings" ? "key" : "id", ignoreDuplicates: false });
  if (error) throw error;
}

export async function deleteDoc(ref: Ref) {
  let builder: any = supabase.from(ref.table).delete().eq(ref.source === "settings" ? "key" : "id", ref.id!);
  if (ref.role) builder = builder.eq("role", ref.role);
  const { data, error } = await builder.select(ref.source === "settings" ? "key" : "id");
  if (error) throw error;
  if (!data?.length) throw new Error("not_found_or_not_authorized");
}

export function onSnapshot(ref: Ref | QueryRef, next: (snapshot: any) => void, error?: (error: any) => void) {
  let active = true;
  let inFlight = false;
  const emit = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const snapshot = (ref as any).kind === "doc" ? await getDoc(ref as Ref) : await getDocs(ref);
      if (active) next(snapshot);
    } catch (reason) { if (active) error?.(reason); }
    finally { inFlight = false; }
  };
  emit();
  const base = (ref as any).kind === "query" ? (ref as QueryRef).ref : ref as Ref;
  const tenantConstraint = (ref as any).kind === "query"
    ? (ref as QueryRef).constraints.find((item) => item.kind === "where" && item.op === "==" && item.field === "restaurantId") as any
    : null;
  const realtimeFilter = base.id
    ? `${base.source === "settings" ? "key" : "id"}=eq.${base.id}`
    : tenantConstraint ? `restaurant_id=eq.${tenantConstraint.value}` : undefined;
  const channel = supabase.channel(`db:${base.table}:${base.id || crypto.randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: base.table, ...(realtimeFilter ? { filter: realtimeFilter } : {}) }, emit)
    .subscribe((status) => { if (status === "SUBSCRIBED") void emit(); });
  const refreshOperationalData = base.table === "orders" || base.table === "waiter_requests"
    ? window.setInterval(emit, 15_000) : null;
  const onOnline = () => { void emit(); };
  const onVisible = () => { if (document.visibilityState === "visible") void emit(); };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    active = false;
    if (refreshOperationalData !== null) window.clearInterval(refreshOperationalData);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    supabase.removeChannel(channel);
  };
}

export type DocumentData = Record<string, any>;
