const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = path.join(__dirname, "public");
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 240;
const RATE_LIMIT_MAX_ENTRIES = 10000;
const rateLimitStore = new Map();
let lastRateLimitCleanupAt = 0;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function isSubPath(base, target) {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function getSecurityHeaders() {
  return {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    ...getSecurityHeaders(),
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function getClientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      return forwarded.split(",")[0].trim();
    }
  }
  return req.socket.remoteAddress || "unknown";
}

function cleanupRateLimitStore(now) {
  if (
    now - lastRateLimitCleanupAt < RATE_LIMIT_WINDOW_MS &&
    rateLimitStore.size <= RATE_LIMIT_MAX_ENTRIES
  ) {
    return;
  }

  for (const [ip, entry] of rateLimitStore) {
    if (now >= entry.resetAt) {
      rateLimitStore.delete(ip);
    }
  }

  if (rateLimitStore.size > RATE_LIMIT_MAX_ENTRIES) {
    const overflow = rateLimitStore.size - RATE_LIMIT_MAX_ENTRIES;
    let dropped = 0;
    for (const ip of rateLimitStore.keys()) {
      rateLimitStore.delete(ip);
      dropped += 1;
      if (dropped >= overflow) {
        break;
      }
    }
  }

  lastRateLimitCleanupAt = now;
}

function getRateLimitStatus(req) {
  const now = Date.now();
  cleanupRateLimitStore(now);

  const ip = getClientIp(req);
  const existing = rateLimitStore.get(ip);
  if (!existing || now >= existing.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { limited: false, retryAfterSec: 0 };
  }
  existing.count += 1;
  if (existing.count > RATE_LIMIT_MAX_REQUESTS) {
    return {
      limited: true,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { limited: false, retryAfterSec: 0 };
}

function serveFile(res, absolutePath) {
  const ext = path.extname(absolutePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const stream = fs.createReadStream(absolutePath);
  stream.on("error", () => {
    res.writeHead(404, {
      ...getSecurityHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end("Not Found");
  });
  res.writeHead(200, { ...getSecurityHeaders(), "Content-Type": contentType });
  stream.pipe(res);
}

async function requestHandler(req, res) {
  try {
    const rateLimit = getRateLimitStatus(req);
    if (rateLimit.limited) {
      sendJson(
        res,
        429,
        { error: "Too many requests. Please wait a minute." },
        { "Retry-After": String(rateLimit.retryAfterSec) },
      );
      return;
    }

    const parsed = new URL(req.url, "http://localhost");

    if (parsed.pathname === "/api/health") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(res, 405, { error: "Method not allowed." });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    let requestedPath = parsed.pathname;
    if (requestedPath === "/") {
      requestedPath = "/index.html";
    }

    const absolutePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
    if (!isSubPath(PUBLIC_DIR, absolutePath)) {
      res.writeHead(403, {
        ...getSecurityHeaders(),
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Forbidden");
      return;
    }

    const stat = await fsp.stat(absolutePath);
    if (!stat.isFile()) {
      res.writeHead(404, {
        ...getSecurityHeaders(),
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Not Found");
      return;
    }

    await fsp.access(absolutePath, fs.constants.R_OK);
    if (req.method === "HEAD") {
      const ext = path.extname(absolutePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { ...getSecurityHeaders(), "Content-Type": contentType });
      res.end();
      return;
    }

    serveFile(res, absolutePath);
  } catch (error) {
    console.error("Request handling error:", error);
    sendJson(res, 500, { error: "Internal server error." });
  }
}

const server = http.createServer(requestHandler);

server.listen(PORT, () => {
  console.log(`WiGLE CSV Viewer running at http://localhost:${PORT}`);
});
