/**
 * Offline runtime injected into every scraped page.
 * Collection tabs/filter/search/sort, toggles, TOC, image lightbox, media layout.
 */
export const RUNTIME_JS = `(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const CLOSE_SVG =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.22 3.22a.75.75 0 0 1 1.06 0L8 6.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L9.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06L8 9.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L6.94 8 3.22 4.28a.75.75 0 0 1 0-1.06z"/></svg>';

  function syncViewport() {
    document.documentElement.style.setProperty("--full-viewport-height", "100dvh");
    for (const el of $$(".notion-frame, main.notion-frame, .notion-cursor-listener")) {
      if (el.style && el.style.width && /px$/.test(el.style.width)) {
        el.style.width = "100%";
        el.style.maxWidth = "100%";
      }
    }
    document.body.style.width = "100%";
    document.body.style.maxWidth = "100%";
  }

  function hidePromos() {
    const re = /get notion free|log in|sign up|try notion|download app/i;
    for (const el of $$(".notion-topbar [role='button'], .notion-topbar a")) {
      const t = (el.textContent || "").replace(/\\s+/g, " ").trim();
      const a = el.getAttribute("aria-label") || "";
      if (re.test(t) || re.test(a)) {
        const wrap = el.closest(".xjp7ctv") || el;
        wrap.style.display = "none";
      }
    }
    for (const el of $$(".notion-topbar [role='button']")) {
      if (el.closest(".notion-collection_view-block, .notion-collection_view_page-block")) continue;
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      const svg = el.querySelector("svg.magnifyingGlass, svg.magnifyingGlassSmall");
      if (label === "search" || (svg && !label.includes("more"))) {
        const wrap = el.closest(".xjp7ctv") || el;
        wrap.style.display = "none";
      }
    }
    layoutTopbar();
  }

  /** Keep breadcrumbs left, ⋮ More actions pinned to the right. */
  function layoutTopbar() {
    for (const topbar of $$(".notion-topbar")) {
      const row =
        topbar.querySelector(":scope > div") || topbar;
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.width = "100%";
      row.style.maxWidth = "100%";
      row.style.boxSizing = "border-box";

      const more =
        topbar.querySelector("[aria-label='More actions']") ||
        topbar.querySelector("svg.ellipsis")?.closest("[role='button']");
      if (!more) continue;

      let right = topbar.querySelector("[data-nsp-topbar-right]");
      if (!right) {
        right = document.createElement("div");
        right.setAttribute("data-nsp-topbar-right", "1");
        Object.assign(right.style, {
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          marginInlineStart: "auto",
          flexShrink: "0",
          gap: "2px",
        });
        row.appendChild(right);
      }
      const wrap = more.closest(".xjp7ctv") || more;
      if (wrap.parentElement !== right) right.appendChild(wrap);
      wrap.style.display = "";
      more.style.display = "";
    }
    // Remove any leftover install CTA
    for (const el of $$("[data-nsp-install]")) el.remove();
  }

  function wireOriginalMenu() {
    const original =
      document.documentElement.getAttribute("data-nsp-original-url") || "";
    if (!original || original.startsWith("./")) return;

    const btn =
      $(".notion-topbar [aria-label='More actions']") ||
      $(".notion-topbar svg.ellipsis")?.closest("[role='button']");
    if (!btn || btn.dataset.nspWired) return;
    btn.dataset.nspWired = "1";

    let pop = null;
    const close = () => {
      if (pop) { pop.remove(); pop = null; }
      btn.setAttribute("aria-expanded", "false");
    };

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (pop) { close(); return; }
      pop = document.createElement("div");
      pop.setAttribute("data-nsp-menu", "1");
      Object.assign(pop.style, {
        position: "absolute",
        top: "100%",
        right: "0",
        marginTop: "6px",
        minWidth: "220px",
        maxWidth: "min(360px, 90vw)",
        padding: "8px",
        borderRadius: "10px",
        background: "var(--c-bacPri, #191919)",
        color: "var(--c-texPri, #fff)",
        boxShadow: "0 8px 28px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.08)",
        zIndex: "10000",
        fontSize: "14px",
      });
      const link = document.createElement("a");
      link.href = original;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open original page";
      Object.assign(link.style, {
        display: "block",
        padding: "8px 10px",
        borderRadius: "6px",
        color: "inherit",
        textDecoration: "none",
        fontWeight: "500",
      });
      link.onmouseenter = () => { link.style.background = "rgba(255,255,255,.08)"; };
      link.onmouseleave = () => { link.style.background = "transparent"; };
      const url = document.createElement("div");
      url.textContent = original;
      Object.assign(url.style, {
        padding: "4px 10px 8px",
        opacity: "0.55",
        fontSize: "12px",
        wordBreak: "break-all",
        lineHeight: "1.35",
      });
      pop.appendChild(link);
      pop.appendChild(url);
      const host = btn.closest(".xjp7ctv") || btn.parentElement || btn;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.appendChild(pop);
      btn.setAttribute("aria-expanded", "true");
    });

    document.addEventListener("click", (e) => {
      if (!pop) return;
      if (pop.contains(e.target) || btn.contains(e.target)) return;
      close();
    });
  }

  function filterItems(root, q) {
    const query = (q || "").trim().toLowerCase();
    for (const item of $$(
      ".notion-collection-item, .notion-gallery-view .notion-page-block, .notion-table-view-row, .notion-list-view .notion-page-block, .notion-board-view .notion-page-block, .notion-calendar-view .notion-page-block",
      root,
    )) {
      const text = (item.textContent || "").toLowerCase();
      item.style.display = !query || text.includes(query) ? "" : "none";
    }
  }

  function themeHost() {
    return (
      document.querySelector(".notion-dark-theme") ||
      document.querySelector(".notion-light-theme") ||
      document.querySelector(".notion-app-inner") ||
      document.body
    );
  }

  function closePanel(root) {
    for (const el of document.querySelectorAll(
      "[data-nsp-panel], [data-nsp-panel-backdrop]",
    )) {
      el.remove();
    }
    if (root) filterItems(root, "");
  }

  function openFilterPanel(root, anchor, placeholder) {
    closePanel(root);
    const mobile = window.matchMedia("(max-width: 640px)").matches;
    const host = themeHost();

    const backdrop = document.createElement("div");
    backdrop.setAttribute("data-nsp-panel-backdrop", "1");
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      zIndex: "40000",
      background: mobile ? "rgba(0,0,0,.45)" : "transparent",
    });
    backdrop.addEventListener("click", () => {
      closePanel(root);
      anchor.setAttribute("aria-expanded", "false");
    });

    const panel = document.createElement("div");
    panel.setAttribute("data-nsp-panel", "1");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", placeholder || "Filter");

    const basePanel = {
      position: "fixed",
      zIndex: "40001",
      padding: mobile ? "16px 16px 20px" : "12px 12px 14px",
      borderRadius: mobile ? "16px 16px 12px 12px" : "10px",
      background: "var(--c-bacPri, #191919)",
      color: "var(--c-texPri, #fff)",
      boxShadow: "0 8px 28px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.1)",
      boxSizing: "border-box",
    };

    if (mobile) {
      Object.assign(panel.style, basePanel, {
        left: "0",
        right: "0",
        bottom: "0",
        width: "100%",
        maxWidth: "100vw",
        paddingBottom: "max(20px, env(safe-area-inset-bottom))",
      });
    } else {
      const r = anchor.getBoundingClientRect();
      const width = 260;
      let left = Math.min(r.right - width, window.innerWidth - width - 12);
      left = Math.max(12, left);
      let top = r.bottom + 8;
      if (top + 140 > window.innerHeight) {
        top = Math.max(12, r.top - 140);
      }
      Object.assign(panel.style, basePanel, {
        top: \`\${top}px\`,
        left: \`\${left}px\`,
        width: \`\${width}px\`,
        minWidth: "220px",
        maxWidth: "min(360px, calc(100vw - 24px))",
      });
    }

    const head = document.createElement("div");
    Object.assign(head.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "10px",
      gap: "8px",
    });
    const title = document.createElement("div");
    title.textContent = placeholder || "Filter";
    Object.assign(title.style, {
      fontSize: "13px",
      fontWeight: "600",
      opacity: "0.85",
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = CLOSE_SVG;
    Object.assign(closeBtn.style, {
      appearance: "none",
      border: "none",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      padding: "8px",
      borderRadius: "8px",
      display: "flex",
      opacity: "0.7",
      minWidth: "40px",
      minHeight: "40px",
      alignItems: "center",
      justifyContent: "center",
    });
    closeBtn.onmouseenter = () => {
      closeBtn.style.opacity = "1";
      closeBtn.style.background = "rgba(255,255,255,.08)";
    };
    closeBtn.onmouseleave = () => {
      closeBtn.style.opacity = "0.7";
      closeBtn.style.background = "transparent";
    };
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePanel(root);
      anchor.setAttribute("aria-expanded", "false");
    });
    head.appendChild(title);
    head.appendChild(closeBtn);

    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position: "relative",
      display: "flex",
      alignItems: "center",
    });
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = placeholder || "Filter…";
    input.setAttribute("data-nsp-filter-input", "1");
    input.setAttribute("enterkeyhint", "search");
    Object.assign(input.style, {
      flex: "1",
      padding: mobile ? "14px 16px" : "8px 12px",
      borderRadius: "8px",
      border: "1px solid rgba(255,255,255,0.15)",
      background: "rgba(255,255,255,0.04)",
      color: "inherit",
      fontSize: mobile ? "16px" : "14px", // 16px avoids iOS zoom
      width: "100%",
      minWidth: "0",
      outline: "none",
      boxSizing: "border-box",
    });
    wrap.appendChild(input);
    panel.appendChild(head);
    panel.appendChild(wrap);

    host.appendChild(backdrop);
    host.appendChild(panel);
    anchor.setAttribute("aria-expanded", "true");

    // Keep desktop panel on-screen when keyboard/orientation changes
    const place = () => {
      if (mobile || !panel.isConnected) return;
      const r = anchor.getBoundingClientRect();
      const width = panel.offsetWidth || 260;
      let left = Math.min(r.right - width, window.innerWidth - width - 12);
      left = Math.max(12, left);
      let top = r.bottom + 8;
      if (top + panel.offsetHeight > window.innerHeight - 12) {
        top = Math.max(12, r.top - panel.offsetHeight - 8);
      }
      panel.style.top = \`\${top}px\`;
      panel.style.left = \`\${left}px\`;
    };
    window.addEventListener("resize", place, { passive: true });
    window.addEventListener("scroll", place, { passive: true, capture: true });

    const cleanup = () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
    const obs = new MutationObserver(() => {
      if (!panel.isConnected) {
        cleanup();
        obs.disconnect();
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    input.focus();
    input.addEventListener("input", () => filterItems(root, input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closePanel(root);
        anchor.setAttribute("aria-expanded", "false");
      }
    });
  }

  function openSearchInline(root, btn) {
    let wrap = root.querySelector("[data-nsp-search-wrap]");
    if (wrap) {
      const existing = wrap.querySelector("input");
      // Re-clicking Search while open: clear if filled, otherwise close
      if (existing && existing.value.trim()) {
        existing.value = "";
        filterItems(root, "");
        existing.focus();
        return;
      }
      wrap.remove();
      filterItems(root, "");
      btn.style.display = "";
      return;
    }
    btn.style.display = "none";
    wrap = document.createElement("div");
    wrap.setAttribute("data-nsp-search-wrap", "1");
    Object.assign(wrap.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      marginLeft: "4px",
    });
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search…";
    input.setAttribute("data-nsp-filter-input", "1");
    input.setAttribute("enterkeyhint", "search");
    Object.assign(input.style, {
      padding: "4px 8px",
      borderRadius: "6px",
      border: "1px solid rgba(255,255,255,0.15)",
      background: "transparent",
      color: "inherit",
      fontSize: "14px",
      minWidth: "140px",
      maxWidth: "min(220px, 50vw)",
      outline: "none",
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Clear search");
    closeBtn.innerHTML = CLOSE_SVG;
    Object.assign(closeBtn.style, {
      appearance: "none",
      border: "none",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      padding: "4px",
      borderRadius: "6px",
      display: "flex",
      opacity: "0.75",
      minWidth: "32px",
      minHeight: "32px",
      alignItems: "center",
      justifyContent: "center",
    });
    const close = () => {
      wrap.remove();
      filterItems(root, "");
      btn.style.display = "";
    };
    const clearOrClose = () => {
      // First click clears text; second click (when empty) closes search
      if (input.value.trim()) {
        input.value = "";
        filterItems(root, "");
        input.focus();
        closeBtn.setAttribute("aria-label", "Close search");
        return;
      }
      close();
    };
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearOrClose();
    });
    input.addEventListener("input", () => {
      filterItems(root, input.value);
      closeBtn.setAttribute(
        "aria-label",
        input.value.trim() ? "Clear search" : "Close search",
      );
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        clearOrClose();
      }
    });
    wrap.appendChild(input);
    wrap.appendChild(closeBtn);
    (btn.parentElement || root).appendChild(wrap);
    input.focus();
  }

  function wireCollectionSearch(root) {
    const btn = root.querySelector('[aria-label="Search"]');
    if (!btn || btn.dataset.nspWired) return;
    btn.dataset.nspWired = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSearchInline(root, btn);
    });
  }

  function wireCollectionFilter(root) {
    const btn =
      root.querySelector(".notion-collection-filter") ||
      root.querySelector('[aria-label="Filter"]');
    if (!btn || btn.dataset.nspWired) return;
    btn.dataset.nspWired = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (document.querySelector("[data-nsp-panel]")) {
        closePanel(root);
        btn.setAttribute("aria-expanded", "false");
        return;
      }
      openFilterPanel(root, btn, "Filter…");
    });
  }

  function wireCollectionSort(root) {
    const btn = root.querySelector(".notion-collection-sort, [aria-label='Sort']");
    if (!btn || btn.dataset.nspWired) return;
    btn.dataset.nspWired = "1";
    let asc = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const body = root.querySelector(".notion-collection-view-body") || root;
      const grid =
        body.querySelector(".notion-gallery-view > div > div[style*='grid']") ||
        body.querySelector(".notion-gallery-view div[style*='grid-template']") ||
        body.querySelector(".notion-table-view");
      const items = $$(".notion-collection-item, .notion-table-view-row", grid || body);
      if (!items.length) return;
      const parent = items[0].parentElement;
      if (!parent) return;
      const sorted = items.slice().sort((a, b) => {
        const ta = (a.textContent || "").trim().toLowerCase();
        const tb = (b.textContent || "").trim().toLowerCase();
        return asc ? ta.localeCompare(tb) : tb.localeCompare(ta);
      });
      asc = !asc;
      for (const it of sorted) parent.appendChild(it);
      btn.setAttribute("data-nsp-active", "1");
    });
  }

  function tabLabel(el) {
    return (el.textContent || "").replace(/\\s+/g, " ").trim();
  }

  function collectionTabs(root) {
    const tablist = root.querySelector('[role="tablist"]');
    const scope = tablist || root;
    const buttons = $$(".notion-collection-view-tab-button", scope);
    if (buttons.length) return buttons;
    const raw = $$('[role="tab"], .notion-collection-view-tab', scope);
    return raw.filter((t) => !t.closest(".notion-collection-view-tab-button"));
  }

  function styleTab(tab, selected) {
    const targets = [tab, ...$$('[role="tab"], .notion-collection-view-tab', tab)];
    for (const el of targets) {
      el.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) {
        el.setAttribute("data-nsp-active", "1");
        el.style.background = "var(--ca-graBacSecTra, rgba(255,255,255,.1))";
        el.style.color = "var(--c-texPri, inherit)";
        const svg = el.querySelector("svg");
        if (svg) svg.style.fill = "var(--c-texPri, currentColor)";
      } else {
        el.removeAttribute("data-nsp-active");
        el.style.background = "";
        const svg = el.querySelector("svg");
        if (svg) svg.style.fill = "var(--c-texSec, currentColor)";
      }
    }
  }

  function findCapturedView(views, tab, index) {
    const label = tabLabel(tab).toLowerCase();
    const byLabel = views.tabs.find((t) => {
      const L = (t.label || "").toLowerCase();
      return L === label || label.includes(L) || L.includes(label);
    });
    return byLabel || views.tabs[index];
  }

  function defaultTabIndex(views, tabs) {
    const prefer = (views && views.defaultLabel) || "Gallery view";
    let idx = tabs.findIndex((t) =>
      tabLabel(t).toLowerCase() === prefer.toLowerCase(),
    );
    if (idx < 0) {
      idx = tabs.findIndex((t) => /gallery/i.test(tabLabel(t)));
    }
    if (idx < 0) idx = (views && typeof views.defaultIndex === "number") ? views.defaultIndex : 0;
    return Math.max(0, Math.min(idx, Math.max(0, tabs.length - 1)));
  }

  function applyView(root, views, tabs, body, index) {
    const view = findCapturedView(views, tabs[index], index);
    if (!view) return;
    body.innerHTML = view.html;
    tabs.forEach((t, j) => styleTab(t, j === index));
    filterItems(root, "");
    enhanceMedia(body);
    wireCardActions(root);
  }

  function wireViewTabs(root, views) {
    if (!views || !views.tabs || !views.tabs.length) return;
    const tabs = collectionTabs(root);
    const body = root.querySelector(".notion-collection-view-body");
    if (!body || !tabs.length) return;

    const def = defaultTabIndex(views, tabs);
    // Apply default view on load
    applyView(root, views, tabs, body, def);

    tabs.forEach((tab, i) => {
      if (tab.dataset.nspWired) return;
      tab.dataset.nspWired = "1";
      tab.style.cursor = "pointer";
      tab.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const selected = tab.getAttribute("aria-selected") === "true" ||
          tab.querySelector('[aria-selected="true"]');
        // Clicking an already-selected non-default tab returns to Gallery view
        if (selected && i !== def) {
          applyView(root, views, tabs, body, def);
          return;
        }
        applyView(root, views, tabs, body, i);
      });
    });
  }

  function wireCollectionsIn(scope, captures) {
    const blocks = $$([
      ".notion-selectable.notion-collection_view-block[data-block-id]",
      ".notion-collection_view-block[data-block-id]",
      ".notion-selectable.notion-collection_view_page-block[data-block-id]",
      ".notion-collection_view_page-block[data-block-id]",
    ].join(", "), scope);

    const seen = new Set();
    for (const block of blocks) {
      const root =
        block.closest(".notion-selectable.notion-collection_view-block") ||
        block.closest(".notion-selectable.notion-collection_view_page-block") ||
        block;
      if (seen.has(root)) continue;
      seen.add(root);
      wireCollectionRoot(root, captures || []);
    }
  }

  function wireToggles(scope) {
    for (const block of $$(".notion-toggle-block", scope || document)) {
      if (block.dataset.nspToggleWired) continue;
      block.dataset.nspToggleWired = "1";
      // Structure varies; find header row + content siblings
      const header =
        block.querySelector(":scope > div > div[role='button']") ||
        block.querySelector(":scope [role='button']") ||
        block.querySelector(":scope > div");
      if (!header) continue;

      // Mark content nodes (everything after the first row)
      const rows = Array.from(block.children);
      let contentNodes = [];
      if (rows.length >= 2) {
        contentNodes = rows.slice(1);
      } else {
        const inner = block.querySelector(":scope > div");
        if (inner) {
          const kids = Array.from(inner.children);
          if (kids.length >= 2) contentNodes = kids.slice(1);
        }
      }
      // If Notion left content in a details-like wrapper
      const details = block.querySelector("[data-nsp-toggle-content]") ||
        block.querySelector(".notion-toggle-block > div:last-child");

      const setOpen = (open) => {
        block.setAttribute("data-nsp-open", open ? "1" : "0");
        for (const n of contentNodes) {
          if (n === header || header.contains(n)) continue;
          n.style.display = open ? "" : "none";
        }
        if (details && !contentNodes.includes(details) && details !== header) {
          details.style.display = open ? "" : "none";
        }
      };

      // Start collapsed if marked during freeze
      const startOpen = block.getAttribute("data-nsp-open") === "1";
      setOpen(startOpen);

      header.style.cursor = "pointer";
      header.addEventListener("click", (e) => {
        // Don't hijack links inside toggle title
        if (e.target.closest("a")) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(block.getAttribute("data-nsp-open") !== "1");
      });
    }
  }

  function wireToc() {
    const toc = $(".notion-floating-table-of-contents");
    if (!toc || toc.dataset.nspWired) return;
    toc.dataset.nspWired = "1";

    const headings = $$(".notion-page-content h1, .notion-page-content h2, .notion-page-content h3, .notion-page-content .notion-sub_header-block, .notion-page-content .notion-header-block");
    const entries = [];
    for (const h of headings) {
      const text = (h.textContent || "").replace(/\\s+/g, " ").trim();
      if (!text || text.length > 80) continue;
      if (!h.id) h.id = "nsp-" + Math.random().toString(36).slice(2, 9);
      entries.push({ id: h.id, text, el: h });
    }
    if (!entries.length) return;

    // Build / enhance popover
    let pop = toc.querySelector("[data-nsp-toc-pop]");
    if (!pop) {
      pop = document.createElement("div");
      pop.setAttribute("data-nsp-toc-pop", "1");
      Object.assign(pop.style, {
        display: "none",
        position: "absolute",
        right: "28px",
        top: "0",
        minWidth: "180px",
        maxWidth: "240px",
        padding: "6px",
        borderRadius: "10px",
        background: "var(--c-bacPri, #191919)",
        color: "var(--c-texPri, #fff)",
        boxShadow: "0 8px 28px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.1)",
        zIndex: "1000",
        fontSize: "13px",
        pointerEvents: "auto",
      });
      for (const entry of entries) {
        const a = document.createElement("a");
        a.href = "#" + entry.id;
        a.textContent = entry.text;
        Object.assign(a.style, {
          display: "block",
          padding: "6px 10px",
          borderRadius: "6px",
          color: "inherit",
          textDecoration: "none",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        });
        a.onmouseenter = () => { a.style.background = "rgba(255,255,255,.08)"; };
        a.onmouseleave = () => { a.style.background = "transparent"; };
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          entry.el.scrollIntoView({ behavior: "smooth", block: "start" });
          pop.style.display = "none";
        });
        pop.appendChild(a);
      }
      const host = toc.querySelector("[style*='position: absolute']") || toc;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.appendChild(pop);
    }

    const show = () => { pop.style.display = "block"; };
    const hide = () => { pop.style.display = "none"; };
    toc.addEventListener("mouseenter", show);
    toc.addEventListener("mouseleave", hide);
    toc.style.pointerEvents = "auto";
    for (const bar of $$("div", toc)) {
      if (bar === pop || pop.contains(bar)) continue;
      bar.style.cursor = "pointer";
    }
  }

  function enhanceMedia(scope) {
    const root = scope || document;
    repairBlockMedia(root);
    for (const img of $$(
      [
        ".notion-image-block img",
        ".notion-page-content img",
        "[data-nsp-peek-body] img",
        ".nsp-peek-content img",
      ].join(", "),
      root,
    )) {
      // Promote lazy placeholders when a real URL is available
      const lazy =
        img.getAttribute("data-src") ||
        img.getAttribute("data-lazy-src") ||
        img.getAttribute("data-original");
      const src = img.getAttribute("src") || "";
      if (lazy && (/^data:image\\/(gif|svg)/i.test(src) || !src)) {
        img.setAttribute("src", lazy);
      }
      // Don't flatten gallery / cover images — they use fixed heights
      if (!img.closest(".notion-collection-item, .notion-gallery-view")) {
        img.style.maxWidth = "100%";
        img.style.height = "auto";
        img.style.maxHeight = "none";
      }
      // Notion freezes often set pointer-events:none on wrappers
      const block = img.closest(".notion-image-block") || img.parentElement;
      if (block) {
        block.style.pointerEvents = "auto";
        block.style.cursor = "pointer";
      }
      img.style.pointerEvents = "auto";
      img.style.cursor = "pointer";
      if (img.dataset.nspLb) continue;
      if (/^data:image\\/(gif|svg)/i.test(img.getAttribute("src") || "")) continue;
      // Skip tiny decorative / gallery-card covers (those navigate via the card link)
      if (img.closest(".notion-collection-item a")) continue;
      img.dataset.nspLb = "1";
      img.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openLightbox(img);
      });
    }
    for (const audio of $$("audio", root)) {
      repairMediaSrc(audio);
      audio.controls = true;
      audio.preload = "metadata";
      audio.style.maxWidth = "100%";
      audio.style.width = "100%";
      audio.style.display = "block";
      // Notion often disables hit-testing on the wrapper
      const wrap = audio.closest(".notion-audio-block, [data-content-editable-void]");
      if (wrap) {
        wrap.style.pointerEvents = "auto";
      }
      audio.style.pointerEvents = "auto";
    }
    for (const block of $$(".notion-audio-block", root)) {
      block.style.pointerEvents = "auto";
      let audio = block.querySelector("audio");
      if (!audio) {
        // Custom Notion player without <audio> — synthesize from known src attrs
        const srcEl = block.querySelector("[src]");
        const src = srcEl && srcEl.getAttribute("src");
        if (src && !src.startsWith("data:")) {
          audio = document.createElement("audio");
          audio.src = src;
          audio.controls = true;
          audio.preload = "metadata";
          audio.style.width = "100%";
          audio.style.display = "block";
          block.appendChild(audio);
        }
      }
      if (!audio) {
        // Last resort: map by data-block-id → downloaded file.notion.so asset
        const local = localAssetForBlock(block.getAttribute("data-block-id"), "audio");
        if (local) {
          audio = document.createElement("audio");
          audio.src = local;
          audio.controls = true;
          audio.preload = "metadata";
          audio.style.width = "100%";
          audio.style.maxWidth = "100%";
          audio.style.display = "block";
          const figure = block.querySelector('[role="figure"]') || block;
          figure.appendChild(audio);
        }
      }
      if (audio) {
        repairMediaSrc(audio);
        audio.controls = true;
        audio.style.width = "100%";
        audio.style.maxWidth = "100%";
        audio.style.display = "block";
        audio.style.pointerEvents = "auto";
      }
    }
    for (const table of $$(".notion-table-view", root)) {
      const scroller = table.closest(".notion-scroller") || table.parentElement;
      if (scroller) {
        scroller.style.overflowX = "auto";
        scroller.style.maxWidth = "100%";
      }
      table.style.maxWidth = "none";
    }
  }

  let assetMap = null;
  let assetMapPromise = null;
  let blockAssetIndex = null;

  function loadAssetMap() {
    if (assetMapPromise) return assetMapPromise;
    assetMapPromise = (async () => {
      try {
        const res = await fetch("./.nsp-cache.json", { cache: "force-cache" });
        if (!res.ok) return;
        const data = await res.json();
        assetMap = data && data.assets ? data.assets : null;
        blockAssetIndex = null;
      } catch {
        assetMap = null;
        blockAssetIndex = null;
      }
    })();
    return assetMapPromise;
  }

  function normBlockId(raw) {
    if (!raw) return "";
    const hex = String(raw).replace(/-/g, "").toLowerCase();
    return /^[0-9a-f]{32}$/.test(hex) ? hex : "";
  }

  function ensureBlockAssetIndex() {
    if (blockAssetIndex) return blockAssetIndex;
    blockAssetIndex = new Map();
    if (!assetMap) return blockAssetIndex;
    for (const [remote, rel] of Object.entries(assetMap)) {
      let blockId = "";
      let width = 0;
      try {
        const u = new URL(String(remote).replace(/&amp;/g, "&"));
        blockId = normBlockId(u.searchParams.get("id"));
        width = Number(u.searchParams.get("width") || 0) || 0;
      } catch {
        continue;
      }
      if (!blockId) continue;
      const local = "./" + String(rel).replace(/^\\.\\//, "");
      const entry = blockAssetIndex.get(blockId) || { imageWidth: 0 };
      const isAudio =
        /\\.(mp3|m4a|ogg|wav|aac)(\\?|$)/i.test(remote) ||
        /\\.(mp3|m4a|ogg|wav|aac)$/i.test(local);
      const isImage =
        /\\/image\\//i.test(remote) ||
        /\\.(png|jpe?g|webp|gif|svg)$/i.test(local);
      if (isAudio) entry.audio = local;
      if (isImage && (!entry.image || width >= entry.imageWidth)) {
        entry.image = local;
        entry.imageWidth = width;
      }
      blockAssetIndex.set(blockId, entry);
    }
    return blockAssetIndex;
  }

  function localAssetForBlock(blockId, kind) {
    const id = normBlockId(blockId);
    if (!id) return null;
    const idx = ensureBlockAssetIndex();
    const entry = idx.get(id);
    return entry && entry[kind] ? entry[kind] : null;
  }

  /** Fix gif placeholders / empty audio+image figures using ?id=<block> assets. */
  function repairBlockMedia(scope) {
    const root = scope || document;
    if (!assetMap) return;
    ensureBlockAssetIndex();

    for (const block of $$(".notion-image-block[data-block-id]", root)) {
      const local = localAssetForBlock(block.getAttribute("data-block-id"), "image");
      if (!local) continue;
      let img = block.querySelector("img");
      if (!img) {
        const figure =
          block.querySelector('[role="figure"]') ||
          block.querySelector("[data-content-editable-void]") ||
          block;
        img = document.createElement("img");
        img.alt = "";
        img.referrerPolicy = "same-origin";
        img.style.display = "block";
        img.style.width = "100%";
        img.style.maxWidth = "100%";
        img.style.height = "auto";
        figure.appendChild(img);
      }
      const src = img.getAttribute("src") || "";
      if (!src || /^data:image\\/(gif|svg)/i.test(src) || /^https?:/i.test(src)) {
        img.setAttribute("src", local);
        img.removeAttribute("srcset");
      }
    }

    for (const block of $$(".notion-audio-block[data-block-id]", root)) {
      if (block.querySelector("audio[src]")) continue;
      const local = localAssetForBlock(block.getAttribute("data-block-id"), "audio");
      if (!local) continue;
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = local;
      audio.style.width = "100%";
      audio.style.maxWidth = "100%";
      audio.style.display = "block";
      const figure = block.querySelector('[role="figure"]') || block;
      figure.appendChild(audio);
      block.style.pointerEvents = "auto";
    }
  }

  function localAssetFor(remote) {
    if (!assetMap || !remote) return null;
    if (assetMap[remote]) return "./" + assetMap[remote].replace(/^\\.\\//, "");
    try {
      const u = new URL(remote);
      const pathKey = u.origin + u.pathname;
      for (const [k, v] of Object.entries(assetMap)) {
        if (k.startsWith(pathKey) || pathKey.startsWith(k.split("?")[0])) {
          return "./" + String(v).replace(/^\\.\\//, "");
        }
      }
      const uuids = u.pathname.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      );
      if (uuids) {
        for (const id of uuids) {
          for (const [k, v] of Object.entries(assetMap)) {
            if (k.includes(id)) return "./" + String(v).replace(/^\\.\\//, "");
          }
        }
      }
      const file = decodeURIComponent(u.pathname.split("/").pop() || "");
      if (file) {
        for (const [k, v] of Object.entries(assetMap)) {
          if (k.includes(file)) return "./" + String(v).replace(/^\\.\\//, "");
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /** If media still points at Notion CDN, remap to a local ./assets file when possible. */
  function repairMediaSrc(el) {
    const src = el.getAttribute("src") || "";
    if (!src || src.startsWith("./") || src.startsWith("assets/") || src.startsWith("data:")) {
      return;
    }
    if (!/^https?:/i.test(src)) return;
    const local = localAssetFor(src);
    if (local) {
      el.setAttribute("src", local);
      return;
    }
    // Async: map may still be loading
    loadAssetMap().then(() => {
      const again = localAssetFor(src);
      if (again && el.getAttribute("src") === src) el.setAttribute("src", again);
    });
  }

  function openLightbox(img) {
    const existing = document.querySelector("[data-nsp-lightbox]");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-nsp-lightbox", "1");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,.72)",
      zIndex: "20000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      cursor: "zoom-out",
    });
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "relative",
      maxWidth: "min(1100px, 96vw)",
      maxHeight: "92vh",
      cursor: "default",
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.innerHTML = CLOSE_SVG;
    closeBtn.setAttribute("aria-label", "Close");
    Object.assign(closeBtn.style, {
      position: "absolute",
      top: "-36px",
      right: "0",
      appearance: "none",
      border: "none",
      background: "rgba(255,255,255,.12)",
      color: "#fff",
      borderRadius: "8px",
      padding: "6px",
      cursor: "pointer",
      display: "flex",
    });
    const big = document.createElement("img");
    big.src = img.currentSrc || img.src;
    big.alt = img.alt || "";
    Object.assign(big.style, {
      display: "block",
      maxWidth: "100%",
      maxHeight: "85vh",
      objectFit: "contain",
      borderRadius: "4px",
    });
    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "8px",
      marginTop: "10px",
      justifyContent: "flex-end",
    });
    const openFull = document.createElement("a");
    openFull.href = img.currentSrc || img.src;
    openFull.target = "_blank";
    openFull.rel = "noopener noreferrer";
    openFull.textContent = "Open in full page";
    Object.assign(openFull.style, {
      color: "#fff",
      fontSize: "13px",
      textDecoration: "none",
      padding: "6px 10px",
      borderRadius: "6px",
      background: "rgba(255,255,255,.12)",
    });
    actions.appendChild(openFull);
    panel.appendChild(closeBtn);
    panel.appendChild(big);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    const close = () => overlay.remove();
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); close(); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", onKey);
      }
    });
    document.body.appendChild(overlay);
  }

  function padCollectionToolbars() {
    for (const row of $$(
      ".notion-collection_view-block [style*='justify-content: end'], .notion-collection_view_page-block [style*='justify-content: end']",
    )) {
      if (row.dataset.nspPad) continue;
      row.dataset.nspPad = "1";
      row.style.paddingInlineEnd = "12px";
      row.style.gap = "4px";
    }
  }

  function wireCollectionRoot(root, captures) {
    wireCollectionSearch(root);
    wireCollectionFilter(root);
    wireCollectionSort(root);
    const id = root.getAttribute("data-block-id") ||
      root.querySelector("[data-block-id]")?.getAttribute("data-block-id");
    const cap = captures.find((c) => c.blockId === id);
    wireViewTabs(root, cap);
  }

  function injectStyles() {
    if (document.getElementById("nsp-runtime-css")) return;
    const style = document.createElement("style");
    style.id = "nsp-runtime-css";
    style.textContent = \`
      .notion-image-block, .notion-image-block > div { max-width: 100% !important; }
      .notion-image-block,
      .notion-image-block * {
        pointer-events: auto !important;
      }
      .notion-image-block img,
      .notion-page-content .notion-image-block img,
      [data-nsp-peek-body] .notion-image-block img,
      [data-nsp-peek-body] img:not([src^="data:"]) {
        max-width: 100% !important;
        cursor: pointer !important;
        pointer-events: auto !important;
      }
      .notion-image-block img {
        width: 100% !important;
        height: auto !important;
        max-height: none !important;
        object-fit: contain !important;
      }
      .notion-collection-item img,
      .notion-gallery-view img {
        /* keep Notion cover sizing — don't force height:auto */
        max-width: 100%;
        cursor: pointer;
      }
      .notion-audio-block, .notion-audio-block audio {
        max-width: 100% !important;
        width: 100%;
        pointer-events: auto !important;
      }
      .notion-audio-block audio {
        display: block !important;
        min-height: 40px;
        margin-top: 4px;
      }
      .notion-audio-block [role="figure"] {
        min-height: 40px;
        pointer-events: auto !important;
      }
      .notion-table-view, .notion-scroller.horizontal {
        overflow-x: auto !important;
        max-width: 100%;
      }
      .notion-collection-view-body,
      .notion-gallery-view,
      .notion-calendar-view,
      .notion-table-view {
        background: var(--c-bacPri, inherit);
        min-height: 40vh;
      }
      .notion-collection-view-tab[data-nsp-active="1"],
      .notion-collection-view-tab[aria-selected="true"],
      .notion-collection-view-tab-button[data-nsp-active="1"] {
        background: var(--ca-graBacSecTra, rgba(255,255,255,.1)) !important;
      }
      /* Notion print CSS often hides chrome — keep breadcrumbs visible */
      .notion-topbar {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        height: 44px !important;
        z-index: 10;
        position: relative;
      }
      header {
        display: block !important;
        visibility: visible !important;
        position: relative;
        z-index: 10;
      }
      [data-nsp-peek-body] .notion-topbar,
      [data-nsp-peek-body] header {
        position: sticky;
        top: 0;
        z-index: 5;
        background: var(--c-bacPri, #191919);
      }
      .notion-collection-view-tab-button {
        cursor: pointer;
      }
      .notion-toggle-block [role="button"],
      .notion-toggle-block { cursor: pointer; }
      .notion-floating-table-of-contents { pointer-events: auto !important; }

      /* Mobile: stack Notion column layouts */
      @media (max-width: 820px) {
        .notion-column_list-block > div {
          flex-direction: column !important;
          align-items: stretch !important;
        }
        .notion-column_list-block > div > div {
          width: 100% !important;
          max-width: 100% !important;
          flex-grow: 1 !important;
          flex-shrink: 1 !important;
        }
        .notion-column_list-block > div > div[style*="opacity: 0"],
        .notion-column_list-block > div > div[style*="width: 46px"] {
          display: none !important;
          height: 0 !important;
          width: 0 !important;
          padding: 0 !important;
          margin: 0 !important;
        }
        .layout, .layout-wide, .layout-content {
          padding-inline: 12px !important;
        }
        .notion-page-content {
          padding-inline: 4px !important;
        }
      }

      /* Side / center peek */
      [data-nsp-peek-root] {
        position: fixed;
        inset: 0;
        z-index: 30000;
        pointer-events: none;
        visibility: hidden;
      }
      [data-nsp-peek-root][data-open="1"] {
        visibility: visible;
        pointer-events: auto;
      }
      [data-nsp-peek-backdrop] {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,.45);
        pointer-events: none;
        opacity: 0;
        transition: opacity .18s ease;
      }
      [data-nsp-peek-root][data-open="1"] [data-nsp-peek-backdrop] {
        opacity: 1;
        pointer-events: auto;
      }
      [data-nsp-peek-panel] {
        position: absolute;
        top: 0;
        right: 0;
        height: 100%;
        width: min(640px, 100%);
        background: var(--c-bacPri, #191919);
        color: var(--c-texPri, #fff);
        box-shadow: -8px 0 32px rgba(0,0,0,.35);
        display: flex;
        flex-direction: column;
        pointer-events: none;
        transform: translateX(104%);
        transition: transform .2s ease, width .2s ease;
      }
      [data-nsp-peek-root][data-open="1"] [data-nsp-peek-panel] {
        transform: translateX(0);
        pointer-events: auto;
      }
      [data-nsp-peek-root][data-mode="center"] [data-nsp-peek-panel] {
        left: 50%;
        right: auto;
        top: 4vh;
        height: 92vh;
        width: min(820px, 94vw);
        transform: translate(-50%, 12px);
        opacity: 0;
        border-radius: 12px;
        box-shadow: 0 16px 48px rgba(0,0,0,.45);
      }
      [data-nsp-peek-root][data-open="1"][data-mode="center"] [data-nsp-peek-panel] {
        transform: translate(-50%, 0);
        opacity: 1;
      }
      [data-nsp-peek-root][data-mode="full"] [data-nsp-peek-backdrop] {
        opacity: 0 !important;
        pointer-events: none !important;
      }
      [data-nsp-peek-root][data-mode="full"] [data-nsp-peek-panel] {
        left: 0;
        right: 0;
        top: 0;
        width: 100%;
        height: 100%;
        max-width: none;
        border-radius: 0;
        box-shadow: none;
        transform: none;
        opacity: 1;
      }
      [data-nsp-peek-root][data-open="1"][data-mode="full"] [data-nsp-peek-panel] {
        transform: none;
        opacity: 1;
      }
      [data-nsp-peek-bar] {
        height: 44px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 10px 0 12px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        opacity: 0;
        transition: opacity .15s ease;
      }
      [data-nsp-peek-panel]:hover [data-nsp-peek-bar],
      [data-nsp-peek-bar]:focus-within,
      [data-nsp-peek-root][data-peek-bar="1"] [data-nsp-peek-bar] {
        opacity: 1;
      }
      [data-nsp-peek-bar] button, [data-nsp-peek-bar] a {
        appearance: none;
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        opacity: .8;
      }
      [data-nsp-peek-bar] button:hover, [data-nsp-peek-bar] a:hover {
        background: rgba(255,255,255,.08);
        opacity: 1;
      }
      [data-nsp-peek-body] {
        flex: 1;
        overflow: auto;
        padding: 16px 20px 48px;
      }
      [data-nsp-peek-body] .layout,
      [data-nsp-peek-body] .layout-wide {
        padding-inline: 8px !important;
        max-width: 100% !important;
      }
      [data-nsp-card-actions] {
        position: absolute;
        top: 8px;
        right: 8px;
        display: none;
        gap: 4px;
        z-index: 5;
        background: var(--c-whiButBac, #fff);
        color: var(--c-texSec, #333);
        border-radius: 6px;
        box-shadow: var(--c-shaOutMd, 0 2px 8px rgba(0,0,0,.2));
        padding: 2px;
      }
      .notion-collection-item { position: relative; }
      .notion-collection-item:hover [data-nsp-card-actions],
      .notion-collection-item:focus-within [data-nsp-card-actions] {
        display: flex;
      }
      [data-nsp-card-actions] button {
        appearance: none;
        border: none;
        background: transparent;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 4px;
        font-size: 12px;
        color: inherit;
      }
      [data-nsp-card-actions] button:hover { background: rgba(0,0,0,.06); }
      [data-nsp-topbar-right] {
        display: flex !important;
        align-items: center;
        margin-inline-start: auto !important;
        flex-shrink: 0;
      }
      [data-nsp-install] { display: none !important; }
    \`;
    document.head.appendChild(style);
  }

  /* ── PWA ───────────────────────────────────────────────── */
  function registerPwa() {
    if (!("serviceWorker" in navigator)) return;
    const swUrl = new URL("sw.js", location.href);
    // All pages live flat in the site root
    const rootSw = new URL("./sw.js", location.href.replace(/[^/]*$/, ""));
    navigator.serviceWorker.register(rootSw.href).catch(() => {
      navigator.serviceWorker.register(swUrl.href).catch(() => {});
    });

    // Ask SW to refresh precache list after load
    navigator.serviceWorker.ready.then(async (reg) => {
      try {
        const res = await fetch("./assets/nsp-precache.json", { cache: "no-cache" });
        const urls = await res.json();
        reg.active && reg.active.postMessage({ type: "NSP_CACHE_URLS", urls });
      } catch (_) {}
    });

    // Suppress browser install banner; no floating "Install app" button
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
    });
  }

  /* ── Side peek ─────────────────────────────────────────── */
  let peekMode = localStorage.getItem("nsp-peek-mode") || "side";
  let peekRoot = null;
  let peekCurrentHref = "";
  let peekFull = false;
  let peekHistoryPushed = false;
  let peekIgnorePop = false;

  function ensurePeekRoot() {
    if (peekRoot && peekRoot.isConnected) return peekRoot;
    peekRoot = document.createElement("div");
    peekRoot.setAttribute("data-nsp-peek-root", "1");
    peekRoot.setAttribute("data-open", "0");
    peekRoot.setAttribute("data-mode", peekMode);
    // Inherit dark/light CSS variables from Notion theme host
    const theme =
      document.querySelector(".notion-dark-theme") ? "notion-dark-theme" :
      document.querySelector(".notion-light-theme") ? "notion-light-theme" : "";
    if (theme) peekRoot.classList.add(theme);
    peekRoot.innerHTML =
      '<div data-nsp-peek-backdrop></div>' +
      '<div data-nsp-peek-panel role="dialog" aria-modal="true">' +
      '  <div data-nsp-peek-bar>' +
      '    <div data-nsp-peek-left style="display:flex;gap:2px;align-items:center"></div>' +
      '    <div data-nsp-peek-right style="display:flex;gap:2px;align-items:center"></div>' +
      "  </div>" +
      '  <div data-nsp-peek-body></div>' +
      "</div>";
    themeHost().appendChild(peekRoot);
    peekRoot.querySelector("[data-nsp-peek-backdrop]").addEventListener("click", closePeek);
    return peekRoot;
  }

  function iconBtn(label, svg, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = svg;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  const SVG = {
    close: CLOSE_SVG,
    expand: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M4.5 3.375A1.125 1.125 0 0 0 3.375 4.5V8a.625.625 0 1 0 1.25 0V5.508l4.067 4.067a.625.625 0 0 0 .884-.884L5.508 4.625H8a.625.625 0 1 0 0-1.25zM15.5 16.625a1.125 1.125 0 0 0 1.125-1.125V12a.625.625 0 1 0-1.25 0v2.492l-4.067-4.067a.625.625 0 1 0-.884.884l4.067 4.066H12a.625.625 0 1 0 0 1.25z"/></svg>',
    compress: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M8.125 3.375a.625.625 0 0 1 .625.625V8c0 .69-.56 1.25-1.25 1.25H3.999a.625.625 0 1 1 0-1.25h2.492L2.424 4.183a.625.625 0 1 1 .884-.884L7.375 7.242V5a.625.625 0 0 1 .75-.625zM11.875 16.625a.625.625 0 0 1-.625-.625V12c0-.69.56-1.25 1.25-1.25h3.501a.625.625 0 1 1 0 1.25h-2.492l4.067 4.067a.625.625 0 1 1-.884.884L12.625 12.758V15a.625.625 0 0 1-.75.625z"/></svg>',
    newtab: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M6.25 3.375A2.125 2.125 0 0 0 4.125 5.5v8.75c0 1.174.951 2.125 2.125 2.125h8.75a2.125 2.125 0 0 0 2.125-2.125v-3.125a.625.625 0 1 0-1.25 0V14.25a.875.875 0 0 1-.875.875H6.25a.875.875 0 0 1-.875-.875V5.5c0-.483.392-.875.875-.875h3.125a.625.625 0 1 0 0-1.25z"/><path d="M12.625 3.375a.625.625 0 0 0 0 1.25h2.117l-5.246 5.246a.625.625 0 1 0 .884.884l5.245-5.246v2.116a.625.625 0 1 0 1.25 0V4.5A1.125 1.125 0 0 0 15.75 3.375z"/></svg>',
    side: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M3.375 5.5c0-1.174.951-2.125 2.125-2.125h9c1.174 0 2.125.951 2.125 2.125v9c0 1.174-.951 2.125-2.125 2.125h-9A2.125 2.125 0 0 1 3.375 14.5zm10.875-.875h-2.5v10.75h2.5a.875.875 0 0 0 .875-.875v-9a.875.875 0 0 0-.875-.875z"/></svg>',
    center: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M4.5 3.375A2.125 2.125 0 0 0 2.375 5.5v9c0 1.174.951 2.125 2.125 2.125h11A2.125 2.125 0 0 0 17.625 14.5v-9A2.125 2.125 0 0 0 15.5 3.375zm0 1.25h11c.483 0 .875.392.875.875v9a.875.875 0 0 1-.875.875h-11a.875.875 0 0 1-.875-.875v-9c0-.483.392-.875.875-.875z"/></svg>',
  };

  function displayPeekMode() {
    return peekFull ? "full" : peekMode;
  }

  function closePeek() {
    if (!peekRoot) return;
    // Drop fullscreen history entry without re-opening peek
    if (peekFull && peekHistoryPushed) {
      peekIgnorePop = true;
      peekHistoryPushed = false;
      peekFull = false;
      history.back();
    } else {
      peekFull = false;
      peekHistoryPushed = false;
    }
    peekRoot.setAttribute("data-open", "0");
    peekRoot.setAttribute("data-mode", peekMode);
    peekRoot.querySelector("[data-nsp-peek-body]").innerHTML = "";
    peekCurrentHref = "";
    document.body.style.overflow = "";
  }

  function exitFullPeek() {
    if (!peekFull) return;
    if (peekHistoryPushed) {
      peekHistoryPushed = false;
      history.back(); // popstate → restorePeekAfterFull
      return;
    }
    peekFull = false;
    if (peekCurrentHref) openPeek(peekCurrentHref, peekMode);
    else closePeek();
  }

  function enterFullPeek(href) {
    if (peekFull) return;
    peekFull = true;
    try {
      history.pushState({ nspPeekFull: true, href }, "", href);
      peekHistoryPushed = true;
    } catch (_) {
      peekHistoryPushed = false;
    }
    openPeek(href);
  }

  function restorePeekAfterFull() {
    peekFull = false;
    peekHistoryPushed = false;
    if (peekCurrentHref) openPeek(peekCurrentHref, peekMode);
    else closePeek();
  }

  async function openPeek(href, mode) {
    if (mode === "full") {
      enterFullPeek(href);
      return;
    }
    if (mode === "side" || mode === "center") {
      peekMode = mode;
      localStorage.setItem("nsp-peek-mode", peekMode);
      peekFull = false;
    }
    const root = ensurePeekRoot();
    root.setAttribute("data-mode", displayPeekMode());
    peekCurrentHref = href;
    document.body.style.overflow = "hidden";

    const left = root.querySelector("[data-nsp-peek-left]");
    const right = root.querySelector("[data-nsp-peek-right]");
    const body = root.querySelector("[data-nsp-peek-body]");
    left.innerHTML = "";
    right.innerHTML = "";

    if (peekFull) {
      left.appendChild(iconBtn("Exit full page", SVG.compress, exitFullPeek));
    } else {
      left.appendChild(iconBtn("Open in full page", SVG.expand, () => {
        enterFullPeek(href);
      }));
    }
    left.appendChild(iconBtn("Open in new tab", SVG.newtab, () => {
      window.open(href, "_blank", "noopener,noreferrer");
    }));
    if (!peekFull) {
      left.appendChild(iconBtn(
        peekMode === "side" ? "Center peek" : "Side peek",
        peekMode === "side" ? SVG.center : SVG.side,
        () => openPeek(href, peekMode === "side" ? "center" : "side"),
      ));
    }
    right.appendChild(iconBtn("Close", SVG.close, closePeek));

    body.innerHTML = '<div style="padding:24px;opacity:.6">Loading…</div>';
    root.setAttribute("data-open", "1");
    root.setAttribute("data-peek-bar", "1");
    setTimeout(() => root.setAttribute("data-peek-bar", "0"), 1800);

    try {
      const res = await fetch(href);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      let captures = [];
      try {
        const raw = doc.getElementById("nsp-collection-views");
        if (raw) captures = JSON.parse(raw.textContent || "[]");
      } catch (_) {}

      const header =
        doc.querySelector("header") ||
        doc.querySelector(".notion-topbar")?.closest("header") ||
        doc.querySelector(".notion-topbar");
      const main =
        doc.querySelector("main#main") ||
        doc.querySelector(".notion-page-content") ||
        doc.body;

      body.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "nsp-peek-content";
      if (header) {
        wrap.appendChild(header.cloneNode(true));
      }
      if (main && main !== header) {
        const mWrap = document.createElement("div");
        mWrap.setAttribute("data-nsp-peek-main", "1");
        mWrap.innerHTML = main.innerHTML;
        wrap.appendChild(mWrap);
      } else if (!header && main) {
        wrap.innerHTML = main.innerHTML;
      }
      body.appendChild(wrap);
      // Re-wire interactive bits inside peek
      wireToggles(body);
      enhanceMedia(body);
      loadAssetMap().then(() => enhanceMedia(body));
      wireCardActions(body);
      wireCollectionsIn(body, captures);
      padCollectionToolbars();
      layoutTopbar();
      // Internal links inside peek open in peek (keep fullscreen if active)
      body.onclick = (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = e.target.closest("a[href]");
        if (!a || a.closest("[data-nsp-card-actions]")) return;
        const h = a.getAttribute("href") || "";
        if (!isLocalHtmlHref(h)) return;
        e.preventDefault();
        e.stopPropagation();
        const next = h.split("#")[0];
        if (peekFull) {
          peekCurrentHref = next;
          try {
            history.replaceState({ nspPeekFull: true, href: next }, "", next);
          } catch (_) {}
          openPeek(next);
        } else {
          openPeek(next, peekMode);
        }
      };
    } catch (err) {
      body.innerHTML =
        '<div style="padding:24px">Could not load page. <a href="' +
        href +
        '">Open full page</a></div>';
    }
  }

  if (!window.__nspPeekPopstate) {
    window.__nspPeekPopstate = true;
    window.addEventListener("popstate", () => {
      if (peekIgnorePop) {
        peekIgnorePop = false;
        return;
      }
      if (peekFull) restorePeekAfterFull();
    });
  }

  function isLocalHtmlHref(href) {
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) return false;
    if (href.startsWith("http")) {
      try {
        const u = new URL(href);
        return u.origin === location.origin && /\\.html($|\\?)/.test(u.pathname);
      } catch {
        return false;
      }
    }
    return /\\.html($|\\?|#)/.test(href);
  }

  function wirePeekNavigation() {
    if (document.documentElement.dataset.nspPeekNav) return;
    document.documentElement.dataset.nspPeekNav = "1";
    document.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest("a[href]");
      if (!a) return;
      if (a.closest("[data-nsp-peek-bar], [data-nsp-menu], [data-nsp-card-actions]")) return;
      const href = a.getAttribute("href") || "";
      if (!isLocalHtmlHref(href)) return;
      const isCollection = a.closest(
        ".notion-collection-item, .notion-gallery-view, .notion-table-view, .notion-board-view, .notion-calendar-view, .notion-list-view, .notion-collection_view-block, .notion-collection_view_page-block",
      );
      if (!isCollection) return;
      e.preventDefault();
      e.stopPropagation();
      openPeek(href.split("#")[0] || href);
    }, true);
  }

  function wireCardActions(scope) {
    const root = scope || document;
    for (const item of $$(".notion-collection-item", root)) {
      if (item.dataset.nspCard) continue;
      item.dataset.nspCard = "1";
      const a = item.querySelector("a[href]");
      if (!a) continue;
      const href = a.getAttribute("href") || "";
      if (!isLocalHtmlHref(href)) continue;
      const actions = document.createElement("div");
      actions.setAttribute("data-nsp-card-actions", "1");
      const mk = (label, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          fn();
        });
        return b;
      };
      actions.appendChild(mk("Peek", () => openPeek(href.split("#")[0])));
      actions.appendChild(mk("New tab", () => window.open(href, "_blank", "noopener,noreferrer")));
      actions.appendChild(mk("Open", () => { location.href = href; }));
      const host = item.querySelector("[role='presentation']") || item;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.appendChild(actions);
    }
  }

  function boot() {
    injectStyles();
    registerPwa();
    loadAssetMap();
    syncViewport();
    hidePromos();
    wireOriginalMenu();
    layoutTopbar();
    wireToggles(document);
    wireToc();
    enhanceMedia(document);
    // Re-run media repair after cache map loads
    loadAssetMap().then(() => enhanceMedia(document));
    padCollectionToolbars();
    wirePeekNavigation();
    wireCardActions(document);
    window.addEventListener("resize", syncViewport);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePeek();
    });

    let captures = [];
    try {
      const raw = document.getElementById("nsp-collection-views");
      if (raw) captures = JSON.parse(raw.textContent || "[]");
    } catch (_) {}

    wireCollectionsIn(document, captures);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
`;

