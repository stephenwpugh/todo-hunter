const state = {
  data: null,
  activeTab: "dashboard",
  tag: "",
  release: "",
  category: "",
  search: "",
  groupBy: "none"
};

const els = {
  subtitle: document.querySelector("#subtitle"),
  todoCount: document.querySelector("#todoCount"),
  fileCount: document.querySelector("#fileCount"),
  tagCount: document.querySelector("#tagCount"),
  elapsedMs: document.querySelector("#elapsedMs"),
  tagChips: document.querySelector("#tagChips"),
  releaseBars: document.querySelector("#releaseBars"),
  categoryBars: document.querySelector("#categoryBars"),
  fileBars: document.querySelector("#fileBars"),
  results: document.querySelector("#results"),
  resultSummary: document.querySelector("#resultSummary"),
  search: document.querySelector("#search"),
  tagFilter: document.querySelector("#tagFilter"),
  releaseFilter: document.querySelector("#releaseFilter"),
  categoryFilter: document.querySelector("#categoryFilter"),
  groupBy: document.querySelector("#groupBy"),
  refresh: document.querySelector("#refresh"),
  saveState: document.querySelector("#saveState"),
  snapshotStatus: document.querySelector("#snapshotStatus"),
  clearFilters: document.querySelector("#clearFilters"),
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".tab-panel")
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function fillSelect(select, label, rows) {
  const current = select.value;
  select.innerHTML = `<option value="">${label}</option>` + rows
    .map((row) => `<option value="${escapeHtml(row.name)}">${escapeHtml(row.name)} (${row.count})</option>`)
    .join("");

  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function filteredTodos() {
  const query = state.search.trim().toLowerCase();
  return state.data.todos.filter((todo) => {
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

function tagClass(tag) {
  if (/^E\d+$/i.test(tag)) return "release";
  if (tag === "Untagged") return "untagged";
  if (tag.includes(" ")) return "phrase";
  return "category";
}

function renderBars(container, rows, color, limit = 8) {
  const visibleRows = rows.slice(0, limit);
  const max = Math.max(1, ...visibleRows.map((row) => row.count));
  if (!visibleRows.length) {
    container.innerHTML = '<div class="empty">No data yet.</div>';
    return;
  }

  container.innerHTML = visibleRows.map((row) => {
    const width = `${Math.max(8, Math.round((row.count / max) * 100))}%`;
    return `
      <div class="bar-row">
        <div class="bar-label" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="--bar-width:${width};--bar-color:${color}"></div></div>
        <div class="bar-count">${row.count}</div>
      </div>
    `;
  }).join("");
}

function renderDashboard() {
  const data = state.data;
  els.todoCount.textContent = data.todoCount;
  els.fileCount.textContent = data.fileCount;
  els.tagCount.textContent = data.counts.tags.length;
  els.elapsedMs.textContent = `${data.elapsedMs}ms`;

  renderBars(els.releaseBars, data.counts.releases, "#b45309");
  renderBars(els.categoryBars, data.counts.categories, "#2563eb");
  renderBars(els.fileBars, data.counts.files, "#0f766e", 6);

  els.tagChips.innerHTML = data.counts.tags.map((row) => {
    const active = state.tag === row.name ? " active" : "";
    return `<button class="chip${active}" data-tag="${escapeHtml(row.name)}" type="button">${escapeHtml(row.name)} ${row.count}</button>`;
  }).join("");
}

function renderTodo(todo) {
  const tags = todo.tags.map((tag) => (
    `<span class="tag ${tagClass(tag)}">${escapeHtml(tag)}</span>`
  )).join("");

  return `
    <article class="todo">
      <div class="todo-meta">
        <span class="path">${escapeHtml(todo.file)}:${todo.line}</span>
        <span>${escapeHtml(todo.className)}</span>
        <span>${escapeHtml(todo.methodName)}</span>
      </div>
      <div class="todo-text">${escapeHtml(todo.text || todo.raw)}</div>
      <div class="todo-tags">${tags}</div>
    </article>
  `;
}

function renderResults(todos) {
  els.resultSummary.textContent = `${todos.length} visible TODO${todos.length === 1 ? "" : "s"}`;

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
    .map(([name, rows]) => (
      `<div class="group-heading">${escapeHtml(name)} (${rows.length})</div>` +
      rows.map(renderTodo).join("")
    ))
    .join("");
}

function renderFilters() {
  const data = state.data;
  fillSelect(els.tagFilter, "All tags", data.counts.tags);
  fillSelect(els.releaseFilter, "All releases", data.counts.releases.filter((row) => row.name !== "No release"));
  fillSelect(els.categoryFilter, "All categories", data.counts.categories.filter((row) => row.name !== "Uncategorized"));
}

function render() {
  const data = state.data;
  els.subtitle.textContent = `Root: ${data.root} | scanned ${new Date(data.scannedAt).toLocaleString()}`;
  renderDashboard();
  renderFilters();
  renderResults(filteredTodos());
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.id === `${tabName}Tab`));
}

function clearFilters() {
  state.search = "";
  state.tag = "";
  state.release = "";
  state.category = "";
  state.groupBy = "none";
  els.search.value = "";
  els.tagFilter.value = "";
  els.releaseFilter.value = "";
  els.categoryFilter.value = "";
  els.groupBy.value = "none";
  render();
}

async function load() {
  els.subtitle.textContent = "Scanning C# TODO comments...";
  const response = await fetch("/api/todos");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Scan failed");
  }
  state.data = data;
  render();
}

async function saveState() {
  els.saveState.disabled = true;
  els.snapshotStatus.textContent = "Saving snapshot...";

  try {
    const response = await fetch("/api/save-state", { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Snapshot failed");
    }

    els.snapshotStatus.textContent = `Saved ${result.todoCount} TODOs to ${result.filepath}`;
  } catch (error) {
    els.snapshotStatus.textContent = error.message;
  } finally {
    els.saveState.disabled = false;
  }
}

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
});

els.search.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderResults(filteredTodos());
});

els.tagFilter.addEventListener("change", (event) => {
  state.tag = event.target.value;
  render();
});

els.releaseFilter.addEventListener("change", (event) => {
  state.release = event.target.value;
  renderResults(filteredTodos());
});

els.categoryFilter.addEventListener("change", (event) => {
  state.category = event.target.value;
  renderResults(filteredTodos());
});

els.groupBy.addEventListener("change", (event) => {
  state.groupBy = event.target.value;
  renderResults(filteredTodos());
});

els.refresh.addEventListener("click", load);
els.saveState.addEventListener("click", saveState);
els.clearFilters.addEventListener("click", clearFilters);

els.tagChips.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tag]");
  if (!button) return;
  state.tag = state.tag === button.dataset.tag ? "" : button.dataset.tag;
  els.tagFilter.value = state.tag;
  setActiveTab("todos");
  render();
});

load().catch((error) => {
  els.subtitle.textContent = error.message;
});
