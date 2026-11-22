/* Download buttons beside each chart and statistic, so nobody has to go to the Export page.
   - Chart cards: a "Download" menu with Picture (PNG) and Data (CSV for Excel).
   - Statistic cards (KPI tiles): a small download icon (CSV: name, value, unit, note).
   - Cards with key/value lists or tables: Data (CSV).
   Files contain exactly what is on screen (same units, same period, same well).
   The Export page and the existing export buttons are not changed. */
(function () {
  if (!window.PN) return;
  const page = document.body.dataset.page || "home";
  if (page === "export" || page === "notfound") return;          // the Export page already is all download buttons

  const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 19.5h14"/></svg>`;
  const t = k => PN.t(k);

  // ---------------------------------------------------------------- helpers
  const clean = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  function fileName(title) {
    const sel = document.getElementById("well-select");
    const well = sel && sel.offsetParent !== null ? PN.state.well : "";
    let base = clean(title).replace(/^\d+\s*·\s*/, "");
    if (well && !base.includes(well)) base = well + " " + base;
    base = base.replace(/[\\/:*?"<>|·,]+/g, " ").replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    return `PetroNova_${page}_${base || "data"}`.slice(0, 120);
  }
  function csvCell(v) {
    if (v == null || (typeof v === "number" && !isFinite(v))) return "";
    const s = typeof v === "number" ? String(Number(v.toPrecision(6))) : String(v);   // 97.2674834624 -> 97.2675
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function saveCsv(rows, name) {
    const text = "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");   // BOM: Excel opens ə, ş, ü, Cyrillic correctly
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name + ".csv";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const empty = () => PN.toast(t("xp_empty"));

  // ---------------------------------------------------------------- chart -> table
  function axisTitle(gd, ref, kind) {
    const key = (ref || kind).replace(/^([xy])(\d*)$/, (_, a, n) => a + "axis" + n);
    const ax = gd.layout && gd.layout[key];
    const tt = ax && ax.title;
    return clean(typeof tt === "string" ? tt : tt && tt.text).replace(/<[^>]+>/g, "");
  }
  // axis "Oil, t/d / Water, m³/d" + series "Water · test" -> "m³/d"; axis "Pressure (psia)" -> keep as is
  function unitFor(axis, name) {
    if (!axis) return "";
    const parts = axis.split(" / ").map(p => p.split(/,\s*/));
    if (parts.every(p => p.length >= 2)) {
      const first = norm(name).split(" ")[0];
      const hit = parts.find(p => norm(p[0]).split(" ")[0] === first) || (parts.length === 1 ? parts[0] : null);
      return hit ? hit.slice(1).join(", ") : "";
    }
    return axis;
  }
  const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").trim();

  function chartRows(gd) {
    const traces = (gd.data || []).filter(tr => tr.visible !== false && !(tr.showlegend === false && !tr.name));
    if (!traces.length) return null;
    // pie / donut: one row per slice
    const pie = traces.find(tr => tr.type === "pie");
    if (pie) return [[t("xp_item"), clean(pie.name) || t("xp_value")], ...(pie.labels || []).map((l, i) => [l, (pie.values || [])[i]])];
    // everything else: join all series on their x value -> one column per series
    const withXY = traces.filter(tr => tr.y && tr.y.length);
    if (!withXY.length) return null;
    const x0 = withXY[0].x || [];
    const dateX = x0.length && x0.every(v => v instanceof Date || (typeof v === "string" && !isNaN(Date.parse(v)) && /\d{4}-\d{2}/.test(v)));
    const xName = axisTitle(gd, withXY[0].xaxis, "x") || (dateX ? t("xp_time") : t("xp_item"));
    const keys = [], idx = new Map();
    const cols = withXY.map(tr => {
      const name = clean(tr.name) || axisTitle(gd, tr.yaxis, "y") || "y";
      const unit = unitFor(axisTitle(gd, tr.yaxis, "y"), name);
      const m = new Map();
      const xs = tr.x && tr.x.length ? tr.x : tr.y.map((_, i) => i);
      xs.forEach((x, i) => {
        const k = x instanceof Date ? x.toISOString() : String(x);
        if (!idx.has(k)) { idx.set(k, keys.length); keys.push(x); }
        m.set(k, tr.y[i]);
      });
      return { head: unit && !name.includes(unit) ? `${name} [${unit}]` : name, m };
    });
    // keep a natural order: numbers / dates ascending when all x look like them
    const allNum = keys.every(k => typeof k === "number" || (k !== "" && !isNaN(+k)));
    const allDate = !allNum && keys.every(k => !isNaN(Date.parse(k)));
    if (allNum) keys.sort((a, b) => +a - +b);
    else if (allDate) keys.sort((a, b) => Date.parse(a) - Date.parse(b));
    return [[xName, ...cols.map(c => c.head)],
            ...keys.map(x => { const k = x instanceof Date ? x.toISOString() : String(x); return [x, ...cols.map(c => c.m.get(k))]; })];
  }

  // ---------------------------------------------------------------- statistic cards, key/value lists, tables -> rows
  function kpiRows(card) {
    const label = clean(card.querySelector(".label") && card.querySelector(".label").innerText);
    const valEl = card.querySelector(".value");
    const unit = clean(valEl && valEl.querySelector(".unit") && valEl.querySelector(".unit").innerText);
    let value = clean(valEl && valEl.innerText).replace(unit, "").trim();
    // "1,949" -> "1949": the app always writes thousands with commas; Excel in AZ/RU would read the comma as a decimal point
    if (/^[−-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) value = value.replace(/,/g, "").replace("−", "-");
    const note = clean(card.querySelector(".foot") && card.querySelector(".foot").innerText);
    return [[t("xp_item"), t("xp_value"), t("xp_unit"), t("xp_note")], [label, value, unit, note]];
  }
  function blockRows(card) {
    const rows = [];
    card.querySelectorAll("table").forEach(tb => {
      tb.querySelectorAll("tr").forEach(tr => rows.push([...tr.children].map(c => clean(c.innerText))));
      rows.push([]);
    });
    card.querySelectorAll(".kv").forEach(kv => {
      const ks = kv.querySelectorAll(":scope > .k"), vs = kv.querySelectorAll(":scope > .v");
      ks.forEach((k, i) => rows.push([clean(k.innerText), clean(vs[i] && vs[i].innerText)]));
      rows.push([]);
    });
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    return rows.length ? rows : null;
  }

  // ---------------------------------------------------------------- buttons
  const titleOf = card => clean((card.querySelector(".card-h h3, .card-h h2, .panel-h h3, .panel-h h2, .label") || {}).innerText);

  function menuButton(card, charts) {
    const box = document.createElement("div");
    box.className = "xp";
    const hasBlock = !!card.querySelector("table, .kv");
    box.innerHTML = `<button type="button" class="xp-btn" aria-haspopup="menu" aria-expanded="false">${ICON}<span data-i18n="xp_btn"></span></button>
      <div class="xp-menu hidden" role="menu">
        ${charts.length ? `<button type="button" role="menuitem" data-k="png" data-i18n="xp_png"></button>` : ""}
        <button type="button" role="menuitem" data-k="csv" data-i18n="xp_csv"></button>
      </div>`;
    const btn = box.querySelector(".xp-btn"), menu = box.querySelector(".xp-menu");
    const shut = () => { menu.classList.add("hidden"); btn.setAttribute("aria-expanded", "false"); };
    btn.onclick = e => {
      e.stopPropagation();
      document.querySelectorAll(".xp-menu").forEach(m => m !== menu && m.classList.add("hidden"));
      const open = menu.classList.toggle("hidden") === false;
      btn.setAttribute("aria-expanded", String(open));
    };
    menu.onclick = e => {
      const k = e.target.closest("[data-k]") && e.target.closest("[data-k]").dataset.k;
      if (!k) return;
      shut();
      const name = fileName(titleOf(card));
      const live = charts.filter(c => c.classList.contains("js-plotly-plot") && c.data && c.data.length && c.offsetParent !== null);
      if (k === "png") {
        if (!live.length) return empty();
        live.forEach((gd, i) => Plotly.downloadImage(gd, { format: "png", filename: name + (live.length > 1 ? "_" + (i + 1) : ""),
                                                          width: gd.offsetWidth || 1200, height: gd.offsetHeight || 500, scale: 2 }));
      } else {
        let rows = [];
        live.forEach(gd => { const r = chartRows(gd); if (r) rows = rows.concat(rows.length ? [[]] : [], r); });
        if (hasBlock) { const b = blockRows(card); if (b) rows = rows.concat(rows.length ? [[]] : [], b); }
        rows.length ? saveCsv(rows, name) : empty();
      }
    };
    document.addEventListener("click", e => { if (!box.contains(e.target)) shut(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") shut(); });
    return box;
  }

  function kpiButton(card) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "xp-mini"; b.innerHTML = ICON;
    const label = () => { b.title = t("xp_csv"); b.setAttribute("aria-label", t("xp_csv") + ": " + titleOf(card)); };
    label(); document.getElementById("lang")?.addEventListener("click", () => setTimeout(label));
    b.onclick = e => {
      e.stopPropagation();
      const rows = kpiRows(card);
      rows[1][1] && rows[1][1] !== "—" ? saveCsv(rows, fileName(rows[1][0])) : empty();
    };
    return b;
  }

  function attach() {
    document.querySelectorAll(".card, .panel").forEach(card => {
      if (card.closest(".topbar, .nova-panel, .footer")) return;
      if (card.dataset.xp) return;
      if (card.classList.contains("kpi")) {
        if (card.closest(".drawer-card")) return;
        if (!card.querySelector(".value")) return;
        card.dataset.xp = "1"; card.classList.add("xp-host");
        card.append(kpiButton(card));
        return;
      }
      const head = card.querySelector(":scope > .card-h, :scope > .panel-h");
      if (!head) return;
      const charts = [...card.querySelectorAll(".chart")];
      if (!charts.length && !card.querySelector("table, .kv")) return;
      card.dataset.xp = "1";
      const box = menuButton(card, charts);
      head.append(box);
      PN.applyI18n(box);
    });
  }
  attach();
  setTimeout(attach, 1500);      // cards some pages add after their data arrives
})();
