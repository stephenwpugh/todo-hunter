const fs = require("fs");
const path = require("path");

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
const METHOD_PATTERN = /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|extern|unsafe|partial|new)\s+)+(?:[\w<>\[\],.?]+\s+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:where\s+[^{}]+)?\s*(?:\{|$)/;
const TODO_PATTERN = /\bTODO\b\s*(.*)$/i;
const BRACKET_TAG_PATTERN = /\[([^\]\r\n]+)\]/g;
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
    .replace(/\[[^\]\r\n]+\]/g, "")
    .replace(/#[A-Za-z][\w.-]*/g, "")
    .replace(/^\([^)]*\)\s*:?\s*/, "")
    .replace(/^\s*[:(-]\s*/, "")
    .trim();
}

function scanFile(file, root) {
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

function scan(root) {
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

module.exports = {
  scan,
  scanFile,
  parseTags,
  cleanText,
  extractCommentTexts
};
