// service/main.ts
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
var USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var secret = process.env.OPENCHAMBER_SERVICE_TOKEN;
var BODY_MAX = 8192;
var TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{16,4096}$/;
var digest = (value) => createHash("sha256").update(value).digest();
var authorized = (header) => Boolean(secret) && timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
var reply = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(body);
};
var tokenOf = (raw) => {
  try {
    const { token } = JSON.parse(raw);
    return typeof token === "string" && TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
};
createServer(async (request, response) => {
  if (!authorized(request.headers.authorization))
    return reply(response, 401, '{"error":"unauthorized"}');
  if (request.method === "GET" && request.url === "/health")
    return reply(response, 200, '{"ok":true}');
  if (request.method !== "POST" || request.url !== "/usage")
    return reply(response, 404, '{"error":"not found"}');
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > BODY_MAX)
      return reply(response, 413, '{"error":"body too large"}');
  }
  const token = tokenOf(raw);
  if (!token)
    return reply(response, 400, '{"error":"token missing"}');
  try {
    const upstream = await fetch(USAGE_URL, {
      headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
      redirect: "error",
      signal: AbortSignal.timeout(15000)
    });
    reply(response, upstream.status, await upstream.text());
  } catch (error) {
    reply(response, 502, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}).listen(port, "127.0.0.1");
