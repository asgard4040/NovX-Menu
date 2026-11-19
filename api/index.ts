import express from "express";
import app from "../server.js";

const api = express();

// Expose an Express listener so the Node runtime leaves the webhook bytes in
// the request stream. Only the target Express routes parse the body.
api.use((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const rawRoute = req.query?.route ?? url.searchParams.get("route");
  if (rawRoute !== undefined && rawRoute !== null && rawRoute !== "") {
    const segments = Array.isArray(rawRoute)
      ? rawRoute.flatMap(segment => String(segment).split("/"))
      : String(rawRoute).split("/");
    const cleanSegments = segments.filter(Boolean);
    if (cleanSegments.includes("..")) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    url.searchParams.delete("route");
    const search = url.searchParams.toString();
    req.url = `/api/${cleanSegments.join("/")}${search ? `?${search}` : ""}`;
  } else if (!req.url.startsWith("/api/")) {
    const pathname = url.pathname.replace(/^\/api\/?/, "");
    const search = url.searchParams.toString();
    req.url = `/api/${pathname}${search ? `?${search}` : ""}`;
  }
  app(req, res);
});

export default api;
