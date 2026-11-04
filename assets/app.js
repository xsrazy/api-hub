"use strict";

(function () {
  var MAX_DISPLAY = 8000;
  var PAGE_SIZE = 60;

  var checkMap = new Map();
  var checkedAt = null;
  var checkLoaded = false;
  var activeCategory = "all";
  var activeAuth = "all";
  var ownOnly = false;
  var searchQuery = "";
  var currentPage = 1;
  var totalPages = 1;
  var totalResults = 0;
  var categories = [];
  var categoriesKey = "";
  var directoryRequestId = 0;
  var directoryLoadedOnce = false;
  var searchTimer = null;

  var NO_STATUS_IDS = {
    "gutendex": true,
    "dictionary-api": true,
    "coingecko": true,
  };

  var directoryGrid = document.getElementById("directory-grid");
  var directoryEmpty = document.getElementById("directory-empty");
  var directoryError = document.getElementById("directory-error");
  var directoryLastChecked = document.getElementById("directory-last-checked");
  var directoryCount = document.getElementById("directory-count");
  var paginationPrev = document.getElementById("pagination-prev");
  var paginationNext = document.getElementById("pagination-next");
  var paginationInfo = document.getElementById("pagination-info");
  var paginationPages = document.getElementById("pagination-pages");
  var categoryChips = document.getElementById("category-chips");
  var searchInput = document.getElementById("directory-search");
  var authFilter = document.getElementById("auth-filter");
  var ownGrid = document.getElementById("own-grid");
  var ownError = document.getElementById("own-error");
  var themeToggle = document.getElementById("theme-toggle");
  var statTotal = document.getElementById("stat-total");
  var statOwn = document.getElementById("stat-own");
  var statChecked = document.getElementById("stat-checked");

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function slugify(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function isSafeHttpUrl(url) {
    if (typeof url !== "string" || url === "") return false;
    return (/^https?:\/\//i).test(url) || url.charAt(0) === "/";
  }

  function ownRequest(req, entry) {
    if (!entry || entry.source !== "own") return req;
    try {
      var parsed = new URL(req.url);
      return { url: window.location.origin + parsed.pathname + parsed.search + parsed.hash, method: req.method, headers: req.headers, body: req.body };
    } catch (e) { return req; }
  }

  function authLabel(auth) {
    if (auth === "none") return "No key";
    if (auth === "apiKey") return "API key";
    if (auth === "OAuth") return "OAuth";
    return "Authentication unknown";
  }

  function formatCheckedAt(value) {
    if (!value) return null;
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    try { return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return date.toString(); }
  }

  function formatShortCheckedAt(value) {
    if (!value) return null;
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    try { return date.toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return date.toString(); }
  }

  function substitutePlaceholders(text, values) {
    return String(text).replace(/\{([^}]+)\}/g, function (match, key) {
      if (Object.prototype.hasOwnProperty.call(values, key)) return String(values[key]);
      return match;
    });
  }

  function normalizeHeaders(headers, values) {
    var result = {};
    if (Array.isArray(headers)) {
      headers.forEach(function (item) {
        if (!item) return;
        var key = item.key || item.name || item.header;
        var value = item.value !== undefined ? item.value : "";
        if (key) result[String(key)] = substitutePlaceholders(String(value), values);
      });
    } else if (headers && typeof headers === "object") {
      Object.keys(headers).forEach(function (key) { result[key] = substitutePlaceholders(String(headers[key]), values); });
    }
    return result;
  }

  function substituteBody(body, values) {
    if (typeof body === "string") return substitutePlaceholders(body, values);
    if (Array.isArray(body)) return JSON.stringify(body.map(function (item) { return deepSubstitute(item, values); }), null, 2);
    if (body && typeof body === "object") return JSON.stringify(deepSubstitute(body, values), null, 2);
    return body;
  }

  function deepSubstitute(value, values) {
    if (typeof value === "string") return substitutePlaceholders(value, values);
    if (Array.isArray(value)) return value.map(function (item) { return deepSubstitute(item, values); });
    if (value && typeof value === "object") {
      var out = {};
      Object.keys(value).forEach(function (key) { out[key] = deepSubstitute(value[key], values); });
      return out;
    }
    return value;
  }

  function buildRequest(def, values) {
    var safeDef = def || {};
    var method = String(safeDef.method || "GET").toUpperCase();
    var params = Array.isArray(safeDef.params) ? safeDef.params : [];
    var consumed = {};
    var urlTemplate = String(safeDef.url || "");
    var urlWithPlaceholders = urlTemplate.replace(/\{([^}]+)\}/g, function (match, key) {
      if (Object.prototype.hasOwnProperty.call(values, key)) { consumed[key] = true; return encodeURIComponent(String(values[key])); }
      return match;
    });
    var urlObj;
    try { urlObj = new URL(urlWithPlaceholders, window.location.origin); } catch (e) { urlObj = new URL(window.location.origin); }
    var remaining = [];
    params.forEach(function (param) {
      if (!param || !param.key) return;
      var key = String(param.key);
      if (consumed[key]) return;
      var value = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : param.value;
      if (value === undefined || value === null || value === "") return;
      remaining.push({ key: key, value: String(value) });
    });
    var headers = normalizeHeaders(safeDef.headers, values);
    var body;
    if (method === "GET" || method === "HEAD") {
      remaining.forEach(function (item) { urlObj.searchParams.set(item.key, item.value); });
      body = undefined;
    } else if (safeDef.body !== undefined && safeDef.body !== null) {
      body = substituteBody(safeDef.body, values);
    } else if (remaining.length > 0) {
      var bodyObj = {};
      remaining.forEach(function (item) { bodyObj[item.key] = item.value; });
      body = JSON.stringify(bodyObj);
      var hasContentType = Object.keys(headers).some(function (key) { return key.toLowerCase() === "content-type"; });
      if (!hasContentType) headers["Content-Type"] = "application/json";
    }
    return { url: urlObj.href, method: method, headers: headers, body: body };
  }

  function shellQuote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }

  function buildCurlSnippet(req) {
    var parts = ["curl -X " + req.method + " " + shellQuote(req.url)];
    Object.keys(req.headers).forEach(function (key) { parts.push("-H " + shellQuote(key + ": " + req.headers[key])); });
    if (req.body !== undefined && req.body !== null) parts.push("--data " + shellQuote(req.body));
    return parts.join(" \\\n  ");
  }

  function buildFetchSnippet(req) {
    var options = [];
    options.push("method: " + JSON.stringify(req.method));
    if (Object.keys(req.headers).length > 0) {
      var headersText = JSON.stringify(req.headers, null, 2).replace(/\n/g, "\n  ");
      options.push("headers: " + headersText);
    }
    if (req.body !== undefined && req.body !== null) options.push("body: " + JSON.stringify(req.body));
    var lines = [];
    lines.push("const response = await fetch(" + JSON.stringify(req.url) + ", {");
    lines.push("  " + options.join(",\n  "));
    lines.push("});");
    lines.push("const data = await response.json();");
    lines.push("console.log(data);");
    return lines.join("\n");
  }

  function capDisplay(text) {
    if (text.length > MAX_DISPLAY) return text.slice(0, MAX_DISPLAY) + "\n\n[Partially shown, response truncated.]";
    return text;
  }

  function prettyOrRaw(text) {
    if (text === "") return "(Empty response.)";
    try { return capDisplay(JSON.stringify(JSON.parse(text), null, 2)); } catch (e) { return capDisplay(text); }
  }

  function formatProxyBody(body) {
    if (body === undefined || body === null) return "(Empty response.)";
    if (typeof body === "string") return prettyOrRaw(body);
    return capDisplay(JSON.stringify(body, null, 2));
  }

  function statusForId(id) {
    var entry = checkMap.get(id);
    if (!entry || entry.state === "unknown") return { cls: "unknown", text: "Status unknown", checkedAt: null };
    if (entry.state === "botwall") return { cls: "unknown", text: "Bot-limited", checkedAt: entry.checkedAt || null };
    if (entry.state === "neutral") return { cls: "unknown", text: "Needs parameters", checkedAt: entry.checkedAt || null };
    if (entry.ok) {
      var okText = "Online";
      if (entry.ms !== undefined && entry.ms !== null) okText += " (" + entry.ms + " ms)";
      return { cls: "ok", text: okText, checkedAt: entry.checkedAt || null };
    }
    var downText = "Unavailable";
    if (entry.status !== undefined && entry.status !== null && entry.status !== "") downText += " (HTTP " + entry.status + ")";
    return { cls: "down", text: downText, checkedAt: entry.checkedAt || null };
  }

  function fillStatusLine(line, id) {
    // Bot-wall: no status line at all, same as noStatus entries in production.
    var raw = checkMap.get(id);
    if (raw && raw.state === "botwall") { line.hidden = true; line.replaceChildren(); return; }
    line.hidden = false;
    var status = statusForId(id);
    line.replaceChildren();
    var pill = el("span", "status-pill");
    var dot = el("span", "dot " + status.cls);
    dot.setAttribute("aria-hidden", "true");
    pill.appendChild(dot);
    pill.appendChild(document.createTextNode(status.text));
    line.appendChild(pill);
    var shortChecked = formatShortCheckedAt(status.checkedAt);
    if (shortChecked) line.appendChild(el("span", "checked-at", "checked " + shortChecked));
  }

  function refreshStatuses() {
    document.querySelectorAll("[data-status-id]").forEach(function (line) {
      fillStatusLine(line, line.getAttribute("data-status-id"));
    });
  }

  function renderLastChecked() {
    var formatted = formatCheckedAt(checkedAt);
    if (formatted) {
      directoryLastChecked.textContent = "Last rolling check: " + formatted + ". Each entry shows its own last-checked time.";
      if (statChecked) statChecked.textContent = "Last checked " + formatted + ".";
    } else {
      directoryLastChecked.textContent = "Status not available yet. Statuses are checked on rotation with caching, not in realtime; each entry shows its own last-checked time once checked.";
    }
  }

  function copyText(text, button) {
    function showCopied(btn) {
      btn.textContent = "Copied";
      window.setTimeout(function () { btn.textContent = "Copy"; }, 1500);
    }
    function fallbackCopy() {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand("copy"); } catch (e) { /* ignore */ }
      document.body.removeChild(textarea);
      showCopied(button);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showCopied(button); }, fallbackCopy);
    } else { fallbackCopy(); }
  }

  function createCard(entry, prefix, index) {
    var card = el("article", "card");
    card.appendChild(el("h3", null, entry.name || "Unnamed"));

    var badges = el("ul", "badges");
    if (entry.source === "own") badges.appendChild(el("li", "badge own", "Original APIs"));
    badges.appendChild(el("li", "badge", authLabel(entry.auth)));
    badges.appendChild(el("li", "badge", entry.https ? "HTTPS" : "HTTP"));
    var corsText = "CORS: unknown";
    if (entry.cors === "yes") corsText = "CORS: yes";
    else if (entry.cors === "no") corsText = "CORS: no";
    badges.appendChild(el("li", "badge", corsText));
    if (entry.category) badges.appendChild(el("li", "badge", String(entry.category)));
    card.appendChild(badges);

    if (entry.description) card.appendChild(el("p", "card-desc", entry.description));

    var def = entry.sandbox || null;
    var docHref = entry.url;
    if (entry.source === "own") {
      var docMethod = def ? String(def.method || "GET").toUpperCase() : "GET";
      if (!def || docMethod !== "GET") {
        docHref = null;
      } else {
        var defaultValues = {};
        (Array.isArray(def.params) ? def.params : []).forEach(function (param) {
          if (param && param.key) defaultValues[String(param.key)] = param.value !== undefined && param.value !== null ? String(param.value) : "";
        });
        docHref = ownRequest(buildRequest(def, defaultValues), entry).url;
      }
    }
    if (docHref && isSafeHttpUrl(docHref)) {
      var docLink = el("a", "doc-link", "Documentation");
      docLink.href = docHref;
      docLink.target = "_blank";
      docLink.rel = "noopener";
      card.appendChild(docLink);
    }

    if (!NO_STATUS_IDS[entry.id] && !entry.noStatus) {
      var statusLine = el("p", "status-line");
      statusLine.setAttribute("data-status-id", String(entry.id));
      fillStatusLine(statusLine, String(entry.id));
      card.appendChild(statusLine);
    }

    if (def) {
      var values = {};
      (Array.isArray(def.params) ? def.params : []).forEach(function (param) {
        if (param && param.key) values[String(param.key)] = param.value !== undefined && param.value !== null ? String(param.value) : "";
      });

      var snippets = el("div", "snippets");
      var tabRow = el("div", "snippet-tabs");
      var curlButton = el("button", "tab-button", "cURL");
      curlButton.type = "button";
      curlButton.setAttribute("aria-selected", "true");
      var fetchButton = el("button", "tab-button", "JavaScript");
      fetchButton.type = "button";
      fetchButton.setAttribute("aria-selected", "false");
      var copyButton = el("button", "copy-button btn secondary small", "Copy");
      copyButton.type = "button";
      tabRow.appendChild(curlButton);
      tabRow.appendChild(fetchButton);
      tabRow.appendChild(copyButton);
      snippets.appendChild(tabRow);
      var curlPre = el("pre");
      var curlCode = el("code");
      curlPre.appendChild(curlCode);
      var fetchPre = el("pre");
      fetchPre.hidden = true;
      var fetchCode = el("code");
      fetchPre.appendChild(fetchCode);
      snippets.appendChild(curlPre);
      snippets.appendChild(fetchPre);
      card.appendChild(snippets);

      var currentTab = "curl";
      function refreshSnippets() {
        var req = ownRequest(buildRequest(def, values), entry);
        curlCode.textContent = buildCurlSnippet(req);
        fetchCode.textContent = buildFetchSnippet(req);
      }
      refreshSnippets();

      curlButton.addEventListener("click", function () {
        currentTab = "curl";
        curlButton.setAttribute("aria-selected", "true");
        fetchButton.setAttribute("aria-selected", "false");
        curlPre.hidden = false;
        fetchPre.hidden = true;
      });
      fetchButton.addEventListener("click", function () {
        currentTab = "fetch";
        fetchButton.setAttribute("aria-selected", "true");
        curlButton.setAttribute("aria-selected", "false");
        fetchPre.hidden = false;
        curlPre.hidden = true;
      });
      copyButton.addEventListener("click", function () {
        copyText(currentTab === "curl" ? curlCode.textContent : fetchCode.textContent, copyButton);
      });

      var actions = el("div", "card-actions");
      var toggleButton = el("button", "btn secondary small", "Try it");
      toggleButton.type = "button";
      var panelId = prefix + "-sandbox-panel-" + index;
      toggleButton.setAttribute("aria-expanded", "false");
      toggleButton.setAttribute("aria-controls", panelId);
      actions.appendChild(toggleButton);
      card.appendChild(actions);

      var panel = el("div", "panel");
      panel.id = panelId;
      panel.hidden = true;

      (Array.isArray(def.params) ? def.params : []).forEach(function (param) {
        if (!param || !param.key) return;
        var key = String(param.key);
        var field = el("div", "param-field");
        var label = el("label", null, param.label || key);
        var inputId = panelId + "-" + slugify(key);
        label.htmlFor = inputId;
        var input = document.createElement("input");
        input.type = "text";
        input.id = inputId;
        input.value = values[key];
        input.addEventListener("input", function () { values[key] = input.value; refreshSnippets(); });
        field.appendChild(label);
        field.appendChild(input);
        panel.appendChild(field);
      });

      var sendButton = el("button", "btn small", "Send");
      sendButton.type = "button";
      panel.appendChild(sendButton);

      var viewer = el("div", "response-viewer");
      var meta = el("p", "response-meta", "No response yet. Press Send to try this request.");
      var responsePre = el("pre");
      var responseCode = el("code");
      responsePre.appendChild(responseCode);
      viewer.appendChild(meta);
      viewer.appendChild(responsePre);
      panel.appendChild(viewer);

      toggleButton.addEventListener("click", function () {
        var willShow = panel.hidden;
        panel.hidden = !willShow;
        toggleButton.setAttribute("aria-expanded", willShow ? "true" : "false");
        toggleButton.textContent = willShow ? "Close panel" : "Try it";
      });
      sendButton.addEventListener("click", function () { runSandbox(entry, def, values, meta, responseCode, sendButton); });
      card.appendChild(panel);
    } else {
      card.appendChild(el("p", "card-desc", "No sample request for this API yet."));
    }
    return card;
  }

  function runSandbox(entry, def, values, metaEl, codeEl, sendButton) {
    var req = ownRequest(buildRequest(def, values), entry);
    var isOwn = entry.source === "own";
    var useProxy = req.method === "GET" && !isOwn;
    sendButton.disabled = true;
    metaEl.textContent = "Loading...";
    codeEl.textContent = "";
    var started = performance.now();
    var fetchPromise;
    if (useProxy) {
      fetchPromise = fetch("/api/proxy?url=" + encodeURIComponent(req.url), { method: "GET" }).then(function (res) {
        return res.json().then(function (data) { return { kind: "proxy", data: data, httpOk: res.ok }; });
      });
    } else {
      var options = { method: req.method, headers: req.headers };
      if (req.body !== undefined) options.body = req.body;
      fetchPromise = fetch(req.url, options).then(function (res) {
        return res.text().then(function (text) { return { kind: "direct", status: res.status, text: text }; });
      });
    }
    fetchPromise.then(function (outcome) {
      var elapsed = Math.round(performance.now() - started);
      if (outcome.kind === "proxy") {
        var data = outcome.data || {};
        var statusText = data.status !== undefined && data.status !== null ? String(data.status) : "unknown";
        var msText = data.ms !== undefined && data.ms !== null ? String(data.ms) : String(elapsed);
        var note = data.truncated ? " Response truncated by the proxy." : "";
        metaEl.textContent = "Status: " + statusText + ", time: " + msText + " ms." + note;
        codeEl.textContent = formatProxyBody(data.body);
      } else {
        metaEl.textContent = "Status: " + outcome.status + ", time: " + elapsed + " ms.";
        codeEl.textContent = prettyOrRaw(outcome.text);
      }
    }).catch(function () {
      metaEl.textContent = "Request failed. The service cannot be reached right now, please try again later.";
      codeEl.textContent = "";
    }).then(function () { sendButton.disabled = false; });
  }

  function showSkeletons(grid, count) {
    grid.replaceChildren();
    for (var i = 0; i < count; i++) grid.appendChild(el("div", "skeleton"));
  }

  function renderPagination() {
    if (paginationInfo) paginationInfo.textContent = "Page " + currentPage + " of " + totalPages;
    if (paginationPrev) paginationPrev.disabled = currentPage <= 1;
    if (paginationNext) paginationNext.disabled = currentPage >= totalPages;
    if (!paginationPages) return;
    paginationPages.replaceChildren();
    var startPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
    var endPage = Math.min(totalPages, startPage + 4);
    for (var p = startPage; p <= endPage; p++) {
      (function (pageNum) {
        var btn = el("button", "page-btn", String(pageNum));
        btn.type = "button";
        if (pageNum === currentPage) btn.setAttribute("aria-current", "page");
        btn.addEventListener("click", function () { goToPage(pageNum); });
        paginationPages.appendChild(btn);
      })(p);
    }
  }

  function goToPage(page) {
    if (page < 1 || page > totalPages || page === currentPage) return;
    currentPage = page;
    loadDirectory(false);
    var section = document.getElementById("directory");
    if (section && section.scrollIntoView) section.scrollIntoView({ block: "start" });
  }

  function syncPageUrl() {
    try {
      var url = new URL(window.location.href);
      if (currentPage > 1) url.searchParams.set("page", String(currentPage));
      else url.searchParams.delete("page");
      window.history.replaceState(null, "", url.toString());
    } catch (e) { /* ignore */ }
  }

  function catalogUrl(page) {
    var params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    params.set("category", activeCategory);
    params.set("auth", activeAuth);
    if (ownOnly) params.set("own", "1");
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    return "/api/catalog?" + params.toString();
  }

  function loadDirectory(showSkeleton) {
    var requestId = ++directoryRequestId;
    syncPageUrl();
    if (showSkeleton && !directoryLoadedOnce) showSkeletons(directoryGrid, 6);
    directoryError.hidden = true;
    fetch(catalogUrl(currentPage)).then(function (res) {
      if (!res.ok) throw new Error("catalog failed");
      return res.json();
    }).then(function (data) {
      if (requestId !== directoryRequestId) return;
      directoryLoadedOnce = true;
      var entries = Array.isArray(data.entries) ? data.entries : [];
      totalResults = data.total || 0;
      totalPages = data.totalPages || 1;
      currentPage = data.page || currentPage;
      syncPageUrl();
      if (Array.isArray(data.categories)) {
        categories = data.categories;
        renderCategoryChips();
      }
      if (statTotal) statTotal.textContent = String(data.totalDisplayed || totalResults);
      if (statOwn) statOwn.textContent = String(data.ownCount || 0);
      directoryGrid.replaceChildren();
      entries.forEach(function (entry, index) {
        directoryGrid.appendChild(createCard(entry, "dir", (currentPage - 1) * PAGE_SIZE + index));
      });
      directoryEmpty.hidden = totalResults !== 0;
      renderPagination();
      if (directoryCount) {
        if (totalResults === 0) {
          directoryCount.textContent = "No matching entries.";
        } else {
          var start = (currentPage - 1) * PAGE_SIZE;
          var end = Math.min(start + entries.length, totalResults);
          directoryCount.textContent = "Showing " + (start + 1) + "-" + end + " of " + totalResults + " entries.";
        }
      }
    }).catch(function () {
      if (requestId !== directoryRequestId) return;
      directoryError.hidden = false;
      directoryError.textContent = "The API list could not be loaded right now. Please reload the page and try again.";
      directoryGrid.replaceChildren();
      directoryEmpty.hidden = true;
    });
  }

  function renderCategoryChips() {
    var key = categories.join("|") + "#" + activeCategory + "#" + (ownOnly ? "own" : "all");
    if (key === categoriesKey) return;
    categoriesKey = key;
    categoryChips.replaceChildren();
    function addChip(label, pressed, isOwn, onClick) {
      var chip = el("button", isOwn ? "chip own-chip" : "chip", label);
      chip.type = "button";
      chip.setAttribute("aria-pressed", pressed ? "true" : "false");
      chip.addEventListener("click", onClick);
      categoryChips.appendChild(chip);
    }
    addChip("All", activeCategory === "all" && !ownOnly, false, function () {
      activeCategory = "all"; ownOnly = false; currentPage = 1; categoriesKey = ""; renderCategoryChips(); loadDirectory(false);
    });
    addChip("Original APIs", ownOnly, true, function () {
      ownOnly = true; activeCategory = "all"; currentPage = 1; categoriesKey = ""; renderCategoryChips(); loadDirectory(false);
    });
    categories.forEach(function (category) {
      addChip(String(category), activeCategory === category && !ownOnly, false, function () {
        activeCategory = category; ownOnly = false; currentPage = 1; categoriesKey = ""; renderCategoryChips(); loadDirectory(false);
      });
    });
  }

  function loadOwn() {
    showSkeletons(ownGrid, 3);
    fetch("/api/catalog?own=1&page=1&pageSize=60").then(function (res) {
      if (!res.ok) throw new Error("own failed");
      return res.json();
    }).then(function (data) {
      var entries = Array.isArray(data.entries) ? data.entries : [];
      ownError.hidden = true;
      ownGrid.replaceChildren();
      entries.forEach(function (entry, index) { ownGrid.appendChild(createCard(entry, "own", index)); });
      if (statOwn) statOwn.textContent = String(data.ownCount || entries.length);
    }).catch(function () {
      ownError.hidden = false;
      ownError.textContent = "Original APIs could not be loaded right now. Please reload the page and try again.";
      ownGrid.replaceChildren();
    });
  }

  function loadCheck() {
    fetch("/api/check").then(function (res) {
      if (!res.ok) throw new Error("check failed");
      return res.json();
    }).then(function (data) {
      checkedAt = (data && data.checkedAt) || null;
      var entries = data && Array.isArray(data.entries) ? data.entries : [];
      entries.forEach(function (item) { if (item && item.id) checkMap.set(String(item.id), item); });
      checkLoaded = true;
      renderLastChecked();
      refreshStatuses();
    }).catch(function () { renderLastChecked(); });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (themeToggle) {
      themeToggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
      themeToggle.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
    }
  }

  function initTheme() {
    var stored = null;
    try { stored = window.localStorage.getItem("api-hub-theme"); } catch (e) { /* ignore */ }
    applyTheme(stored === "light" || stored === "dark" ? stored : "dark");
    if (themeToggle) {
      themeToggle.addEventListener("click", function () {
        var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        applyTheme(next);
        try { window.localStorage.setItem("api-hub-theme", next); } catch (e) { /* ignore */ }
      });
    }
  }

  searchInput.addEventListener("input", function () {
    searchQuery = searchInput.value;
    currentPage = 1;
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () { loadDirectory(false); }, 300);
  });

  authFilter.addEventListener("change", function () {
    activeAuth = authFilter.value;
    currentPage = 1;
    loadDirectory(false);
  });

  if (paginationPrev) paginationPrev.addEventListener("click", function () { goToPage(currentPage - 1); });
  if (paginationNext) paginationNext.addEventListener("click", function () { goToPage(currentPage + 1); });

  var ownBrowseAll = document.getElementById("own-browse-all");
  if (ownBrowseAll) {
    ownBrowseAll.addEventListener("click", function () {
      ownOnly = true; activeCategory = "all"; currentPage = 1; categoriesKey = "";
      renderCategoryChips(); loadDirectory(false);
    });
  }

  var initialPage = parseInt(new URLSearchParams(window.location.search).get("page"), 10);
  if (Number.isFinite(initialPage) && initialPage >= 1) currentPage = initialPage;
  initTheme();
  loadOwn();
  loadDirectory(true);
  loadCheck();
})();
