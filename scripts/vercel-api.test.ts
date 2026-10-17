import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import type { Request, Response } from "express";

test("Vercel API gateway forwards health, home-screen-manifest, and POST auth routes as JSON", async () => {
  process.env.VERCEL = "1";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-public-key";
  const { default: handler } = await import("../api/index");
  const server = createServer((req, res) => handler(req as Request, res as Response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a local TCP port");

    // 1. Query route as string
    const response = await fetch(`http://127.0.0.1:${address.port}/api/index?route=health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", database: "supabase" });

    // 2. Direct /api/health request without ?route= parameter
    const directResponse = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    assert.equal(directResponse.status, 200);
    assert.deepEqual(await directResponse.json(), { status: "ok", database: "supabase" });

    // 3. POST /api/auth/login via gateway returns JSON (not HTML or hanging)
    const postResponse = await fetch(`http://127.0.0.1:${address.port}/api/index?route=auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin", username: "admin", password: "wrong" }),
    });
    assert.match(postResponse.headers.get("content-type") || "", /application\/json/);
    assert.ok([401, 503].includes(postResponse.status));

    const restaurantId = "123e4567-e89b-42d3-a456-426614174000";
    for (const portal of ["menu", "restaurant", "waiter", "kitchen"] as const) {
      const manifestResponse = await fetch(`http://127.0.0.1:${address.port}/api/index?route=home-screen-manifest&restaurantId=${restaurantId}&portal=${portal}`);
      assert.equal(manifestResponse.status, 200);
      assert.match(manifestResponse.headers.get("content-type") || "", /application\/manifest\+json/);
      const manifest = await manifestResponse.json();
      assert.equal(manifest.id, `/home/${portal}/${restaurantId}`);
      assert.equal(manifest.start_url, portal === "menu"
        ? `/?restaurantId=${restaurantId}`
        : `/?loginRestaurantId=${restaurantId}&portal=${portal}`);
    }
    const invalid = await fetch(`http://127.0.0.1:${address.port}/api/index?route=home-screen-manifest&restaurantId=bad&portal=waiter`);
    assert.equal(invalid.status, 400);

    // 4. POST /api/chat via gateway returns JSON
    const chatResponse = await fetch(`http://127.0.0.1:${address.port}/api/index?route=chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello", restaurantId }),
    });
    assert.match(chatResponse.headers.get("content-type") || "", /application\/json/);
    const chatData = await chatResponse.json();
    assert.ok(typeof chatData.reply === "string");
  } finally {
    server.close();
  }
});
