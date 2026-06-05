#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");

const PORT = Number(process.env.TODO_PORT || 4317);
const HOST = process.env.TODO_HOST || "127.0.0.1";
const ROOT = path.resolve(process.env.TODO_ROOT || path.join(__dirname, "..", ".."));
const EXCLUDED_DIRS = new Set([
  ".git",
  ".vs",
  ".idea",
  "bin",
  "obj",
  "Library",
  "Temp",
  "Logs",
  "node_modules",
  "packages",
  "Build",
  "Builds"
]);

const CLASS_PATTERN = /\b(?:public|private|protected|internal|abstract|sealed|static|partial|new|\s)*\b(class|struct|interface|record|enum)\s+([A-Za-z_][\w]*)/;
const METHOD_PATTERN = /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|extern|unsafe|partial|new)\s+)*(?:[\w<>\[\],.?]+\s+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:where\s+[^{]+)?\{/;
const TODO_PATTERN = /\bTODO\b\s*(.*)$/i;
const BRACKET_TAG_PATTERN = /\[([A-Za-z][\w.-]*)\]/g;
const HASH_TAG_PATTERN = /#([A-Za-z][\w.-]*)/g;
const PAREN_TAG_PATTERN = /^\s*\(([^)]*)\)/;

function walk(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        walk(path.join(dir, entry.name), files);
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".cs")) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

function stripStringLiterals(line) {
  return line.replace(/@"(?:""|[^"])*"|"(?:\\.|[^"\\])*"/g, "\"\"");
}

function updateScope(line, scope) {
  const code = stripStringLiterals(line);
  const classMatch = code.match(CLASS_PATTERN);
  const methodMatch = code.match(METHOD_PATTERN);

  if (classMatch) {
    scope.pendingClass = classMatch[2];
  }

  if (methodMatch && !["if", "for", "foreach", "while", "switch", "catch", "using", "lock"].includes(methodMatch[1])) {
    scope.pendingMethod = methodMatch[1];
  }

  for (const char of code) {
    if (char === "{") {
      scope.depth += 1;
      if (scope.pendingClass) {
        scope.classes.push({ name: scope.pendingClass, depth: scope.depth });
        scope.pendingClass = null;
      }
      if (scope.pendingMethod) {
        scope.methods.push({ name: scope.pendingMethod, depth: scope.depth });
        scope.pendingMethod = null;
      }
    } else if (char === "}") {
      while (scope.methods.length && scope.methods[scope.methods.length - 1].depth >= scope.depth) {
        scope.methods.pop();
      }
      while (scope.classes.length && scope.classes[scope.classes.length - 1].depth >= scope.depth) {
        scope.classes.pop();
      }
      scope.depth = Math.max(0, scope.depth - 1);
    }
  }
}

function extractCommentTexts(line, blockState) {
  const comments = [];
  let cursor = 0;

  while (cursor < line.length) {
    if (blockState.inBlock) {
      const end = line.indexOf("*/", cursor);
      const text = end === -1 ? line.slice(cursor) : line.slice(cursor, end);
      comments.push(text);
      if (end === -1) {
        return comments;
      }
      blockState.inBlock = false;
      cursor = end + 2;
      continue;
    }

    const slash = line.indexOf("//", cursor);
    const block = line.indexOf("/*", cursor);
    if (slash === -1 && block === -1) {
      return comments;
    }

    if (slash !== -1 && (block === -1 || slash < block)) {
      comments.push(line.slice(slash + 2));
      return comments;
    }

    const end = line.indexOf("*/", block + 2);
    comments.push(end === -1 ? line.slice(block + 2) : line.slice(block + 2, end));
    blockState.inBlock = end === -1;
    cursor = end === -1 ? line.length : end + 2;
  }

  return comments;
}

