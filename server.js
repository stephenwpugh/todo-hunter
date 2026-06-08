#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");
const { scan, scanFile, parseTags, cleanText } = require("./scanner");

const PORT = Number(process.env.TODO_PORT || 4317);
const HOST = process.env.TODO_HOST || "127.0.0.1";
const ROOT = path.resolve(process.env.TODO_ROOT || path.join(__dirname, "..", ".."));
const TOOLS_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(__dirname, "public");
const STORAGE_DIR = path.join(TOOLS_DIR, "storage");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, error.code === "ENOENT" ? 404 : 500, { error: error.message });
      return;
    }

    const type = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    response.writeHead(200, { "content-type": type });
    response.end(content);
  });
}

function resolveStaticPath(urlPath) {
  const requestedPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));
  return filePath.startsWith(PUBLIC_DIR) ? filePath : null;
}

function formatTimestampForFilename(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function optionalName(value) {
  return value && value !== "Unknown" ? value : null;
}

function createSnapshot(scanResult, timestamp = new Date()) {
  const capturedAt = timestamp.toISOString();
  const todos = scanResult.todos.map((todo) => ({
    timestamp: capturedAt,
    tags: todo.tags,
    filepath: todo.file,
    classname: optionalName(todo.className),
    methodname: optionalName(todo.methodName),
    line: todo.line,
    description: todo.text || todo.raw
  }));

  return {
    timestamp: capturedAt,
    root: scanResult.root,
    scannedAt: scanResult.scannedAt,
    todoCount: todos.length,
    todos
  };
}

function saveSnapshot(root) {
  const timestamp = new Date();
  const scanResult = scan(root);
  const snapshot = createSnapshot(scanResult, timestamp);
  const filename = `${formatTimestampForFilename(timestamp)}.json`;
  const filePath = path.join(STORAGE_DIR, filename);

  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  return {
    filename,
    filepath: path.relative(TOOLS_DIR, filePath),
    absoluteFilepath: filePath,
    timestamp: snapshot.timestamp,
    todoCount: snapshot.todoCount
  };
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/api/todos") {
    try {
      sendJson(response, 200, scan(ROOT));
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  if (url.pathname === "/api/save-state" && request.method === "POST") {
    try {
      sendJson(response, 201, saveSnapshot(ROOT));
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  const staticPath = resolveStaticPath(url.pathname);
  if (!staticPath) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  sendFile(response, staticPath);
});

if (require.main === module) {
  if (process.argv.includes("--scan")) {
    console.log(JSON.stringify(scan(ROOT), null, 2));
    process.exit(0);
  }

  server.listen(PORT, HOST, () => {
    console.log(`TODO dashboard scanning ${ROOT}`);
    console.log(`http://${HOST}:${PORT}`);
  });
}

module.exports = {
  server,
  scan,
  scanFile,
  saveSnapshot,
  createSnapshot,
  formatTimestampForFilename,
  parseTags,
  cleanText
};
