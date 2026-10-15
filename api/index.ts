import type { Request, Response } from "express";
import app from "../server.js";

// Vercel sends every /api/* request here. Restore the public path for the
// existing Express router; keep the original query string for tracking tokens.
export default function handler(req: Request, res: Response) {
  const url = new URL(req.url || "/", "http://localhost");
  const route = req.query?.route || url.searchParams.get("route");
  if (typeof route !== "string" || !route || route.startsWith("/") || route.split("/").includes("..")) {
    return res.status(404).json({ error: "not_found" });
  }
  url.searchParams.delete("route");
  req.url = `/api/${route}${url.search}`;
  return app(req, res);
}