function parseTags(todoTail) {
  const tags = new Set();
  let match;

  while ((match = BRACKET_TAG_PATTERN.exec(todoTail)) !== null) {
    tags.add(match[1]);
  }

  while ((match = HASH_TAG_PATTERN.exec(todoTail)) !== null) {
    tags.add(match[1]);
  }

  const paren = todoTail.match(PAREN_TAG_PATTERN);
  if (paren) {
    for (const tag of paren[1].split(/[,\s]+/)) {
      const clean = tag.trim().replace(/^#/, "");
      if (clean) tags.add(clean);
    }
  }

  const normalized = [...tags].map((tag) => tag.trim()).filter(Boolean);
  return normalized.length ? normalized : ["Untagged"];
}

function cleanText(commentText) {
  return commentText
    .trim()
    .replace(/\bTODO\b\s*/i, "")
    .replace(/\[[A-Za-z][\w.-]*\]/g, "")
    .replace(/#[A-Za-z][\w.-]*/g, "")
    .replace(/^\([^)]*\)\s*:?\s*/, "")
    .replace(/^\s*[:(-]\s*/, "")
    .trim();
}

function scanFile(file, root = ROOT) {
  const relativePath = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const scope = {
    depth: 0,
    classes: [],
    methods: [],
    pendingClass: null,
    pendingMethod: null
  };
  const blockState = { inBlock: false };
  const todos = [];

  lines.forEach((line, index) => {
    const comments = extractCommentTexts(line, blockState);

    for (const comment of comments) {
      const match = comment.match(TODO_PATTERN);
      if (!match) continue;
      const tail = match[1] || "";
      const tags = parseTags(tail);
      const releases = tags.filter((tag) => /^E\d+$/i.test(tag)).map((tag) => tag.toUpperCase());
      const categories = tags.filter((tag) => !/^E\d+$/i.test(tag));

      todos.push({
        id: `${relativePath}:${index + 1}:${todos.length}`,
        file: relativePath,
        absoluteFile: file,
        line: index + 1,
        className: scope.classes.length ? scope.classes[scope.classes.length - 1].name : "Unknown",
        methodName: scope.methods.length ? scope.methods[scope.methods.length - 1].name : "Unknown",
        tags,
        releases,
        categories,
        text: cleanText(comment),
        raw: comment.trim()
      });
    }

    updateScope(line, scope);
  });

  return todos;
}

function countBy(items, selector) {
  const counts = new Map();
  for (const item of items) {
    const values = selector(item);
    for (const value of values) {
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function scan(root = ROOT) {
  const start = Date.now();
  const files = walk(root);
  const todos = files.flatMap((file) => scanFile(file, root));

  return {
    root,
    scannedAt: new Date().toISOString(),
    elapsedMs: Date.now() - start,
    fileCount: files.length,
    todoCount: todos.length,
    todos,
    counts: {
      tags: countBy(todos, (todo) => todo.tags),
      releases: countBy(todos, (todo) => todo.releases.length ? todo.releases : ["No release"]),
      categories: countBy(todos, (todo) => todo.categories.length ? todo.categories : ["Uncategorized"]),
      files: countBy(todos, (todo) => [todo.file]),
      classes: countBy(todos, (todo) => [todo.className]),
      methods: countBy(todos, (todo) => [todo.methodName])
    }
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendHtml(response) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(INDEX_HTML);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/") {
    sendHtml(response);
    return;
  }

  if (url.pathname === "/api/todos") {
    try {
      sendJson(response, 200, scan());
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

if (require.main === module) {
  if (process.argv.includes("--scan")) {
    console.log(JSON.stringify(scan(), null, 2));
    process.exit(0);
  }

  server.listen(PORT, HOST, () => {
    console.log(`TODO dashboard scanning ${ROOT}`);
    console.log(`http://${HOST}:${PORT}`);
  });
}

module.exports = {
  scan,
  scanFile,
  parseTags,
  cleanText
};

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TODO Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1b1f24;
      --muted: #667085;
      --line: #d9dee7;
      --panel: #ffffff;
      --bg: #f6f7f9;
      --accent: #0f766e;
      --accent-soft: #d9f3ef;
      --warn: #b45309;
      --code: #344054;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--bg);
      letter-spacing: 0;
    }
    header {
      padding: 24px 28px 16px;
      border-bottom: 1px solid var(--line);
      background: #fbfcfd;
    }
    h1 {
      margin: 0 0 6px;
      font-size: clamp(28px, 4vw, 44px);
      line-height: 1.05;
      letter-spacing: 0;
    }
    .subtitle {
      color: var(--muted);
      font-size: 14px;
    }
    main {
      display: grid;
      grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
      gap: 18px;
      padding: 18px;
    }
    aside, .content {
      min-width: 0;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .metric {
      padding: 14px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .metric strong {
      display: block;
      font-size: 26px;
      line-height: 1;
    }
    .metric span {
      display: block;
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    .controls {
      padding: 12px;
      position: sticky;
      top: 12px;
    }
    label {
      display: block;
      margin: 12px 0 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    input, select, button {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--ink);
      font: inherit;
      letter-spacing: 0;
    }
    input, select {
      padding: 8px 10px;
    }
    button {
      margin-top: 12px;
      background: var(--accent);
      color: white;
      border-color: var(--accent);
      font-weight: 700;
      cursor: pointer;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid var(--line);
    }
    .chip {
      width: auto;
      min-height: 30px;
      padding: 4px 9px;
      color: var(--code);
      background: #f8fafc;
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
    }
    .chip.active {
      background: var(--accent-soft);
      border-color: var(--accent);
      color: #134e4a;
    }
    .section-title {
      margin: 0;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      font-size: 14px;
      text-transform: uppercase;
      color: var(--muted);
    }
    .todo-list {
      display: grid;
      gap: 10px;
    }
    .todo {
      padding: 14px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .todo-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      color: var(--muted);
      font-size: 12px;
    }
    .todo-text {
      margin: 10px 0;
      font-size: 15px;
      line-height: 1.45;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 2px 7px;
      border-radius: 5px;
      background: #eef2f6;
      color: #344054;
      font-size: 12px;
      font-weight: 700;
    }
    .tag.release {
      background: #fff3d6;
      color: var(--warn);
    }
    .path {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: var(--code);
      overflow-wrap: anywhere;
    }
    .empty {
      padding: 28px;
      color: var(--muted);
      text-align: center;
    }
    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .controls { position: static; }
    }
    @media (max-width: 560px) {
      header { padding: 20px 16px 14px; }
      main { padding: 12px; }
      .metrics { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>TODO Dashboard</h1>
    <div id="subtitle" class="subtitle">Scanning C# TODO comments...</div>
  </header>
  <main>
    <aside>
      <div class="panel controls">
        <label for="search">Search</label>
        <input id="search" type="search" placeholder="Text, file, class, method">
        <label for="tagFilter">Tag</label>
        <select id="tagFilter"></select>
        <label for="releaseFilter">Release</label>
        <select id="releaseFilter"></select>
        <label for="categoryFilter">Category</label>
        <select id="categoryFilter"></select>
        <label for="groupBy">Group By</label>
        <select id="groupBy">
          <option value="none">None</option>
          <option value="file">File</option>
          <option value="className">Class</option>
          <option value="methodName">Method</option>
        </select>
        <button id="refresh">Refresh Scan</button>
      </div>
    </aside>
    <section class="content">
      <div class="metrics">
        <div class="metric"><strong id="todoCount">0</strong><span>TODOs</span></div>
        <div class="metric"><strong id="fileCount">0</strong><span>C# files</span></div>
        <div class="metric"><strong id="tagCount">0</strong><span>Tags</span></div>
        <div class="metric"><strong id="elapsedMs">0ms</strong><span>Scan time</span></div>
      </div>
      <div class="panel">
        <h2 class="section-title">Tags</h2>
        <div id="tagChips" class="chips"></div>
      </div>
      <div id="results" class="todo-list" style="margin-top:18px"></div>
    </section>
  </main>
  <script>
    const state = { data: null, tag: "", release: "", category: "", search: "", groupBy: "none" };
    const els = {
      subtitle: document.querySelector("#subtitle"),
      todoCount: document.querySelector("#todoCount"),
      fileCount: document.querySelector("#fileCount"),
      tagCount: document.querySelector("#tagCount"),
      elapsedMs: document.querySelector("#elapsedMs"),
      tagChips: document.querySelector("#tagChips"),
      results: document.querySelector("#results"),
      search: document.querySelector("#search"),
      tagFilter: document.querySelector("#tagFilter"),
      releaseFilter: document.querySelector("#releaseFilter"),
      categoryFilter: document.querySelector("#categoryFilter"),
      groupBy: document.querySelector("#groupBy"),
      refresh: document.querySelector("#refresh")
    };

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
    }

    function fillSelect(select, label, rows) {
      const current = select.value;
      select.innerHTML = '<option value="">' + label + '</option>' + rows
        .map(row => '<option value="' + escapeHtml(row.name) + '">' + escapeHtml(row.name) + ' (' + row.count + ')</option>')
        .join("");
      if ([...select.options].some(option => option.value === current)) select.value = current;
    }

    function filteredTodos() {
      const query = state.search.trim().toLowerCase();
      return state.data.todos.filter(todo => {
        if (state.tag && !todo.tags.includes(state.tag)) return false;
        if (state.release && !todo.releases.includes(state.release)) return false;
        if (state.category && !todo.categories.includes(state.category)) return false;
        if (!query) return true;
        return [todo.text, todo.raw, todo.file, todo.className, todo.methodName, todo.tags.join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });
    }

    function renderTodo(todo) {
      const tags = todo.tags.map(tag => {
        const release = /^E\\d+$/i.test(tag) ? " release" : "";
        return '<span class="tag' + release + '">' + escapeHtml(tag) + '</span>';
      }).join(" ");
      return '<article class="todo">' +
        '<div class="todo-meta"><span class="path">' + escapeHtml(todo.file) + ':' + todo.line + '</span><span>' + escapeHtml(todo.className) + '</span><span>' + escapeHtml(todo.methodName) + '</span></div>' +
        '<div class="todo-text">' + escapeHtml(todo.text || todo.raw) + '</div>' +
        '<div class="todo-tags">' + tags + '</div>' +
      '</article>';
    }

    function renderResults(todos) {
      if (!todos.length) {
        els.results.innerHTML = '<div class="panel empty">No TODOs match the current filters.</div>';
        return;
      }

      if (state.groupBy === "none") {
        els.results.innerHTML = todos.map(renderTodo).join("");
        return;
      }

      const groups = new Map();
      for (const todo of todos) {
        const key = todo[state.groupBy] || "Unknown";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(todo);
      }

      els.results.innerHTML = [...groups.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([name, rows]) =>
          '<section class="panel"><h2 class="section-title">' + escapeHtml(name) + ' (' + rows.length + ')</h2></section>' +
          rows.map(renderTodo).join("")
        )
        .join("");
    }

    function render() {
      const data = state.data;
      els.subtitle.textContent = 'Root: ' + data.root + ' | scanned ' + new Date(data.scannedAt).toLocaleString();
      els.todoCount.textContent = data.todoCount;
      els.fileCount.textContent = data.fileCount;
      els.tagCount.textContent = data.counts.tags.length;
      els.elapsedMs.textContent = data.elapsedMs + 'ms';
      fillSelect(els.tagFilter, "All tags", data.counts.tags);
      fillSelect(els.releaseFilter, "All releases", data.counts.releases.filter(row => row.name !== "No release"));
      fillSelect(els.categoryFilter, "All categories", data.counts.categories.filter(row => row.name !== "Uncategorized"));
      els.tagChips.innerHTML = data.counts.tags.map(row => {
        const active = state.tag === row.name ? " active" : "";
        return '<button class="chip' + active + '" data-tag="' + escapeHtml(row.name) + '">' + escapeHtml(row.name) + ' ' + row.count + '</button>';
      }).join("");
      renderResults(filteredTodos());
    }

    async function load() {
      els.subtitle.textContent = "Scanning C# TODO comments...";
      const response = await fetch("/api/todos");
      state.data = await response.json();
      render();
    }

    els.search.addEventListener("input", event => {
      state.search = event.target.value;
      renderResults(filteredTodos());
    });
    els.tagFilter.addEventListener("change", event => {
      state.tag = event.target.value;
      render();
    });
    els.releaseFilter.addEventListener("change", event => {
      state.release = event.target.value;
      renderResults(filteredTodos());
    });
    els.categoryFilter.addEventListener("change", event => {
      state.category = event.target.value;
      renderResults(filteredTodos());
    });
    els.groupBy.addEventListener("change", event => {
      state.groupBy = event.target.value;
      renderResults(filteredTodos());
    });
    els.refresh.addEventListener("click", load);
    els.tagChips.addEventListener("click", event => {
      const button = event.target.closest("button[data-tag]");
      if (!button) return;
      state.tag = state.tag === button.dataset.tag ? "" : button.dataset.tag;
      els.tagFilter.value = state.tag;
      render();
    });

    load().catch(error => {
      els.subtitle.textContent = error.message;
    });
  </script>
</body>
</html>`;