export function injectRuntime(
  html: string,
  collectionViews: unknown[],
  runtimeSrc: string,
  originalUrl?: string,
): string {
  const json = JSON.stringify(collectionViews).replace(/</g, "\\u003c");
  const safeUrl = (originalUrl || "").replace(/"/g, "&quot;");
  let out = html;
  if (safeUrl) {
    if (/<html\b[^>]*>/i.test(out)) {
      out = out.replace(/<html\b([^>]*)>/i, (full, attrs: string) => {
        if (/data-nsp-original-url=/i.test(attrs)) return full;
        return `<html${attrs} data-nsp-original-url="${safeUrl}">`;
      });
    } else {
      out = `<html data-nsp-original-url="${safeUrl}">` + out;
    }
  }

  const headTags = `
<link rel="manifest" href="./manifest.webmanifest" />
<meta name="theme-color" content="#191919" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="apple-touch-icon" href="./assets/nsp-icon.svg" />
`;
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${headTags}</head>`);
  } else {
    out = headTags + out;
  }

  const payload = `
<script type="application/json" id="nsp-collection-views">${json}</script>
<script src="${runtimeSrc}" defer></script>
<style id="nsp-responsive">
  html, body { width: 100% !important; max-width: 100% !important; overflow-x: hidden; }
  .notion-frame, main.notion-frame, .notion-cursor-listener { width: 100% !important; max-width: 100% !important; }
  .notion-topbar [aria-label="Share site to socials"],
  .notion-topbar .duplicate { display: none !important; }
  .notion-image-block, .notion-image-block > div { max-width: 100% !important; }
  .notion-image-block img {
    max-width: 100% !important;
    width: 100% !important;
    height: auto !important;
    max-height: none !important;
    object-fit: contain !important;
  }
  .notion-audio-block, .notion-audio-block audio { max-width: 100% !important; width: 100%; }
  .notion-table-view, .notion-scroller.horizontal {
    overflow-x: auto !important;
    max-width: 100%;
  }
  .notion-collection-view-body,
  .notion-gallery-view,
  .notion-calendar-view,
  .notion-table-view {
    background: var(--c-bacPri, inherit);
    min-height: 40vh;
  }
  .notion-collection-view-tab[data-nsp-active="1"],
  .notion-collection-view-tab[aria-selected="true"] {
    background: var(--ca-graBacSecTra, rgba(255,255,255,.1)) !important;
  }
  .notion-toggle-block [role="button"],
  .notion-toggle-block { cursor: pointer; }
  @media (max-width: 820px) {
    .notion-column_list-block > div {
      flex-direction: column !important;
      align-items: stretch !important;
    }
    .notion-column_list-block > div > div {
      width: 100% !important;
      max-width: 100% !important;
      flex-grow: 1 !important;
      flex-shrink: 1 !important;
    }
    .notion-column_list-block > div > div[style*="opacity: 0"],
    .notion-column_list-block > div > div[style*="width: 46px"] {
      display: none !important;
      height: 0 !important;
      width: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    .layout, .layout-wide, .layout-content {
      padding-inline: 12px !important;
    }
  }
</style>
  `;
  if (out.includes("</body>")) {
    return out.replace("</body>", `${payload}</body>`);
  }
  return out + payload;
}
