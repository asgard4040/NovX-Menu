import express from "express";
import path from "path";
import app from "./server";

async function startLocalServer() {
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "0.0.0.0", () => console.log(`Server running on http://localhost:${port}`));
}

startLocalServer().catch((error) => { console.error(error); process.exitCode = 1; });
