import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";

export async function testDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, raw_app_meta_data jsonb not null default '{}');
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit int,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(p_name text) returns text[] language sql immutable
      as $$ select string_to_array(p_name,'/') $$;
    create publication supabase_realtime;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to postgres,service_role;
    alter default privileges in schema public grant usage,select on sequences to postgres,service_role;
    alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated;
  `);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(dir)).sort()) {
    // This pre-existing hosted schedule requires Vault data and hardcodes a
    // production URL. The application migrations and triggers still run here.
    if (!file.endsWith(".sql") || file.endsWith("notification_dispatcher_schedule.sql")) continue;
    try { await db.exec((await readFile(new URL(file, dir), "utf8")).replace(/^\uFEFF/, "")); }
    catch (e) { throw new Error("Failed to apply " + file, { cause: e }); }
  }
  return db;
}
