import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const port = Number(process.env.FIXTURE_PORT || 4321);
const requests = new Map(), attempts = new Map();
let writes = 0;
const page = await readFile(new URL("./index.html", import.meta.url), "utf8");
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const json = (status, data) => {
    const body = JSON.stringify(data);
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
    res.end(body);
  };
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https: http://localhost:* http://127.0.0.1:*; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; style-src 'self' 'unsafe-inline'" });
    res.end(page); return;
  }
  if (url.pathname === "/api/options") { await new Promise(r => setTimeout(r, 80)); json(200, { categories: ["Support", "Feedback"] }); return; }
  if (url.pathname === "/api/availability") { await new Promise(r => setTimeout(r, 120)); json(200, { accepting: true }); return; }
  if (url.pathname === "/api/metrics") { json(200, { writes, requests: requests.size }); return; }
  if (req.method === "POST" && url.pathname === "/api/requests") {
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 8192) { json(413, { error: "Request too large" }); return; } }
    let body;
    try { body = JSON.parse(raw); } catch { json(400, { error: "Invalid JSON" }); return; }
    if (typeof body.title !== "string" || !body.title.trim()) { json(422, { outcome: "title_required", message: "Title required" }); return; }
    if (typeof body.actionId !== "string") { json(400, { error: "Action identifier required" }); return; }
    const count = (attempts.get(body.actionId) || 0) + 1; attempts.set(body.actionId, count);
    if (body.transient === true && count === 1) { json(503, { message: "Temporarily unavailable" }); return; }
    if (!requests.has(body.actionId)) { requests.set(body.actionId, { id: randomUUID(), title: body.title, status: "created" }); writes++; }
    json(201, requests.get(body.actionId)); return;
  }
  json(404, { error: "Not found" });
});
server.listen(port, "0.0.0.0", () => console.log(`Separate-origin fixture listening on http://localhost:${port}; no TraceLens API proxy.`));
