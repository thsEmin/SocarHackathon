/* PetroNova core: state, API, i18n, formatting, chart theme, shell controls. */
(function () {
  const store = {
    get(k, d) { try { return localStorage.getItem("pn_" + k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("pn_" + k, v); } catch (e) { /* private mode */ } },
  };
  const params = new URLSearchParams(location.search);
  if (params.get("well")) store.set("well", params.get("well"));

  const PN = window.PN = {
    state: { ds: store.get("ds", "preloaded"), well: store.get("well", "GL-01"), lang: store.get("lang", "en"), datasets: [] },
    colors: { oil: "#3F8A24", gas: "#E5484D", water: "#2F80ED", accent: "#0077C8", whp: "#00A3D9", down: "#8A99AD",
              dhp: "#7B61FF", temp: "#D6336C", ann: "#E08A00", lift: "#0FA3B1", choke: "#0B2341",
              ok: "#3F8A24", warn: "#F2A900", alarm: "#D7263D", red: "#EF3340", blue: "#00B5E2", green: "#509E2F",
              grid: "rgba(11,35,65,0.07)", text2: "#44546A", text3: "#5F6F84",
              ink: "#0B2341", line: "#C9D2DE", muted: "rgba(95,111,132,.5)" },
    page: null,
  };

  // ---------------- units (display only: the server always works in field units)
  // each option: [label, factor, offset]  ->  shown = value * factor + offset
  // oil density for tonnes: median well-test gravity 30.7 °API -> 141.5 / (131.5 + 30.7) = 0.872 t/m³
  const OIL_SG = 0.872;
  PN.UNITS = {
    p:   { psi: ["psia", 1], bar: ["bar", 0.0689476], kPa: ["kPa", 6.89476], MPa: ["MPa", 0.00689476], Pa: ["Pa", 6894.76], atm: ["atm", 0.0680460], kgf: ["kgf/cm²", 0.0703070] },
    dp:  { psi: ["psi", 1], bar: ["bar", 0.0689476], kPa: ["kPa", 6.89476], MPa: ["MPa", 0.00689476], Pa: ["Pa", 6894.76], atm: ["atm", 0.0680460], kgf: ["kgf/cm²", 0.0703070] },
    t:   { F: ["°F", 1, 0], C: ["°C", 5 / 9, -32 * 5 / 9], K: ["K", 5 / 9, 255.372] },
    // oil has its own unit so it can be shown in tonnes (water stays in volume)
    oil: { stbd: ["stb/d", 1], m3d: ["m³/d", 0.158987], td: ["t/d", 0.158987 * OIL_SG], bpd_k: ["Mstb/d", 0.001] },
    liq: { stbd: ["stb/d", 1], m3d: ["m³/d", 0.158987], bpd_k: ["Mstb/d", 0.001] },
    gas: { mscfd: ["Mscf/d", 1], m3d: ["m³/d", 28.3168], km3d: ["10³ m³/d", 0.0283168], mmscfd: ["MMscf/d", 0.001] },
    len: { ft: ["ft", 1], m: ["m", 0.3048] },
  };
  // first visit: units used in Azerbaijan (kgf/cm², °C, oil in tonnes, water m³, gas thousand m³, metres)
  PN.UNIT_PRESETS = { az: { p: "kgf", t: "C", oil: "td", liq: "m3d", gas: "km3d", len: "m" },
                      field: { p: "psi", t: "F", oil: "stbd", liq: "stbd", gas: "mscfd", len: "ft" },
                      metric: { p: "bar", t: "C", oil: "m3d", liq: "m3d", gas: "m3d", len: "m" },
                      si: { p: "kPa", t: "K", oil: "m3d", liq: "m3d", gas: "m3d", len: "m" } };
  PN.UNIT_DEFAULT = PN.UNIT_PRESETS.az;
  // saved choices from before oil had its own unit: start oil from the water unit they chose
  try { const saved = JSON.parse(store.get("units", "null"));
        PN.state.units = saved ? Object.assign({}, PN.UNIT_PRESETS.field, { oil: saved.liq || "stbd" }, saved) : Object.assign({}, PN.UNIT_DEFAULT); }
  catch (e) { PN.state.units = Object.assign({}, PN.UNIT_DEFAULT); }
  const sel = kind => { const k = kind === "dp" ? "p" : kind; const tab = PN.UNITS[kind]; return tab[PN.state.units[k]] || tab[Object.keys(tab)[0]]; };
  PN.ul = kind => sel(kind)[0];                                                       // unit label
  PN.cv = (kind, v) => (v == null || !isFinite(v)) ? v : v * sel(kind)[1] + (sel(kind)[2] || 0);   // convert one value
  PN.cva = (kind, a) => (a || []).map(v => PN.cv(kind, v));                          // convert an array
  // volumes: a rate unit "per day" -> the matching volume unit (stb/d -> stb, m³/d -> m³)
  PN.vl = kind => PN.ul(kind).replace("/d", "");
  PN.setUnits = function (u) {
    PN.state.units = Object.assign({}, PN.state.units, u); store.set("units", JSON.stringify(PN.state.units));
    PN.applyI18n(); PN.page && PN.page.render && PN.page.render();
  };
  const UNIT_KEYS = { stbd: () => PN.ul("liq"), stbd_oil: () => PN.ul("oil"), mscfd: () => PN.ul("gas"), psia: () => PN.ul("p"), psi: () => PN.ul("dp"),
                      degf: () => PN.ul("t"), ft: () => PN.ul("len") };

  // problem-issue evidence -> text parameters, converted to the chosen units
  const EV_KIND = { pwf: "p", pb: "p", dwhp: "dp", ddhp: "dp", dp_skin: "dp", gain: "oil", q: "oil", dq: "oil", q90: "oil",
                    dq90: "oil", lift: "gas", lift_b: "gas" };
  const unitDigits = kind => (["MPa", "bar", "atm", "kgf/cm²", "Mstb/d", "MMscf/d", "10³ m³/d"].includes(PN.ul(kind)) ? 1 : 0);
  PN.issueParams = function (ev) {
    const o = {};
    Object.entries(ev || {}).forEach(([k, v]) => {
      if (v == null) o[k] = "—";
      else if (k === "rate" && ev.pb != null) o[k] = `${PN.signed(PN.cv("dp", v), 1)} ${PN.ul("dp")}`;
      else if (EV_KIND[k]) o[k] = `${PN.fmt(PN.cv(EV_KIND[k], v), unitDigits(EV_KIND[k]))} ${PN.ul(EV_KIND[k])}`;
      else if (k === "skin") o[k] = PN.signed(v, 1);
      else if (["dec", "pct", "dgor"].includes(k)) o[k] = PN.signed(v, 0);
      else if (["dwc", "rate"].includes(k)) o[k] = PN.signed(v, 1);
      else o[k] = PN.fmt(v, Math.abs(v) < 100 && v % 1 ? 1 : 0);
    });
    return o;
  };
  PN.usdShort = v => {
    if (v == null || !isFinite(v)) return "—";
    const a = Math.abs(v);
    return a >= 1e6 ? `$${PN.fmt(v / 1e6, 2)}M` : a >= 1e3 ? `$${PN.fmt(v / 1e3, 1)}k` : `$${PN.fmt(v, 0)}`;
  };

  // ---------------- i18n
  PN.t = function (key, p) {
    if (UNIT_KEYS[key]) return UNIT_KEYS[key]();
    const d = (window.I18N[PN.state.lang] || {}), e = window.I18N.en;
    let s = d[key] != null ? d[key] : (e[key] != null ? e[key] : key);
    if (p) s = s.replace(/\{(\w+)\}/g, (_, k) => (p[k] != null ? p[k] : ""));
    return s;
  };
  PN.applyI18n = function (root) {
    (root || document).querySelectorAll("[data-i18n]").forEach(el => { el.textContent = PN.t(el.dataset.i18n); });
    document.documentElement.lang = PN.state.lang;
  };

  // ---------------- formatting
  PN.fmt = function (v, d = 0) {
    if (v == null || !isFinite(v)) return "—";
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  PN.signed = (v, d = 1) => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + PN.fmt(Math.abs(v), d));
  // own month names: browsers often lack Azerbaijani date data
  const MONTHS = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
                   az: ["Yan", "Fev", "Mar", "Apr", "May", "İyn", "İyl", "Avq", "Sen", "Okt", "Noy", "Dek"],
                   ru: ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"] };
  PN.date = (iso, time) => {
    if (!iso) return "—";
    const dt = new Date(iso), p2 = n => String(n).padStart(2, "0");
    const s = `${p2(dt.getDate())} ${MONTHS[PN.state.lang] ? MONTHS[PN.state.lang][dt.getMonth()] : MONTHS.en[dt.getMonth()]} ${dt.getFullYear()}`;
    return time ? `${s}, ${p2(dt.getHours())}:${p2(dt.getMinutes())}` : s;
  };
  PN.time = iso => { const dt = new Date(iso); return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`; };
  PN.countUp = function (el, to, d = 0, ms = 700) {
    if (to == null || !isFinite(to)) { el.textContent = "—"; return; }
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = PN.fmt(to * e, d);
      if (k < 1) requestAnimationFrame(step);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) el.textContent = PN.fmt(to, d);
    else requestAnimationFrame(step);
  };

  // ---------------- API
  PN.api = async function (path, q = {}) {
    const u = new URL(path, location.origin);
    u.searchParams.set("ds", PN.state.ds);
    Object.entries(q).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
    const r = await fetch(u);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
    return j;
  };
  PN.toast = function (msg, ok) {
    const el = document.createElement("div");
    el.className = "toast" + (ok ? " ok" : "");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5200);
  };

  // ---------------- charts
  PN.layout = function (extra = {}) {
    const base = {
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, Segoe UI, sans-serif", size: 12, color: PN.colors.text2 },
      margin: { l: 56, r: 24, t: 12, b: 40 },
      xaxis: { gridcolor: PN.colors.grid, zeroline: false, linecolor: PN.colors.line, tickcolor: PN.colors.line },
      yaxis: { gridcolor: PN.colors.grid, zeroline: false, linecolor: PN.colors.line, tickcolor: PN.colors.line },
      legend: { orientation: "h", x: 0, y: 1.12, font: { size: 12 }, bgcolor: "rgba(0,0,0,0)" },
      hoverlabel: { bgcolor: PN.colors.ink, bordercolor: PN.colors.accent, font: { family: "JetBrains Mono, monospace", size: 12, color: "#EFF0F1" } },
      hovermode: "x unified",
    };
    return deepMerge(base, extra);
  };
  PN.config = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "autoScale2d", "toggleSpikelines"],
                toImageButtonOptions: { format: "png", scale: 2 } };
  PN.plot = (el, data, layout, config) => {
    el.querySelectorAll(":scope > .skel").forEach(s => s.remove());   // loading placeholder
    return Plotly.react(el, data, PN.layout(layout), Object.assign({}, PN.config, config || {}));
  };
  function deepMerge(a, b) {
    const o = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    for (const [k, v] of Object.entries(b)) o[k] = (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object") ? deepMerge(a[k], v) : v;
    return o;
  }
  PN.shade = (spans, color, yref = "paper") => spans.map(s => ({
    type: "rect", xref: "x", yref, x0: s.start, x1: s.end, y0: 0, y1: 1, fillcolor: color, line: { width: 0 }, layer: "below" }));

  // ---------------- icons (stroke icons, 24px grid)
  const P = {
    overview: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 9h8V3h-8z",
    data: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
    sensors: "M3 12h4l3-8 4 16 3-8h4",
    vfm: "M12 3v4M5.6 6.6l2.8 2.8M3 13h4M17 13h4M15.6 9.4l2.8-2.8M12 21a8 8 0 1 0 0-16M12 13l3-4",
    whatif: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    pta: "M3 3v18h18M7 15c3-1 4-6 7-8s4-1 6-1",
    well: "M8 3h8M10 3v18M14 3v18M6 21h12M10 9h4M10 14h4",
    export: "M12 3v12M7 10l5 5 5-5M5 21h14",
    problems: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    info: "M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
    upload: "M12 21V9M7 14l5-5 5 5M5 3h14",
    download: "M12 3v12M7 10l5 5 5-5M5 21h14",
    refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
    arrow: "M5 12h14M13 6l6 6-6 6",
  };
  PN.icon = (name, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${P[name] || P.info}"/></svg>`;

  // ---------------- shell
  async function initShell() {
    document.querySelectorAll("[data-icon]").forEach(el => { el.insertAdjacentHTML("afterbegin", PN.icon(el.dataset.icon)); });
    const page = document.body.dataset.page;
    document.querySelectorAll(".nav a").forEach(a => a.classList.toggle("active", a.dataset.page === page));

    // language
    const seg = document.getElementById("lang");
    seg.querySelectorAll("button").forEach(b => {
      b.classList.toggle("on", b.dataset.lang === PN.state.lang);
      b.onclick = () => {
        PN.state.lang = b.dataset.lang; store.set("lang", PN.state.lang);
        seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
        PN.applyI18n(); PN.redrawUnits && PN.redrawUnits();
        const ds = document.getElementById("ds-select");
        if (ds) { ds.innerHTML = dsOptions(); ds.value = PN.state.ds; }
        PN.page && PN.page.render && PN.page.render();
      };
    });
    PN.applyI18n();
    initUnits();

    // datasets + wells
    try { PN.state.datasets = await (await fetch("/api/datasets")).json(); } catch (e) { PN.state.datasets = []; }
    if (!PN.state.datasets.find(d => d.id === PN.state.ds)) { PN.state.ds = "preloaded"; store.set("ds", "preloaded"); }
    const dsSel = document.getElementById("ds-select");
    if (!dsSel) return;   // pages without the dataset bar (home)
    dsSel.innerHTML = dsOptions();
    dsSel.value = PN.state.ds;
    dsSel.onchange = () => {
      if (dsSel.value === IMPORT) { dsSel.value = PN.state.ds; location.href = "/data"; return; }
      PN.setDataset(dsSel.value);
    };
    fillWells();
  }
  // dataset names: demo samples are named in the chosen language, e.g. "Sample · 7 days (16 Aug → 22 Aug)"
  // escape text that came from outside (uploaded file names, well names) before it goes into innerHTML
  PN.esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  PN.dsName = d => {
    if (d.source === "preloaded") return "SOCAR 2026 (preloaded)";
    if (d.source !== "sample") return PN.esc(d.label);
    const n = Math.round((new Date(d.end) - new Date(d.start)) / 864e5) + 1;
    return PN.t("ds_sample", { n, period: n > 1 ? `${PN.date(d.start)} → ${PN.date(d.end)}` : PN.date(d.start) });
  };
  // dataset list + a last "+ Import new data" entry that opens the import page
  const IMPORT = "__import";
  function dsOptions() {
    return PN.state.datasets.map(d => `<option value="${d.id}">${PN.dsName(d)}</option>`).join("")
      + `<option value="${IMPORT}">＋ ${PN.t("ds_import")}</option>`;
  }
  // units menu in the top bar: presets + one choice per quantity
  function initUnits() {
    const box = document.getElementById("units");
    if (!box) return;
    const btn = box.querySelector("button"), pop = box.querySelector(".units-pop");
    const kinds = [["p", "u_pressure"], ["t", "u_temp"], ["oil", "u_oil"], ["liq", "u_liq"], ["gas", "u_gas"], ["len", "u_len"]];
    const draw = () => {
      const cur = JSON.stringify(PN.state.units);
      const preset = Object.keys(PN.UNIT_PRESETS).find(k => JSON.stringify(Object.assign({}, PN.state.units, PN.UNIT_PRESETS[k])) === cur && Object.keys(PN.UNIT_PRESETS[k]).every(x => PN.UNIT_PRESETS[k][x] === PN.state.units[x]));
      pop.innerHTML = `<div class="seg units-presets">${Object.keys(PN.UNIT_PRESETS).map(k => `<button data-preset="${k}" class="${k === preset ? "on" : ""}">${PN.t("u_" + k)}</button>`).join("")}</div>`
        + kinds.map(([k, lbl]) => `<label class="units-row"><span>${PN.t(lbl)}</span><select data-kind="${k}">${Object.entries(PN.UNITS[k]).map(([id, u]) => `<option value="${id}" ${PN.state.units[k] === id ? "selected" : ""}>${u[0]}</option>`).join("")}</select></label>`).join("")
        + `<div class="units-note">${PN.t("u_note")}</div>`;
      btn.querySelector(".units-cur").textContent = `${PN.ul("p")} · ${PN.ul("t")} · ${PN.ul("oil")}`;
      pop.querySelectorAll("[data-preset]").forEach(b => b.onclick = () => { PN.setUnits(PN.UNIT_PRESETS[b.dataset.preset]); draw(); });
      pop.querySelectorAll("select").forEach(s => s.onchange = () => { PN.setUnits({ [s.dataset.kind]: s.value }); draw(); });
    };
    btn.onclick = e => { e.stopPropagation(); pop.classList.toggle("hidden"); };
    pop.onclick = e => e.stopPropagation();
    document.addEventListener("click", () => pop.classList.add("hidden"));
    PN.redrawUnits = draw;
    draw();
  }

  function fillWells() {
    const ds = PN.state.datasets.find(d => d.id === PN.state.ds);
    const wells = ds ? ds.wells : [];
    if (wells.length && !wells.includes(PN.state.well)) { PN.state.well = wells[0]; store.set("well", PN.state.well); }
    const wSel = document.getElementById("well-select");
    if (!wSel) return;
    wSel.innerHTML = wells.map(w => `<option>${w}</option>`).join("");
    wSel.value = PN.state.well;
    wSel.onchange = () => PN.setWell(wSel.value);
    const per = document.getElementById("ds-period");
    if (per && ds) per.textContent = `${ds.start} → ${ds.end}`;
  }
  PN.setDataset = function (id) {
    PN.state.ds = id; store.set("ds", id);
    document.getElementById("ds-select").value = id;
    fillWells();
    PN.page && PN.page.load && PN.page.load();
  };
  PN.setWell = function (w) {
    PN.state.well = w; store.set("well", w);
    document.getElementById("well-select").value = w;
    PN.page && PN.page.onWell && PN.page.onWell(w);
  };
  PN.refreshDatasets = async function () {
    PN.state.datasets = await (await fetch("/api/datasets")).json();
    const dsSel = document.getElementById("ds-select");
    dsSel.innerHTML = dsOptions();
    dsSel.value = PN.state.ds;
  };

  PN.start = async function (page) {
    PN.page = page;
    await initShell();
    if (page.load) await page.load();
  };
})();

/* Top bar: hidden until the mouse comes near the top of the window.
   Shown briefly on page load so people know it is there; stays open while hovered, while a
   control in it has keyboard focus, or while the units menu is open.
   Touch screens (no mouse): shown at the top of the page and when scrolling up. */
(function () {
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  const NEAR = 72;                                   // px from the top edge that reveals the bar
  let timer = 0;
  const show = () => { clearTimeout(timer); bar.classList.add("show"); };
  const busy = () => bar.matches(":hover") || bar.contains(document.activeElement) ||
                     !!bar.querySelector(".units-pop:not(.hidden)");
  const hide = (delay = 350) => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!busy()) bar.classList.remove("show"); }, delay);
  };

  show(); hide(1800);                                // a short peek on load

  if (window.matchMedia("(hover: hover)").matches) {
    addEventListener("mousemove", e => {
      if (e.clientY <= NEAR) show();
      else if (e.clientY > bar.offsetHeight + 40 && bar.classList.contains("show")) hide();
    }, { passive: true });
    document.addEventListener("mouseleave", () => hide(600));   // mouse left the window
    bar.addEventListener("mouseleave", () => hide());
  } else {
    let lastY = scrollY;
    addEventListener("scroll", () => {
      const y = scrollY;
      if (y < 10 || y < lastY - 4) show(); else if (y > lastY + 4) hide(0);
      lastY = y;
    }, { passive: true });
  }
  bar.addEventListener("focusin", show);
  bar.addEventListener("focusout", () => hide(600));
  document.addEventListener("click", e => { if (!bar.contains(e.target)) hide(200); });
})();
