const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..", "app");
const requestedPort = Number.parseInt(process.env.PORT || process.argv[2] || "4173", 10);
const port = Number.isFinite(requestedPort) ? requestedPort : 4173;
const host = process.env.HOST || "127.0.0.1";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp"
};

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://${host}:${port}`).pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(appRoot, relativePath);

  if (filePath !== appRoot && !filePath.startsWith(`${appRoot}${path.sep}`)) {
    return null;
  }

  return filePath;
}

const server = http.createServer((request, response) => {
  const filePath = resolveRequestPath(request.url || "/");

  if (!filePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const headers = {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    };

    if (request.method === "HEAD") {
      response.writeHead(200, headers);
      response.end();
      return;
    }

    response.writeHead(200, headers);
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => response.destroy());
    stream.pipe(response);
  });
});

server.listen(port, host, () => {
  console.log(`Analyst OS is running at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
