import { createHash, randomBytes } from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";

const restaurantId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const cardToken = /^[A-Za-z0-9_-]{43}$/;
const cardLifetime = 180 * 24 * 60 * 60 * 1000;
const secureRequest = (req: Request) =>
  process.env.VERCEL === "1" || req.secure || req.get("X-Forwarded-Proto") === "https";
const cookieName = (req: Request, id: string) =>
  `${secureRequest(req) ? "__Host-" : ""}ordova_loyalty_${id.toLowerCase()}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function readCardToken(req: Request, id: string) {
  if (!restaurantId.test(id)) return null;
  const prefix = cookieName(req, id) + "=";
  const token = req.headers.cookie?.split(";").map(part => part.trim())
    .find(part => part.startsWith(prefix))?.slice(prefix.length);
  return token && cardToken.test(token) ? token : null;
}

export function loyaltyCardHash(req: Request, id: string) {
  const token = readCardToken(req, id);
  return token ? hashToken(token) : null;
}

export function loyaltyRouter(db: SupabaseClient | null, rateLimit: RequestHandler) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });

  router.get("/:restaurantId", async (req, res) => {
    const id = req.params.restaurantId;
    if (!restaurantId.test(id)) return res.status(400).json({ error: "invalid_restaurant" });
    if (!db) return res.status(503).json({ error: "loyalty_unavailable" });
    const { data, error } = await db.rpc("loyalty_guest", {
      p_restaurant: id, p_token_hash: loyaltyCardHash(req, id), p_action: "read",
    });
    if (error) return res.status(503).json({ error: "loyalty_unavailable" });
    return res.json(data);
  });

  router.post("/:restaurantId/:action", rateLimit, async (req, res) => {
    const { restaurantId: id, action } = req.params;
    if (!restaurantId.test(id) || !["join", "claim"].includes(action)) return res.sendStatus(404);
    if (!req.is("application/json") || ["cross-site", "same-site"].includes(req.get("Sec-Fetch-Site") || "")) {
      return res.sendStatus(403);
    }
    if (!db) return res.status(503).json({ error: "loyalty_unavailable" });

    const current = readCardToken(req, id);
    if (action === "claim" && !current) return res.status(403).json({ error: "loyalty_card_required" });
    if (action === "join" && current) {
      const { data, error } = await db.rpc("loyalty_guest", {
        p_restaurant: id, p_token_hash: hashToken(current), p_action: "read",
      });
      if (error || !data?.enabled) return res.status(503).json({ error: "loyalty_unavailable" });
      if (data.joined) return res.json(data);
    }

    const token = action === "join" ? randomBytes(32).toString("base64url") : current!;
    const { data, error } = await db.rpc("loyalty_guest", {
      p_restaurant: id, p_token_hash: hashToken(token), p_action: action,
    });
    if (error) {
      const code = ["loyalty_card_required", "loyalty_insufficient_points"].includes(error.message)
        ? error.message : "loyalty_unavailable";
      return res.status(code === "loyalty_unavailable" ? 503 : 409).json({ error: code });
    }
    if (action === "join") {
      res.cookie(cookieName(req, id), token, {
        httpOnly: true, sameSite: "strict", secure: secureRequest(req), path: "/", maxAge: cardLifetime,
      });
    }
    return res.json(data);
  });
  return router;
}
