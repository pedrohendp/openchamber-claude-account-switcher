import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';

// The pages cannot call api.anthropic.com themselves: the API refuses CORS
// from a sandboxed frame's opaque origin. OpenChamber starts this service on
// loopback and proxies `host.serviceRequest` to it; it makes that one call
// with the access token the page sends, and nothing else.

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const secret = process.env.OPENCHAMBER_SERVICE_TOKEN;

/** `{"token":"…"}` with an OAuth access token is far below this. */
const BODY_MAX = 8_192;

/** Characters of an OAuth access token; anything else never reaches a header. */
const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{16,4096}$/;

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Compares in constant time, so the answer time says nothing about the secret. */
const authorized = (header: string | undefined): boolean => (
  Boolean(secret) && timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`))
);

const reply = (response: ServerResponse, status: number, body: string): void => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(body);
};

const tokenOf = (raw: string): string | null => {
  try {
    const { token } = JSON.parse(raw);
    return typeof token === 'string' && TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
};

createServer(async (request, response) => {
  if (!authorized(request.headers.authorization)) return reply(response, 401, '{"error":"unauthorized"}');
  if (request.method === 'GET' && request.url === '/health') return reply(response, 200, '{"ok":true}');
  if (request.method !== 'POST' || request.url !== '/usage') return reply(response, 404, '{"error":"not found"}');
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > BODY_MAX) return reply(response, 413, '{"error":"body too large"}');
  }
  const token = tokenOf(raw);
  if (!token) return reply(response, 400, '{"error":"token missing"}');
  try {
    const upstream = await fetch(USAGE_URL, {
      headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    reply(response, upstream.status, await upstream.text());
  } catch (error) {
    reply(response, 502, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}).listen(port, '127.0.0.1');
