const state = {
  headers: [],
  rows: [],
  filteredRows: [],
  filters: [],
  ignoredColumns: new Set(),
  sourceName: "",
  page: 1,
  pageSize: 50,
  uniqueMac: false,
  uniqueWifi: false,
  macColumn: null,
  wifiColumn: null,
  typeColumn: null,
  authModeColumn: null,
  bleColumn: null,
  showWifi: true,
  showBle: true,
  showLte: true,
  activeTagFilters: {
    wifiAuthMode: new Set(),
    bleAuthMode: new Set(),
  },
};

const dom = {
  uploadInput: document.getElementById("uploadInput"),
  filtersContainer: document.getElementById("filtersContainer"),
  tagFiltersContainer: document.getElementById("tagFiltersContainer"),
  addFilterBtn: document.getElementById("addFilterBtn"),
  clearTagsBtn: document.getElementById("clearTagsBtn"),
  showWifiToggle: document.getElementById("showWifiToggle"),
  showBleToggle: document.getElementById("showBleToggle"),
  showLteToggle: document.getElementById("showLteToggle"),
  uniqueMacToggle: document.getElementById("uniqueMacToggle"),
  uniqueWifiToggle: document.getElementById("uniqueWifiToggle"),
  uniqueInfo: document.getElementById("uniqueInfo"),
  ignoreColumns: document.getElementById("ignoreColumns"),
  countLabel: document.getElementById("countLabel"),
  statusBadge: document.getElementById("statusBadge"),
  pageSizeSelect: document.getElementById("pageSizeSelect"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  pageInfo: document.getElementById("pageInfo"),
  downloadBtn: document.getElementById("downloadBtn"),
  tableHead: document.querySelector("#resultsTable thead"),
  tableBody: document.querySelector("#resultsTable tbody"),
};

const MAX_CSV_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 300000;
const MAX_COLUMNS = 256;
const MAX_CELL_CHARS = 10000;
const MAX_REGEX_LENGTH = 256;
const MAX_REGEX_ROWS = 50000;
const MAX_FILTERS = 20;
const FETCH_TIMEOUT_MS = 15000;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (ch === "\r") {
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function getTextByteLength(text) {
  return new Blob([text]).size;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function detectHeaderAndData(rawRows) {
  const rows = rawRows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
  if (rows.length === 0) {
    return { headers: [], dataRows: [] };
  }

  const firstCell = String(rows[0][0] || "").trim();
  if (firstCell.startsWith("WigleWifi-") && rows.length > 1) {
    return { headers: rows[1], dataRows: rows.slice(2) };
  }

  return { headers: rows[0], dataRows: rows.slice(1) };
}

function findHeader(headers, candidates) {
  const normalized = headers.map((h) => String(h).trim().toLowerCase());
  for (const c of candidates) {
    const idx = normalized.indexOf(c.toLowerCase());
    if (idx >= 0) {
      return headers[idx];
    }
  }
  return null;
}

function normalizeHeaderKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findHeaderLoose(headers, candidates) {
  const normalizedHeaders = headers.map((h) => ({ raw: h, key: normalizeHeaderKey(h) }));
  for (const candidate of candidates) {
    const key = normalizeHeaderKey(candidate);
    const exact = normalizedHeaders.find((h) => h.key === key);
    if (exact) {
      return exact.raw;
    }
    const partial = normalizedHeaders.find((h) => h.key.includes(key) || key.includes(h.key));
    if (partial) {
      return partial.raw;
    }
  }
  return null;
}

function validateWigleLikeCsv(headers) {
  const hasMac = Boolean(findHeader(headers, ["MAC", "BSSID", "MAC Address"]));
  const hasWifi = Boolean(findHeader(headers, ["SSID", "WiFi", "WIFI", "Network", "Name"]));
  const hasLat = Boolean(findHeader(headers, ["CurrentLatitude", "Latitude", "Lat"]));
  const hasLon = Boolean(findHeader(headers, ["CurrentLongitude", "Longitude", "Lon", "Lng"]));

  const missing = [];
  if (!hasMac) {
    missing.push("MAC/BSSID");
  }
  if (!hasWifi) {
    missing.push("SSID");
  }
  if (!hasLat) {
    missing.push("Latitude");
  }
  if (!hasLon) {
    missing.push("Longitude");
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

function loadCsvText(csvText, sourceName) {
  if (getTextByteLength(csvText) > MAX_CSV_BYTES) {
    throw new Error(`CSV too large. Maximum supported size is ${Math.floor(MAX_CSV_BYTES / (1024 * 1024))} MB.`);
  }

  const rawRows = parseCsv(csvText);
  const { headers, dataRows } = detectHeaderAndData(rawRows);
  const width = headers.length;
  const validation = validateWigleLikeCsv(headers);

  if (headers.length === 0 || headers.length > MAX_COLUMNS) {
    throw new Error(`Invalid CSV structure. Expected 1-${MAX_COLUMNS} columns.`);
  }
  if (dataRows.length > MAX_ROWS) {
    throw new Error(`CSV too large. Maximum supported rows: ${MAX_ROWS}.`);
  }
  const hasHugeCell = dataRows.some((row) => row.some((cell) => String(cell ?? "").length > MAX_CELL_CHARS));
  if (hasHugeCell) {
    throw new Error(`CSV contains oversized cell values (>${MAX_CELL_CHARS} chars).`);
  }

  if (!validation.ok) {
    throw new Error(`Invalid WiGLE CSV. Missing expected columns: ${validation.missing.join(", ")}`);
  }

  state.headers = headers;
  state.rows = dataRows.map((row) => {
    if (row.length < width) {
      return row.concat(Array(width - row.length).fill(""));
    }
    return row.slice(0, width);
  });
  state.sourceName = sourceName;
  state.filters = [];
  state.ignoredColumns.clear();
  state.page = 1;

  state.macColumn = findHeader(state.headers, ["MAC", "BSSID", "MAC Address"]);
  state.wifiColumn = findHeader(state.headers, ["SSID", "WiFi", "WIFI", "Network", "Name"]);
  state.typeColumn = findHeader(state.headers, ["TYPE", "Type", "type"]) || findHeaderLoose(state.headers, ["type"]);
  state.authModeColumn =
    findHeader(state.headers, ["AuthMode", "Authentication", "Auth"]) ||
    findHeaderLoose(state.headers, ["authmode", "authentication", "security"]);
  state.bleColumn =
    findHeader(state.headers, [
      "BLE Devices",
      "BLEDevices",
      "BLE Device",
      "BLE",
      "Bluetooth",
      "Bluetooth Devices",
    ]) ||
    findHeaderLoose(state.headers, [
      "bledevices",
      "bledevice",
      "bluetoothdevices",
      "bluetoothdevice",
      "btdevices",
      "btdevice",
      "deviceid",
    ]);
  state.activeTagFilters.wifiAuthMode.clear();
  state.activeTagFilters.bleAuthMode.clear();
  state.showWifi = true;
  state.showBle = true;
  state.showLte = true;
  dom.showWifiToggle.checked = true;
  dom.showBleToggle.checked = true;
  dom.showLteToggle.checked = true;

  dom.uniqueMacToggle.checked = false;
  dom.uniqueWifiToggle.checked = false;
  state.uniqueMac = false;
  state.uniqueWifi = false;

  renderFilters();
  renderTagFilters();
  renderIgnoreColumns();
  updateUniqueInfo();
  applyFilters();
  updateStatus();
}

function getCell(row, columnName) {
  const index = state.headers.indexOf(columnName);
  if (index < 0) {
    return "";
  }
  return String(row[index] ?? "");
}

function matchesFilter(value, operator, expected) {
  const actual = String(value ?? "");
  const target = String(expected ?? "");
  const actualLower = actual.toLowerCase();
  const targetLower = target.toLowerCase();

  if (operator === "contains") {
    return actualLower.includes(targetLower);
  }
  if (operator === "equals") {
    return actualLower === targetLower;
  }
  if (operator === "starts_with") {
    return actualLower.startsWith(targetLower);
  }
  if (operator === "ends_with") {
    return actualLower.endsWith(targetLower);
  }
  if (operator === "empty") {
    return actual.trim() === "";
  }
  if (operator === "not_empty") {
    return actual.trim() !== "";
  }
  return true;
}

function prepareActiveFilters() {
  const activeFilters = state.filters.filter((f) => f.column && f.operator);
  if (activeFilters.length > MAX_FILTERS) {
    return { filters: [], error: `Too many filters. Maximum is ${MAX_FILTERS}.` };
  }

  const prepared = [];
  for (const filter of activeFilters) {
    if (filter.operator !== "regex") {
      prepared.push(filter);
      continue;
    }

    const pattern = String(filter.value || "");
    if (pattern.length === 0) {
      return { filters: [], error: "Regex filter cannot be empty." };
    }
    if (pattern.length > MAX_REGEX_LENGTH) {
      return { filters: [], error: `Regex filter is too long (max ${MAX_REGEX_LENGTH} chars).` };
    }
    if (state.rows.length > MAX_REGEX_ROWS) {
      return {
        filters: [],
        error: `Regex filters are disabled for datasets larger than ${MAX_REGEX_ROWS} rows.`,
      };
    }

    let compiledRegex;
    try {
      compiledRegex = new RegExp(pattern, "i");
    } catch {
      return { filters: [], error: "Invalid regex filter." };
    }
    prepared.push({ ...filter, compiledRegex });
  }

  return { filters: prepared, error: null };
}

function matchesPreparedFilter(value, filter) {
  if (filter.operator === "regex" && filter.compiledRegex) {
    return filter.compiledRegex.test(String(value ?? ""));
  }
  return matchesFilter(value, filter.operator, filter.value);
}

function getRowOrigin(row) {
  if (!state.typeColumn) {
    return "other";
  }
  const value = getCell(row, state.typeColumn).trim().toLowerCase();
  if (value.includes("wifi") || value === "w") {
    return "wifi";
  }
  if (value.includes("ble") || value.includes("bluetooth") || value === "b" || value.includes("bt")) {
    return "ble";
  }
  if (value.includes("lte") || value === "l") {
    return "lte";
  }
  return "other";
}

function normalizeProtocolTag(tag) {
  const value = String(tag ?? "").trim();
  if (!value) {
    return "Uncategorized";
  }

  if (/^\d+$/.test(value)) {
    return "Uncategorized";
  }
  if (/^[^a-zA-Z0-9]+$/.test(value)) {
    return "Uncategorized";
  }
  if (/^[a-zA-Z]$/.test(value)) {
    return "Uncategorized";
  }
  if (!/[a-zA-Z]/.test(value)) {
    return "Uncategorized";
  }
  if (/[!?]/.test(value)) {
    return "Uncategorized";
  }

  return value;
}

function parseAuthModeTags(raw) {
  const cleaned = String(raw ?? "").replace(/[\[\]]/g, " ");
  const primary = cleaned
    .split(/[\s,;/|]+/)
    .map((v) => v.trim())
    .filter(Boolean);

  const expanded = [];
  for (const token of primary) {
    if (token.includes("+")) {
      for (const part of token.split("+")) {
        const p = part.trim();
        if (p) {
          expanded.push(normalizeProtocolTag(p));
        }
      }
    } else {
      expanded.push(normalizeProtocolTag(token));
    }
  }
  return Array.from(new Set(expanded.filter(Boolean)));
}

function parseBleDeviceTags(raw) {
  const cleaned = String(raw ?? "").replace(/[\[\]]/g, " ");
  const tags = cleaned
    .split(/[;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
  return Array.from(new Set(tags.length > 0 ? tags : ["Uncategorized"]));
}

function applyUniqueness(rows) {
  const keys = [];
  if (state.uniqueMac && state.macColumn) {
    keys.push(state.macColumn);
  }
  if (state.uniqueWifi && state.wifiColumn) {
    keys.push(state.wifiColumn);
  }
  if (keys.length === 0) {
    return rows;
  }

  const seen = new Set();
  const uniqueRows = [];
  for (const row of rows) {
    const key = keys.map((k) => getCell(row, k).trim().toLowerCase()).join("||");
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRows.push(row);
    }
  }
  return uniqueRows;
}

function applyFilters() {
  if (state.headers.length === 0) {
    state.filteredRows = [];
    renderTable();
    renderCounts();
    return;
  }

  const { filters: activeFilters, error } = prepareActiveFilters();
  if (error) {
    dom.statusBadge.textContent = `Filter error: ${error}`;
    return;
  }

  let results = state.rows.filter((row) =>
    activeFilters.every((f) => matchesPreparedFilter(getCell(row, f.column), f)),
  );
  results = results.filter((row) => {
    const origin = getRowOrigin(row);
    if (origin === "wifi" && !state.showWifi) {
      return false;
    }
    if (origin === "ble" && !state.showBle) {
      return false;
    }
    if (origin === "lte" && !state.showLte) {
      return false;
    }
    return true;
  });

  const wifiAuthActive = state.activeTagFilters.wifiAuthMode.size > 0;
  const bleAuthActive = state.activeTagFilters.bleAuthMode.size > 0;
  results = results.filter((row) => {
    if (!wifiAuthActive && !bleAuthActive) {
      return true;
    }
    const origin = getRowOrigin(row);
    if (origin === "wifi") {
      if (!wifiAuthActive) {
        return false;
      }
      const tags = parseAuthModeTags(getCell(row, state.authModeColumn)).map((t) => t.toLowerCase());
      return Array.from(state.activeTagFilters.wifiAuthMode).some((selected) => tags.includes(selected.toLowerCase()));
    }
    if (origin === "ble") {
      const authTags = parseAuthModeTags(getCell(row, state.authModeColumn)).map((t) => t.toLowerCase());
      const authHit =
        bleAuthActive && Array.from(state.activeTagFilters.bleAuthMode).some((selected) => authTags.includes(selected.toLowerCase()));
      return authHit;
    }
    return false;
  });

  results = applyUniqueness(results);
  state.filteredRows = results;
  state.page = 1;

  renderCounts();
  renderTable();
}

function buildTagSection(kind, title, tags, activeSet) {
  const chips = tags
    .map((tag) => {
      const active = activeSet.has(tag) ? "active" : "";
      return `<button type="button" class="tag-chip ${active}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
    })
    .join("");
  const content = chips || `<div class="muted">No tags found</div>`;
  return `<div class="tag-filter-group" data-kind="${escapeHtml(kind)}"><div class="tag-box-title">${escapeHtml(title)}</div><div class="tag-list">${content}</div></div>`;
}

function renderTagFilters() {
  if (state.headers.length === 0) {
    dom.tagFiltersContainer.innerHTML = "";
    return;
  }

  const wifiAuthTags = new Set();
  const bleAuthTags = new Set();

  if (state.authModeColumn) {
    for (const row of state.rows) {
      const origin = getRowOrigin(row);
      if (origin === "wifi") {
        for (const t of parseAuthModeTags(getCell(row, state.authModeColumn))) {
          wifiAuthTags.add(t);
        }
      }
      if (origin === "ble") {
        for (const t of parseAuthModeTags(getCell(row, state.authModeColumn))) {
          bleAuthTags.add(t);
        }
      }
    }
  }
  const wifiAuthList = Array.from(wifiAuthTags).sort((a, b) => a.localeCompare(b)).slice(0, 80);
  const bleAuthList = Array.from(bleAuthTags).sort((a, b) => a.localeCompare(b)).slice(0, 80);
  const html = [
    buildTagSection("wifi_auth", "WiFi AuthMode Tags", wifiAuthList, state.activeTagFilters.wifiAuthMode),
    buildTagSection("ble_auth", "BLE/BT AuthMode Tags", bleAuthList, state.activeTagFilters.bleAuthMode),
  ].join("");

  dom.tagFiltersContainer.innerHTML = html;

  dom.tagFiltersContainer.querySelectorAll(".tag-filter-group").forEach((group) => {
    const kind = group.dataset.kind || "";
    group.querySelectorAll(".tag-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const tag = chip.dataset.tag || "";
        const targetSet =
          kind === "wifi_auth"
            ? state.activeTagFilters.wifiAuthMode
            : state.activeTagFilters.bleAuthMode;
        if (targetSet.has(tag)) {
          targetSet.delete(tag);
        } else {
          targetSet.add(tag);
        }
        renderTagFilters();
        applyFilters();
      });
    });
  });
}

function renderCounts() {
  dom.countLabel.textContent = `${state.filteredRows.length} / ${state.rows.length} rows`;
}

function updateStatus() {
  if (!state.sourceName) {
    dom.statusBadge.textContent = "No CSV loaded";
    return;
  }
  dom.statusBadge.textContent = `Loaded: ${state.sourceName}`;
}

function visibleHeaders() {
  return state.headers.filter((h) => !state.ignoredColumns.has(h));
}

function renderIgnoreColumns() {
  dom.ignoreColumns.innerHTML = "";
  if (state.headers.length === 0) {
    dom.ignoreColumns.innerHTML = `<div class="muted">Load a CSV first.</div>`;
    return;
  }

  for (const header of state.headers) {
    const id = `ignore-${header.replace(/[^a-z0-9]/gi, "-")}`;
    const checked = state.ignoredColumns.has(header) ? "checked" : "";
    const item = document.createElement("label");
    item.className = "col-item";
    item.innerHTML = `
      <input type="checkbox" id="${escapeHtml(id)}" ${checked}>
      <span>${escapeHtml(header)}</span>
    `;
    const input = item.querySelector("input");
    input.addEventListener("change", () => {
      if (input.checked) {
        state.ignoredColumns.add(header);
      } else {
        state.ignoredColumns.delete(header);
      }
      renderTable();
    });
    dom.ignoreColumns.appendChild(item);
  }
}

function createFilter(defaults = { column: "", operator: "contains", value: "" }) {
  const filterableHeaders = state.headers.filter((h) => h !== state.typeColumn);
  const fallbackColumn = filterableHeaders[0] || "";
  return {
    column: defaults.column || fallbackColumn,
    operator: defaults.operator || "contains",
    value: defaults.value || "",
  };
}

function renderFilters() {
  dom.filtersContainer.innerHTML = "";
  if (state.headers.length === 0) {
    dom.filtersContainer.innerHTML = `<div class="muted">Load a CSV first.</div>`;
    return;
  }

  if (state.filters.length === 0) {
    state.filters.push(createFilter());
  }

  state.filters.forEach((filter, index) => {
    const row = document.createElement("div");
    row.className = "filter-row";

    const filterableHeaders = state.headers.filter((h) => h !== state.typeColumn);
    if (!filterableHeaders.includes(filter.column)) {
      state.filters[index].column = filterableHeaders[0] || "";
    }
    const colOptions = filterableHeaders
      .map((h) => `<option value="${escapeHtml(h)}" ${h === filter.column ? "selected" : ""}>${escapeHtml(h)}</option>`)
      .join("");

    row.innerHTML = `
      <select class="filter-column">${colOptions}</select>
      <select class="filter-operator">
        <option value="contains" ${filter.operator === "contains" ? "selected" : ""}>contains</option>
        <option value="equals" ${filter.operator === "equals" ? "selected" : ""}>equals</option>
        <option value="starts_with" ${filter.operator === "starts_with" ? "selected" : ""}>starts with</option>
        <option value="ends_with" ${filter.operator === "ends_with" ? "selected" : ""}>ends with</option>
        <option value="regex" ${filter.operator === "regex" ? "selected" : ""}>regex</option>
        <option value="empty" ${filter.operator === "empty" ? "selected" : ""}>is empty</option>
        <option value="not_empty" ${filter.operator === "not_empty" ? "selected" : ""}>is not empty</option>
      </select>
      <input class="filter-value" type="text" value="${escapeHtml(filter.value)}" placeholder="value">
      <button class="remove-filter" type="button">Remove</button>
    `;

    const col = row.querySelector(".filter-column");
    const op = row.querySelector(".filter-operator");
    const val = row.querySelector(".filter-value");
    const remove = row.querySelector(".remove-filter");

    col.addEventListener("change", () => {
      state.filters[index].column = col.value;
      applyFilters();
    });
    op.addEventListener("change", () => {
      state.filters[index].operator = op.value;
      applyFilters();
    });
    val.addEventListener("input", () => {
      state.filters[index].value = val.value;
      applyFilters();
    });
    remove.addEventListener("click", () => {
      state.filters.splice(index, 1);
      renderFilters();
      applyFilters();
    });

    dom.filtersContainer.appendChild(row);
  });
}

function updateUniqueInfo() {
  const parts = [];
  if (state.uniqueMac) {
    parts.push(`MAC: ${state.macColumn || "not found"}`);
  }
  if (state.uniqueWifi) {
    parts.push(`WiFi: ${state.wifiColumn || "not found"}`);
  }
  dom.uniqueInfo.textContent = parts.length > 0 ? `Using ${parts.join(" | ")}` : "No dedupe active";
}

function renderTable() {
  dom.tableHead.innerHTML = "";
  dom.tableBody.innerHTML = "";

  const headers = visibleHeaders();
  if (headers.length === 0) {
    dom.tableHead.innerHTML = "<tr><th>No visible columns</th></tr>";
    dom.pageInfo.textContent = "Page 1 / 1";
    return;
  }

  const totalRows = state.filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
  state.page = Math.min(state.page, totalPages);

  const start = (state.page - 1) * state.pageSize;
  const end = start + state.pageSize;
  const pageRows = state.filteredRows.slice(start, end);

  const headerHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  dom.tableHead.innerHTML = `<tr>${headerHtml}</tr>`;

  const headerIndices = headers.map((h) => state.headers.indexOf(h));
  const bodyHtml = pageRows
    .map((row) => {
      const cells = headerIndices
        .map((i) => {
          const header = state.headers[i];
          const raw = row[i] ?? "";
          if (header === state.typeColumn) {
            const origin = getRowOrigin(row);
            const label = origin === "wifi" ? "WiFi" : origin === "ble" ? "BLE/BT" : origin === "lte" ? "LTE" : String(raw || "Other");
            return `<td><span class="origin-pill origin-${escapeHtml(origin)}">${escapeHtml(label)}</span></td>`;
          }
          if (header === state.authModeColumn) {
            const tags = parseAuthModeTags(raw).map((t) => `<span class="cell-tag">${escapeHtml(t)}</span>`).join("");
            return `<td><div class="cell-tag-wrap">${tags || escapeHtml(raw)}</div></td>`;
          }
          if (header === state.bleColumn) {
            const tags = parseBleDeviceTags(raw).map((t) => `<span class="cell-tag">${escapeHtml(t)}</span>`).join("");
            return `<td><div class="cell-tag-wrap">${tags || escapeHtml(raw)}</div></td>`;
          }
          return `<td>${escapeHtml(raw)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  dom.tableBody.innerHTML = bodyHtml || `<tr><td colspan="${headers.length}">No matching rows</td></tr>`;
  dom.pageInfo.textContent = `Page ${state.page} / ${totalPages}`;
}

function csvEscape(value) {
  let str = String(value ?? "");
  // Neutralize formula-injection vectors in exported CSV files.
  if (/^[=+\-@]/.test(str.trimStart())) {
    str = `'${str}`;
  }
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

function buildFilteredCsv() {
  const headers = visibleHeaders();
  const headerIndices = headers.map((h) => state.headers.indexOf(h));
  const lines = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const row of state.filteredRows) {
    lines.push(headerIndices.map((i) => csvEscape(row[i] ?? "")).join(","));
  }
  return lines.join("\n");
}

function downloadFilteredCsv() {
  if (state.headers.length === 0) {
    return;
  }
  const csv = buildFilteredCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const base = state.sourceName.replace(/\.csv$/i, "");
  const filename = `${base || "wigle"}_filtered.csv`;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function handleUpload(event) {
  try {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }
    const isCsvName = /\.csv$/i.test(file.name || "");
    const isCsvType = !file.type || file.type === "text/csv" || file.type === "application/vnd.ms-excel";
    if (!isCsvName || !isCsvType) {
      dom.statusBadge.textContent = "Upload blocked: only .csv files are allowed.";
      event.target.value = "";
      return;
    }
    if (file.size > MAX_CSV_BYTES) {
      dom.statusBadge.textContent = "Upload blocked: CSV is larger than 25 MB.";
      event.target.value = "";
      return;
    }
    const text = await file.text();
    loadCsvText(text, file.name);
  } catch (error) {
    dom.statusBadge.textContent = `Error: ${String(error.message || error)}`;
    event.target.value = "";
  }
}

function attachEvents() {
  dom.addFilterBtn.addEventListener("click", () => {
    if (state.headers.length === 0) {
      return;
    }
    if (state.filters.length >= MAX_FILTERS) {
      dom.statusBadge.textContent = `Filter limit reached (${MAX_FILTERS}).`;
      return;
    }
    state.filters.push(createFilter());
    renderFilters();
    applyFilters();
  });

  dom.clearTagsBtn.addEventListener("click", () => {
    state.activeTagFilters.wifiAuthMode.clear();
    state.activeTagFilters.bleAuthMode.clear();
    renderTagFilters();
    applyFilters();
  });

  dom.showWifiToggle.addEventListener("change", () => {
    state.showWifi = dom.showWifiToggle.checked;
    applyFilters();
  });

  dom.showBleToggle.addEventListener("change", () => {
    state.showBle = dom.showBleToggle.checked;
    applyFilters();
  });

  dom.showLteToggle.addEventListener("change", () => {
    state.showLte = dom.showLteToggle.checked;
    applyFilters();
  });

  dom.uniqueMacToggle.addEventListener("change", () => {
    state.uniqueMac = dom.uniqueMacToggle.checked;
    updateUniqueInfo();
    applyFilters();
  });

  dom.uniqueWifiToggle.addEventListener("change", () => {
    state.uniqueWifi = dom.uniqueWifiToggle.checked;
    updateUniqueInfo();
    applyFilters();
  });

  dom.pageSizeSelect.addEventListener("change", () => {
    state.pageSize = Number(dom.pageSizeSelect.value);
    state.page = 1;
    renderTable();
  });

  dom.prevPageBtn.addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    renderTable();
  });

  dom.nextPageBtn.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
    state.page = Math.min(totalPages, state.page + 1);
    renderTable();
  });

  dom.downloadBtn.addEventListener("click", () => {
    downloadFilteredCsv();
  });

  dom.uploadInput.addEventListener("change", handleUpload);
}

async function init() {
  attachEvents();
  renderTagFilters();
}

init().catch((error) => {
  dom.statusBadge.textContent = `Init error: ${String(error.message || error)}`;
});
