(function () {
  const bridge = window.__42tradeMiniAppBridge || null;
  const mode = String(
    window.location.pathname.split("/").filter(Boolean).pop() || "files",
  ).toLowerCase();
  const APP_BASE_PATH = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = String(params.get("basePath") || "").trim();
      if (fromQuery) return fromQuery.replace(/\/+$/, "");
    } catch {}
    const marker = "/miniapps/system-tools";
    const pathname = String(window.location.pathname || "");
    const idx = pathname.indexOf(marker);
    if (idx >= 0) return pathname.slice(0, idx + marker.length);
    return "";
  })();
  const APP_META = {
    files: {
      title: "Files",
      sidebarTitle: "Folders",
      contentTitle: "Files",
      searchPlaceholder: "SEARCH FILES...",
    },
    logs: {
      title: "Logs",
      sidebarTitle: "Log Folders",
      contentTitle: "Log Files",
      searchPlaceholder: "SEARCH LOGS...",
    },
    health: {
      title: "Health",
    },
    cache: {
      title: "Cache",
      sidebarTitle: "Groups",
      contentTitle: "Cache Items",
      searchPlaceholder: "SEARCH KEY / CONTENT...",
    },
  };

  const el = (id) => document.getElementById(id);
  const qs = (selector) => document.querySelector(selector);
  const state = {
    context: bridge?.getContext?.() || {},
    page: 1,
    pageSize: 50,
    q: "",
    selectedDir: "",
    selectedGroup: "",
    selectedItem: null,
    tree: null,
    rows: [],
    total: 0,
    detail: null,
    health: null,
    expandedPaths: new Set([""]),
  };

  function setHeaderStatus(text) {
    const node = el("headerStatus");
    if (node) node.textContent = String(text || "");
  }

  function setSyncStatus(text, visible) {
    const root = el("syncStatus");
    if (!root) return;
    root.classList.toggle("hidden", !visible);
    const textNode = el("syncStatusText");
    if (textNode) textNode.textContent = String(text || "");
  }

  function setError(message) {
    const root = el("contentError");
    if (!root) return;
    const text = String(message || "").trim();
    root.textContent = text;
    root.classList.toggle("hidden", !text);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const idx = Math.min(
      units.length - 1,
      Math.floor(Math.log(value) / Math.log(1024)),
    );
    return `${(value / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
  }

  function formatDate(value) {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  }

  function formatRelative(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const diffMs = Date.now() - date.getTime();
    const absMs = Math.abs(diffMs);
    const units = [
      ["d", 24 * 60 * 60 * 1000],
      ["h", 60 * 60 * 1000],
      ["m", 60 * 1000],
      ["s", 1000],
    ];
    for (const [label, unitMs] of units) {
      if (absMs >= unitMs) {
        const amount = Math.round(absMs / unitMs);
        return `${amount}${label} ${diffMs >= 0 ? "ago" : "ahead"}`;
      }
    }
    return "just now";
  }

  function statusTone(value) {
    const normalized = String(value || "").toLowerCase();
    if (
      normalized === "ok" ||
      normalized === "connected" ||
      normalized === "ready" ||
      normalized === "enabled" ||
      normalized === "active" ||
      normalized === "true"
    ) {
      return "ok";
    }
    if (
      normalized === "warn" ||
      normalized === "warning" ||
      normalized === "degraded" ||
      normalized === "partial"
    ) {
      return "warn";
    }
    if (
      normalized === "error" ||
      normalized === "disconnected" ||
      normalized === "unreachable" ||
      normalized === "false"
    ) {
      return "error";
    }
    return "other";
  }

  function renderBadge(label, explicitTone) {
    const text = String(label || "-");
    const tone = explicitTone || statusTone(text);
    return `<span class="st-badge ${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
  }

  function api(path, options = {}) {
    const timeoutMs = Number(options.timeoutMs || 15000) || 15000;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const requestOptions = { ...options, signal: controller.signal };
    delete requestOptions.timeoutMs;
    return fetch(`${APP_BASE_PATH}${path}`, requestOptions).then(async (res) => {
      const contentType = String(res.headers.get("content-type") || "");
      const data = contentType.includes("application/json")
        ? await res.json()
        : await res.text();
      if (!res.ok) {
        throw new Error(
          typeof data === "string" ? data : data?.error || "Request failed",
        );
      }
      return data;
    }).catch((error) => {
      if (error?.name === "AbortError") {
        throw new Error("Request timed out.");
      }
      throw error;
    }).finally(() => {
      window.clearTimeout(timeoutId);
    });
  }

  function isBrowserMode() {
    return mode === "files" || mode === "logs";
  }

  function applyModeChrome() {
    const modeTitle = el("modeTitle");
    const layoutSplit = el("layoutSplit");
    const sidebarPane = el("sidebarPane");
    const healthView = el("healthView");
    const contentPanel = qs(".st-content-panel");
    const detailPane = el("detailPane");
    const contentActions = el("contentActions");

    if (modeTitle) modeTitle.textContent = APP_META[mode]?.title || "System Tools";
    if (layoutSplit) layoutSplit.hidden = false;
    if (healthView) healthView.hidden = true;
    if (layoutSplit) layoutSplit.classList.remove("st-layout-split--single");
    if (sidebarPane) sidebarPane.hidden = false;
    if (detailPane) detailPane.hidden = false;
    if (contentPanel) contentPanel.classList.remove("st-content-panel--plain");
    if (contentActions) contentActions.innerHTML = "";

    if (mode === "health") {
      if (layoutSplit) {
        layoutSplit.hidden = true;
        layoutSplit.classList.add("st-layout-split--single");
      }
      if (healthView) healthView.hidden = false;
    }
  }

  function renderToolbar() {
    const filters = el("toolbarFilters");
    const actions = el("toolbarActions");
    const meta = APP_META[mode] || APP_META.files;
    if (!filters || !actions) return;

    el("sidebarTitle").textContent = meta.sidebarTitle || "";
    el("contentTitle").textContent = meta.contentTitle || meta.title || "";

    if (isBrowserMode() || mode === "cache") {
      filters.innerHTML = `
        <input id="searchInput" class="dbm-control" placeholder="${escapeHtml(meta.searchPlaceholder || "SEARCH...")}" value="${escapeHtml(state.q)}" />
        <select id="pageSize" class="dbm-control dbm-control--compact">
          <option value="25"${state.pageSize === 25 ? " selected" : ""}>25</option>
          <option value="50"${state.pageSize === 50 ? " selected" : ""}>50</option>
          <option value="100"${state.pageSize === 100 ? " selected" : ""}>100</option>
          <option value="200"${state.pageSize === 200 ? " selected" : ""}>200</option>
        </select>
      `;
    } else {
      filters.innerHTML = "";
    }

    if (isBrowserMode()) {
      actions.innerHTML = `
        <button id="refreshBtn" class="secondary-button">Refresh</button>
        <span class="minor-text">${escapeHtml(state.selectedDir || "/")}</span>
      `;
    } else if (mode === "cache") {
      actions.innerHTML = `
        <button id="refreshBtn" class="secondary-button">Refresh</button>
        <button id="clearAllBtn" class="danger-button">Clear All</button>
      `;
    } else if (mode === "health") {
      actions.innerHTML = `
        <button id="healthRefreshBtn" class="secondary-button">Refresh</button>
      `;
    } else {
      actions.innerHTML = "";
    }

    const searchInput = el("searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", (event) => {
        state.q = event.target.value || "";
        state.page = 1;
        reloadCurrent();
      });
    }

    const pageSize = el("pageSize");
    if (pageSize) {
      pageSize.addEventListener("change", (event) => {
        state.pageSize = Number(event.target.value || 50) || 50;
        state.page = 1;
        reloadCurrent();
      });
    }

    const refreshBtn = el("refreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => initializeMode());

    const healthRefreshBtn = el("healthRefreshBtn");
    if (healthRefreshBtn) {
      healthRefreshBtn.addEventListener("click", () => initializeMode());
    }

    const clearAllBtn = el("clearAllBtn");
    if (clearAllBtn) {
      clearAllBtn.addEventListener("click", async () => {
        if (!window.confirm("Clear all cache?")) return;
        await api("/internal/cache/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ all: true }),
        });
        await initializeMode();
      });
    }
  }

  function ensureExpandedPath(pathValue) {
    const normalized = String(pathValue || "").trim();
    state.expandedPaths.add("");
    if (!normalized) return;
    const parts = normalized.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      state.expandedPaths.add(current);
    }
  }

  function renderTreeNode(node) {
    const children = Array.isArray(node.children) ? node.children : [];
    const pathValue = String(node.path || "");
    const isRoot = pathValue === "";
    const isExpanded = isRoot || state.expandedPaths.has(pathValue);
    const isActive =
      state.selectedDir === pathValue || state.selectedGroup === pathValue;
    const metaText = node.meta || "";
    const hasChildren = children.length > 0;

    return `
      <div class="st-tree-group">
        <div class="st-tree-row${isActive ? " active" : ""}">
          <button
            class="st-tree-toggle${hasChildren ? "" : " st-tree-toggle--empty"}"
            data-tree-toggle="${escapeHtml(pathValue)}"
            aria-label="${hasChildren ? (isExpanded ? "Collapse folder" : "Expand folder") : "Folder"}"
            ${hasChildren ? "" : "tabindex=\"-1\""}
          >${hasChildren ? (isExpanded ? "▾" : "▸") : ""}</button>
          <button
            class="sidebar-item-v2 st-tree-item${isActive ? " active" : ""}"
            data-tree-path="${escapeHtml(pathValue)}"
          >
            <div>
              <div class="st-tree-item-top">
                <div class="st-tree-item-name">${escapeHtml(node.name)}</div>
                <div class="minor-text">${escapeHtml(node.right || "")}</div>
              </div>
              <div class="st-tree-item-meta">
                <span>${escapeHtml(metaText)}</span>
              </div>
            </div>
          </button>
        </div>
        ${hasChildren && isExpanded ? `<div class="st-tree-children">${children.map((child) => renderTreeNode(child)).join("")}</div>` : ""}
      </div>
    `;
  }

  function bindTreeClicks() {
    const root = el("treeRoot");
    if (!root) return;

    root.querySelectorAll("[data-tree-toggle]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const pathValue = button.getAttribute("data-tree-toggle") || "";
        if (!pathValue) return;
        if (state.expandedPaths.has(pathValue)) state.expandedPaths.delete(pathValue);
        else state.expandedPaths.add(pathValue);
        renderTree();
      });
    });

    root.querySelectorAll("[data-tree-path]").forEach((button) => {
      button.addEventListener("click", async () => {
        const pathValue = button.getAttribute("data-tree-path") || "";
        if (mode === "cache") {
          state.selectedGroup = pathValue;
          state.page = 1;
          renderCacheRows();
          renderTree();
          return;
        }
        state.selectedDir = pathValue;
        state.page = 1;
        ensureExpandedPath(pathValue);
        renderTree();
        await loadBrowserList();
      });
    });
  }

  function renderTree() {
    const root = el("treeRoot");
    if (!root || !state.tree) return;
    root.innerHTML = renderTreeNode(state.tree);
    bindTreeClicks();
  }

  function renderRows(columns, rows, rowRenderer) {
    el("tableHead").innerHTML = columns.map((label) => `<th>${escapeHtml(label)}</th>`).join("");
    el("tableBody").innerHTML = rows.map((row, idx) => rowRenderer(row, idx)).join("");
    el("tableBody").querySelectorAll("[data-row-key]").forEach((tr) => {
      tr.addEventListener("click", () => {
        const key = tr.getAttribute("data-row-key") || "";
        if (isBrowserMode()) {
          loadBrowserDetail(key);
        } else if (mode === "cache") {
          loadCacheDetail(key);
        }
      });
    });
  }

  function renderPagination() {
    const pages = Math.max(1, Math.ceil((state.total || 0) / state.pageSize));
    el("paginationBar").innerHTML = `
      <div class="minor-text">Total: ${escapeHtml(String(state.total || 0))}</div>
      <div class="st-pagination-controls">
        <button class="secondary-button dbm-button dbm-button--compact" id="pagePrev"${state.page <= 1 ? " disabled" : ""}>&lsaquo;</button>
        <span class="minor-text">${escapeHtml(String(state.page))} / ${escapeHtml(String(pages))}</span>
        <button class="secondary-button dbm-button dbm-button--compact" id="pageNext"${state.page >= pages ? " disabled" : ""}>&rsaquo;</button>
      </div>
    `;
    const prev = el("pagePrev");
    const next = el("pageNext");
    if (prev) {
      prev.addEventListener("click", () => {
        state.page = Math.max(1, state.page - 1);
        reloadCurrent();
      });
    }
    if (next) {
      next.addEventListener("click", () => {
        state.page = Math.min(pages, state.page + 1);
        reloadCurrent();
      });
    }
  }

  function renderBrowserRows() {
    renderRows(
      ["Name", "Type", "Size", "Updated"],
      state.rows,
      (row) => `
        <tr class="st-row${state.selectedItem === row.path ? " active" : ""}" data-row-key="${escapeHtml(row.path)}">
          <td>
            <div class="st-table-item-name">${escapeHtml(row.name)}</div>
            <div class="minor-text">${escapeHtml(row.path)}</div>
          </td>
          <td>${escapeHtml(row.kind || "-")}</td>
          <td>${escapeHtml(formatBytes(row.size))}</td>
          <td>${escapeHtml(formatDate(row.updated_at))}</td>
        </tr>
      `,
    );
    renderPagination();
  }

  async function loadBrowserTree() {
    const query = new URLSearchParams({ scope: mode });
    if (mode === "files" && state.context.userId) {
      query.set("userId", state.context.userId);
    }
    const data = await api(`/internal/browser/tree?${query.toString()}`);
    state.tree = data.tree || { name: "/", path: "", children: [] };
    if (!state.selectedDir) state.selectedDir = data.initialPath || "";
    ensureExpandedPath(state.selectedDir);
    el("sidebarMeta").textContent = String(data.meta || "");
    renderTree();
  }

  async function loadBrowserList() {
    setSyncStatus("Loading files...", true);
    setError("");
    const query = new URLSearchParams({
      scope: mode,
      dir: state.selectedDir || "",
      page: String(state.page || 1),
      pageSize: String(state.pageSize || 50),
      q: state.q || "",
    });
    if (mode === "files" && state.context.userId) {
      query.set("userId", state.context.userId);
    }
    try {
      const data = await api(`/internal/browser/list?${query.toString()}`);
      state.rows = data.items || [];
      state.total = Number(data.total || 0);
      el("contentTitle").textContent = data.title || APP_META[mode].contentTitle;
      renderBrowserRows();
      el("detailActions").innerHTML = "";
      el("detailTitle").textContent = "Detail";
      el("detailContent").innerHTML =
        "Select a file to inspect its content.";
      state.selectedItem = null;
      state.detail = null;
    } finally {
      setSyncStatus("", false);
    }
  }

  async function loadBrowserDetail(pathValue) {
    setSyncStatus("Loading file detail...", true);
    state.selectedItem = pathValue;
    renderBrowserRows();
    try {
      const query = new URLSearchParams({ scope: mode, file: pathValue });
      if (mode === "files" && state.context.userId) {
        query.set("userId", state.context.userId);
      }
      const data = await api(`/internal/browser/content?${query.toString()}`);
      state.detail = data;
      el("detailTitle").textContent = data.name || "Detail";
      el("detailActions").innerHTML = `
        <a class="secondary-button dbm-button dbm-button--compact" href="${APP_BASE_PATH}/internal/browser/download?${query.toString()}" target="_blank" rel="noreferrer">Download</a>
        <button id="deleteSelectedBtn" class="danger-button dbm-button dbm-button--compact">Delete</button>
      `;
      const deleteBtn = el("deleteSelectedBtn");
      if (deleteBtn) {
        deleteBtn.addEventListener("click", async () => {
          if (!window.confirm(`Delete ${data.name}?`)) return;
          await api("/internal/browser/delete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              scope: mode,
              file: pathValue,
              userId: mode === "files" ? state.context.userId || "" : "",
            }),
          });
          bridge?.toast?.({ message: `${data.name} deleted`, type: "success" });
          await loadBrowserTree();
          await loadBrowserList();
        });
      }
      if (data.kind === "image") {
        el("detailContent").innerHTML = `
          <div class="stack-layout">
            <div class="minor-text">${escapeHtml(data.path || "")}</div>
            <img class="st-image-preview" src="${APP_BASE_PATH}/internal/browser/download?${query.toString()}" alt="${escapeHtml(data.name || "image")}" />
          </div>
        `;
      } else {
        el("detailContent").innerHTML = `
          <div class="stack-layout">
            <div class="minor-text">${escapeHtml(data.path || "")}</div>
            <pre class="st-detail-pre">${escapeHtml(data.content || "")}</pre>
          </div>
        `;
      }
    } finally {
      setSyncStatus("", false);
    }
  }

  function buildCacheTree(items) {
    const sourceMap = new Map();
    for (const item of items || []) {
      const source = String(item.source || "unknown");
      const symbol = String(item.data?.symbol || "misc");
      if (!sourceMap.has(source)) sourceMap.set(source, new Map());
      const bucket = sourceMap.get(source);
      bucket.set(symbol, (bucket.get(symbol) || 0) + 1);
    }
    return {
      name: "Cache",
      path: "",
      children: [...sourceMap.entries()].map(([source, symbols]) => ({
        name: source.toUpperCase(),
        path: `source:${source}`,
        meta: `${symbols.size} groups`,
        children: [...symbols.entries()].map(([symbol, count]) => ({
          name: symbol,
          path: `source:${source}|symbol:${symbol}`,
          meta: `${count} items`,
          children: [],
        })),
      })),
    };
  }

  function getFilteredCacheItems() {
    let rows = state.rows.slice();
    if (state.selectedGroup) {
      const parts = Object.fromEntries(
        state.selectedGroup.split("|").map((part) => part.split(":")),
      );
      if (parts.source) {
        rows = rows.filter((row) => String(row.source || "") === parts.source);
      }
      if (parts.symbol) {
        rows = rows.filter(
          (row) => String(row.data?.symbol || "misc") === parts.symbol,
        );
      }
    }
    if (state.q) {
      const query = state.q.toLowerCase();
      rows = rows.filter(
        (row) =>
          String(row.key || "").toLowerCase().includes(query) ||
          JSON.stringify(row.data || {}).toLowerCase().includes(query),
      );
    }
    return rows;
  }

  async function loadCache() {
    setSyncStatus("Loading cache...", true);
    const data = await api("/internal/cache/list");
    state.rows = data.items || [];
    state.tree = buildCacheTree(state.rows);
    el("sidebarMeta").textContent = `${state.rows.length} items`;
    renderTree();
    renderCacheRows();
    setSyncStatus("", false);
  }

  function renderCacheRows() {
    const rows = getFilteredCacheItems();
    state.total = rows.length;
    const start = (state.page - 1) * state.pageSize;
    const visible = rows.slice(start, start + state.pageSize);
    renderRows(
      ["Key", "Source", "Updated", "Expiry"],
      visible,
      (row) => `
        <tr class="st-row${state.selectedItem === row.key ? " active" : ""}" data-row-key="${escapeHtml(row.key)}">
          <td>
            <div class="st-table-item-name">${escapeHtml(row.key)}</div>
            <div class="minor-text">${escapeHtml(String(row.data?.symbol || ""))} ${escapeHtml(String(row.data?.tf || ""))}</div>
          </td>
          <td>${escapeHtml(String(row.source || ""))}</td>
          <td>${escapeHtml(formatDate(row.data?.updated_at || ""))}</td>
          <td>${escapeHtml(String(row.ttl_ms || 0))}</td>
        </tr>
      `,
    );
    renderPagination();
    if (!state.detail) {
      el("detailTitle").textContent = "Detail";
      el("detailActions").innerHTML = "";
      el("detailContent").innerHTML =
        "Select a cache item to inspect its content.";
    }
  }

  async function loadCacheDetail(key) {
    state.selectedItem = key;
    const row = state.rows.find((item) => item.key === key);
    const data = await api(
      `/internal/cache/detail?key=${encodeURIComponent(key)}&source=${encodeURIComponent(row?.source || "memory")}`,
    );
    state.detail = data;
    el("detailTitle").textContent = key;
    el("detailActions").innerHTML =
      '<button id="deleteSelectedBtn" class="danger-button dbm-button dbm-button--compact">Delete</button>';
    const deleteBtn = el("deleteSelectedBtn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!window.confirm(`Delete cache key ${key}?`)) return;
        await api("/internal/cache/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, source: row?.source || "memory" }),
        });
        bridge?.toast?.({ message: `${key} deleted`, type: "success" });
        state.detail = null;
        await loadCache();
      });
    }
    el("detailContent").innerHTML = `<pre class="st-detail-pre">${escapeHtml(
      JSON.stringify(data.data || data, null, 2),
    )}</pre>`;
    renderCacheRows();
  }

  function getHealthSummaryCards(health) {
    return [
      {
        label: "API",
        value: health?.service || "42trade",
        tone: health?.ok ? "ok" : "warn",
        meta: health?.version || "",
      },
      {
        label: "Postgres",
        value: health?.postgres || "unknown",
      },
      {
        label: "Redis",
        value: health?.redisEnabled ? health?.redis || "enabled" : "disabled",
        tone: health?.redisEnabled ? statusTone(health?.redis) : "other",
      },
      {
        label: "Cron",
        value: health?.cron || "unknown",
      },
      {
        label: "Storage",
        value: health?.storage || "unknown",
        tone: "other",
      },
      {
        label: "MT5",
        value: health?.mt5Enabled ? "enabled" : "disabled",
        tone: health?.mt5Enabled ? "ok" : "other",
      },
      {
        label: "cTrader",
        value: health?.ctraderEnabled ? "enabled" : "disabled",
        tone: health?.ctraderEnabled ? "ok" : "other",
      },
      {
        label: "Binance",
        value: health?.binanceEnabled ? "enabled" : "disabled",
        tone: health?.binanceEnabled ? "ok" : "other",
      },
    ];
  }

  function renderHealthCards(health) {
    return `
      <section class="st-health-grid">
        ${getHealthSummaryCards(health)
          .map(
            (card) => `
              <article class="panel st-health-card">
                <div class="st-health-card__label">${escapeHtml(card.label)}</div>
                <div class="st-health-card__value">${renderBadge(card.value, card.tone)}</div>
                <div class="minor-text">${escapeHtml(card.meta || "")}</div>
              </article>
            `,
          )
          .join("")}
      </section>
    `;
  }

  function renderHealthSources(health) {
    const sources = Object.entries(health?.sources || {});
    return `
      <section class="panel st-health-panel">
        <div class="st-panel-head">
          <div class="panel-label">Sources</div>
          <div class="minor-text">${sources.length} total</div>
        </div>
        <div class="st-health-list">
          ${
            sources.length
              ? sources
                  .map(
                    ([key, value]) => `
                      <article class="st-health-list-item">
                        <div>
                          <div class="st-health-item-title">${escapeHtml(value?.id || key)}</div>
                          <div class="minor-text">${escapeHtml(value?.lastActivity ? `${formatRelative(value.lastActivity)} · ${formatDate(value.lastActivity)}` : "No recent activity")}</div>
                        </div>
                        <div class="st-health-list-item__badges">
                          ${renderBadge(value?.enabled ? "enabled" : "disabled", value?.enabled ? "ok" : "other")}
                          ${renderBadge(value?.connected ? "connected" : "disconnected", value?.connected ? "ok" : "error")}
                        </div>
                      </article>
                    `,
                  )
                  .join("")
              : '<div class="st-empty-inline">No source data.</div>'
          }
        </div>
      </section>
    `;
  }

  function renderHealthServices(health) {
    const services = health?.services || [];
    return `
      <section class="panel st-health-panel">
        <div class="st-panel-head">
          <div class="panel-label">Services</div>
          <div class="minor-text">${services.length} total</div>
        </div>
        <div class="st-health-list">
          ${
            services.length
              ? services
                  .map(
                    (service) => `
                      <article class="st-health-list-item">
                        <div>
                          <div class="st-health-item-title">${escapeHtml(service.label || service.id || "Service")}</div>
                          <div class="minor-text">${escapeHtml(`${service.package || ""}${service.port ? ` · :${service.port}` : ""}${service.version ? ` · ${service.version}` : ""}`)}</div>
                        </div>
                        <div class="st-health-list-item__badges">
                          ${renderBadge(service.status || (service.reachable ? "ok" : "error"))}
                        </div>
                      </article>
                    `,
                  )
                  .join("")
              : '<div class="st-empty-inline">No services found.</div>'
          }
        </div>
      </section>
    `;
  }

  function renderHealthConnections(health) {
    const connections = health?.connections || [];
    return `
      <section class="panel st-health-panel">
        <div class="st-panel-head">
          <div class="panel-label">Connections</div>
          <div class="minor-text">${connections.length} total</div>
        </div>
        <div class="st-health-list">
          ${
            connections.length
              ? connections
                  .map(
                    (connection) => `
                      <article class="st-health-list-item">
                        <div>
                          <div class="st-health-item-title">${escapeHtml(connection.name || connection.id || "Connection")}</div>
                          <div class="minor-text">${escapeHtml(connection.note || connection.url || "")}</div>
                        </div>
                        <div class="st-health-list-item__badges">
                          ${renderBadge(connection.active ? "active" : "inactive", connection.active ? "ok" : "other")}
                        </div>
                      </article>
                    `,
                  )
                  .join("")
              : '<div class="st-empty-inline">No connections found.</div>'
          }
        </div>
      </section>
    `;
  }

  function renderHealthCron(health) {
    const rows = health?.cronEvents || [];
    return `
      <section class="panel st-health-panel">
        <div class="st-panel-head">
          <div class="panel-label">Recent Cron Events</div>
          <div class="minor-text">${rows.length} recent</div>
        </div>
        <div class="st-health-list">
          ${
            rows.length
              ? rows
                  .slice(0, 12)
                  .map(
                    (event) => `
                      <article class="st-health-list-item">
                        <div>
                          <div class="st-health-item-title">${escapeHtml(formatDate(event.time))}</div>
                          <div class="minor-text">${escapeHtml((event.events || []).join(" • "))}</div>
                        </div>
                        <div class="st-health-list-item__badges">
                          ${renderBadge(event.status || "ok")}
                        </div>
                      </article>
                    `,
                  )
                  .join("")
              : '<div class="st-empty-inline">No cron activity found.</div>'
          }
        </div>
      </section>
    `;
  }

  function renderHealthLogs(health) {
    const logSources = health?.log_sources || {};
    const sections = Object.entries(logSources);
    return `
      <section class="panel st-health-panel">
        <div class="st-panel-head">
          <div class="panel-label">Log Sources</div>
          <div class="minor-text">${sections.length} groups</div>
        </div>
        <div class="st-health-log-sections">
          ${
            sections.length
              ? sections
                  .map(([group, entries]) => {
                    const items = Object.entries(entries || {}).slice(0, 8);
                    return `
                      <div class="st-health-log-group">
                        <div class="st-health-log-group__title">${escapeHtml(group)}</div>
                        <div class="st-health-list">
                          ${
                            items.length
                              ? items
                                  .map(([name, detail]) => `
                                    <article class="st-health-list-item">
                                      <div>
                                        <div class="st-health-item-title">${escapeHtml(name)}</div>
                                        <div class="minor-text">${escapeHtml(detail?.last_activity ? `${formatRelative(detail.last_activity)} · ${formatDate(detail.last_activity)}` : "No activity")}</div>
                                      </div>
                                      <div class="st-health-list-item__badges">
                                        ${renderBadge(
                                          `${Object.keys(detail?.files || {}).length} files`,
                                          "other",
                                        )}
                                      </div>
                                    </article>
                                  `)
                                  .join("")
                              : '<div class="st-empty-inline">No log items.</div>'
                          }
                        </div>
                      </div>
                    `;
                  })
                  .join("")
              : '<div class="st-empty-inline">No log source data.</div>'
          }
        </div>
      </section>
    `;
  }

  function renderHealthPackages(health) {
    const packages = health?.packages || [];
    const diagnostics = health?.diagnostics || {};
    return `
      <section class="st-health-grid st-health-grid--secondary">
        <section class="panel st-health-panel">
          <div class="st-panel-head">
            <div class="panel-label">Packages</div>
            <div class="minor-text">${packages.length} total</div>
          </div>
          <div class="st-health-list">
            ${
              packages.length
                ? packages
                    .slice(0, 12)
                    .map(
                      (pkg) => `
                        <article class="st-health-list-item">
                          <div>
                            <div class="st-health-item-title">${escapeHtml(pkg.name || "package")}</div>
                            <div class="minor-text">${escapeHtml(pkg.path || "")}</div>
                          </div>
                          <div class="st-health-list-item__badges">
                            ${renderBadge(pkg.version || "private", pkg.version ? "ok" : "other")}
                          </div>
                        </article>
                      `,
                    )
                    .join("")
                : '<div class="st-empty-inline">No packages found.</div>'
            }
          </div>
        </section>
        <section class="panel st-health-panel">
          <div class="st-panel-head">
            <div class="panel-label">Diagnostics</div>
            <div class="minor-text">${Object.keys(diagnostics).length} sections</div>
          </div>
          <div class="st-health-diagnostics">
            <pre class="st-detail-pre">${escapeHtml(
              JSON.stringify(diagnostics, null, 2),
            )}</pre>
          </div>
        </section>
      </section>
    `;
  }

  function renderHealth() {
    const health = state.health || {};
    const healthView = el("healthView");
    if (!healthView) return;
    healthView.innerHTML = `
      <div class="stack-layout">
        ${renderHealthCards(health)}
        ${renderHealthSources(health)}
        <section class="st-health-grid st-health-grid--secondary">
          ${renderHealthServices(health)}
          ${renderHealthConnections(health)}
        </section>
        ${renderHealthCron(health)}
        ${renderHealthLogs(health)}
        ${renderHealthPackages(health)}
      </div>
    `;
    setHeaderStatus(health.ok ? "Healthy" : "Needs attention");
  }

  async function loadHealth() {
    setSyncStatus("Loading health...", true);
    setError("");
    try {
      const data = await api("/internal/health");
      state.health = data || {};
      renderHealth();
    } finally {
      setSyncStatus("", false);
    }
  }

  function reloadCurrent() {
    if (isBrowserMode()) return loadBrowserList();
    if (mode === "cache") return renderCacheRows();
    if (mode === "health") return loadHealth();
    return Promise.resolve();
  }

  async function initializeMode() {
    applyModeChrome();
    renderToolbar();
    if (isBrowserMode()) {
      await loadBrowserTree();
      await loadBrowserList();
      return;
    }
    if (mode === "health") {
      await loadHealth();
      return;
    }
    if (mode === "cache") {
      await loadCache();
    }
  }

  function applyContext(detail) {
    if (!detail || typeof detail !== "object") return;
    state.context = { ...state.context, ...detail };
  }

  window.addEventListener("42trade:context", (event) => {
    applyContext(event.detail || {});
    if (mode === "files") initializeMode();
  });
  window.addEventListener("42trade:theme", (event) =>
    applyContext(event.detail || {}),
  );
  window.addEventListener("42trade:locale", (event) =>
    applyContext(event.detail || {}),
  );
  applyContext(bridge?.getContext?.() || {});

  initializeMode().catch((error) => {
    setError(error?.message || "Failed to initialize");
    setHeaderStatus("Error");
  });
})();
