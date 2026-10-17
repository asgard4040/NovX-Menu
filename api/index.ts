import type { Request, Response } from "express";
import app from "../server.js";

// Vercel sends every /api/* request here. Restore the public path for the
// existing Express router; keep the original query string for tracking tokens.
export default function handler(req: Request, res: Response) {
  // If the request body was already parsed by the serverless runtime (e.g. Vercel),
  // flag it for body-parser so Express does not hang waiting on an already-consumed stream.
  if ((req as any).body !== undefined && !(req as any)._body) {
    (req as any)._body = true;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const rawRoute = req.query?.route ?? url.searchParams.get("route");

  if (rawRoute !== undefined && rawRoute !== null && rawRoute !== "") {
    const segments = Array.isArray(rawRoute)
      ? rawRoute.flatMap((s) => String(s).split("/"))
      : String(rawRoute).split("/");
    const cleanSegments = segments.filter(Boolean);

    if (cleanSegments.includes("..")) {
      return res.status(404).json({ error: "not_found" });
    }

    url.searchParams.delete("route");
    const search = url.searchParams.toString();
    req.url = `/api/${cleanSegments.join("/")}${search ? `?${search}` : ""}`;
  } else if (!req.url.startsWith("/api/")) {
    const pathname = url.pathname.replace(/^\/api\/?/, "");
    const search = url.searchParams.toString();
    req.url = `/api/${pathname}${search ? `?${search}` : ""}`;
  }

  return app(req, res);
}
