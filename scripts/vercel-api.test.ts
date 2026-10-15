import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import type { Request, Response } from "express";

test("Vercel API gateway forwards the existing health route as JSON", async () => {
  process.env.VERCEL = "1";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-public-key";
  const { default: handler } = await import("../api/index");
  const server = createServer((req, res) => handler(req as Request, res as Response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a local TCP port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/index?route=health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", database: "supabase" });
  } finally {
    server.close();
  }
});
