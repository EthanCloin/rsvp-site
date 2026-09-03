// In-memory stand-in for nginx + the Flask app, for frontend tests.
// Serves ../../static at / and implements the CONTRACT.md API in memory.
// Run standalone:  node tests/frontend/stub-server.mjs [port]   (default 8080)
// Special case:    a display_name of "ratelimit" returns 429 like nginx's limit_req would.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../static');
const MAX_BODY = 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function normalizeName(s) {
  return s.trim().replace(/\s+/g, ' ');
}

export async function startServer({ port = 0, staticDir = STATIC_DIR } = {}) {
  const eventsRaw = await fs.readFile(path.join(staticDir, 'events.json'), 'utf8');
  const eventIds = new Set(JSON.parse(eventsRaw).events.map((e) => e.id));
  const rsvps = new Map(); // event_id -> [{display_name, created_at}]

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p.startsWith('/api/')) return handleApi(req, res, p);
    return serveStatic(req, res, p);
  });

  async function handleApi(req, res, p) {
    if (p === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true });

    const m = p.match(/^\/api\/events\/([^/]+)\/rsvps$/);
    if (!m) return sendJson(res, 404, { error: 'not_found', message: 'No such route' });
    const eventId = decodeURIComponent(m[1]);

    if (req.method === 'GET') {
      if (!eventIds.has(eventId)) return sendJson(res, 404, { error: 'unknown_event', message: 'Unknown event' });
      const list = rsvps.get(eventId) || [];
      return sendJson(res, 200, { event_id: eventId, count: list.length, rsvps: list });
    }

    if (req.method === 'POST') {
      if (!eventIds.has(eventId)) return sendJson(res, 404, { error: 'unknown_event', message: 'Unknown event' });

      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) {
          res.writeHead(413, { 'Content-Type': 'text/html' });
          return res.end('<html><body><h1>413 Request Entity Too Large</h1></body></html>');
        }
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return sendJson(res, 400, { error: 'invalid_json', message: 'Body must be a JSON object' });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return sendJson(res, 400, { error: 'invalid_json', message: 'Body must be a JSON object' });
      }

      // Honeypot: pretend success, store nothing.
      if (typeof body.website === 'string' && body.website !== '') {
        return sendJson(res, 201, { event_id: eventId, display_name: String(body.display_name ?? ''), created_at: new Date().toISOString() });
      }

      if (typeof body.display_name !== 'string') {
        return sendJson(res, 400, { error: 'invalid_name', message: 'display_name must be a string' });
      }
      const name = normalizeName(body.display_name);
      if (name.length === 0 || name.length > 40) {
        return sendJson(res, 400, { error: 'invalid_name', message: 'Name must be between 1 and 40 characters' });
      }
      if (/\p{Cc}/u.test(name)) {
        return sendJson(res, 400, { error: 'invalid_name', message: 'Name contains control characters' });
      }

      // Test hook: simulate nginx limit_req (HTML body, not JSON, like nginx would send).
      if (name.toLowerCase() === 'ratelimit') {
        res.writeHead(429, { 'Content-Type': 'text/html' });
        return res.end('<html><head><title>429 Too Many Requests</title></head><body><center><h1>429 Too Many Requests</h1></center><hr><center>nginx</center></body></html>');
      }

      const list = rsvps.get(eventId) || [];
      if (list.some((r) => r.display_name.toLowerCase() === name.toLowerCase())) {
        return sendJson(res, 409, { error: 'duplicate', message: 'That name is already on the list' });
      }
      const created_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      list.push({ display_name: name, created_at });
      rsvps.set(eventId, list);
      return sendJson(res, 201, { event_id: eventId, display_name: name, created_at });
    }

    res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed', message: 'Method not allowed' }));
  }

  async function serveStatic(req, res, p) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); return res.end();
    }
    let rel = decodeURIComponent(p);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(staticDir, '.' + rel);
    if (!file.startsWith(staticDir + path.sep) && file !== staticDir) {
      res.writeHead(404); return res.end('404');
    }
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    }
  }

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    rsvps,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8080);
  const s = await startServer({ port });
  console.log(`stub server on ${s.url} serving ${STATIC_DIR}`);
}
