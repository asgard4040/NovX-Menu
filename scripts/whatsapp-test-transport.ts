import type { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";

const identifier = (value: string) => {
  if (!/^[a-z][a-z_\d]*$/.test(value)) throw new Error("Invalid fixture identifier");
  return '"' + value + '"';
};

// A limited test transport for the PostgREST calls made by WhatsApp. Real SQL
// runs with service_role grants. Auth, HTTP transport and Realtime are fixtures.
export function fixtureClient(database: PGlite, users: Record<string, string>) {
  const transport: typeof fetch = async (request, init) => {
    const url = new URL(request instanceof Request ? request.url : request);
    const headers = new Headers(init?.headers);
    const method = init?.method || "GET";
    if (url.pathname === "/auth/v1/user") {
      const id = users[headers.get("authorization")?.replace("Bearer ", "") || ""];
      return Response.json(id ? { id, aud: "authenticated", app_metadata: headers.get("authorization") === "Bearer admin" ? { system_role: "admin" } : {} }
        : { msg: "Unauthorized" }, { status: id ? 200 : 401 });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    try {
      const rows = await database.transaction(async tx => {
        await tx.exec("set local role service_role");
        const values: unknown[] = [];
        const param = (value: unknown) => { values.push(value); return "$" + values.length; };
        if (url.pathname.startsWith("/rest/v1/rpc/")) {
          const name = identifier(url.pathname.split("/").at(-1)!);
          const args = Object.entries(body).map(([key, value]) => identifier(key) + "=>" + param(value));
          return (await tx.query("select * from public." + name + "(" + args.join(",") + ")", values)).rows;
        }
        const table = "public." + identifier(url.pathname.split("/").at(-1)!);
        const selection = url.searchParams.get("select") || "*";
        const select = selection === "*" ? selection : selection.split(/,(?![^()]*\))/).map(column =>
          column === "orders(order_number,status,total_amount)"
            ? "(select to_jsonb(x) from (select order_number,status,total_amount from public.orders where id=whatsapp_orders.order_id) x) as orders"
            : identifier(column),
        ).join(",");
        const predicates: string[] = [];
        for (const [key, condition] of url.searchParams) {
          if (["select", "order", "limit", "on_conflict"].includes(key)) continue;
          const dot = condition.indexOf(".");
          const op = condition.slice(0, dot);
          const value = condition.slice(dot + 1);
          if (op === "is" && value === "null") predicates.push(identifier(key) + " is null");
          else if (op === "not" && value === "is.null") predicates.push(identifier(key) + " is not null");
          else if (op === "in") predicates.push(identifier(key) + " in (" + value.slice(1, -1).split(",").map(param).join(",") + ")");
          else predicates.push(identifier(key) + ({ eq: "=", gt: ">", lt: "<" }[op] || " INVALID ") + param(value));
        }
        const where = predicates.length ? " where " + predicates.join(" and ") : "";
        if (method === "PATCH") {
          const changes = Object.entries(body).map(([key, value]) => identifier(key) + "=" + param(value));
          return (await tx.query("update " + table + " set " + changes.join(",") + where + " returning " + select, values)).rows;
        }
        if (method === "POST") {
          const keys = Object.keys(body).map(identifier);
          const args = Object.values(body).map(param);
          const conflict = headers.get("prefer")?.includes("resolution=merge-duplicates")
            && url.pathname.endsWith("/whatsapp_settings")
            ? " on conflict (restaurant_id) do update set " +
              keys.filter(key => key !== '"restaurant_id"').map(key => key + "=excluded." + key).join(",")
            : "";
          return (await tx.query("insert into " + table + "(" + keys.join(",") + ") values (" +
            args.join(",") + ")" + conflict + " returning " + select, values)).rows;
        }
        const order = url.searchParams.get("order")?.split(",").map(column => {
          const [field, direction] = column.split(".");
          return identifier(field) + (direction === "desc" ? " desc" : " asc");
        }).join(",");
        const limit = url.searchParams.get("limit");
        return (await tx.query("select " + select + " from " + table + where + (order ? " order by " + order : "") +
          (limit ? " limit " + Number(limit) : ""), values)).rows;
      });
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const name = url.pathname.split("/").at(-1)!;
        return Response.json(["whatsapp_claim", "whatsapp_menu_context"].includes(name) ? rows : rows[0]?.[name] ?? null);
      }
      if (headers.get("accept") === "application/vnd.pgrst.object+json") {
        return rows.length === 1 ? Response.json(rows[0]) : Response.json({ code: "PGRST116", details: "The result contains " + rows.length + " rows" }, { status: 406 });
      }
      return Response.json(rows);
    } catch (error: any) {
      console.error("Fixture SQL error", error.message, error.where);
      return Response.json({ code: error.code || "fixture_error", message: error.message }, { status: 400 });
    }
  };
  return createClient("http://supabase.test", "fake-service-role", { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: transport } });
}
