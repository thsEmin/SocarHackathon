/* Top-bar search: find any chart, card, page or well by name, from the first letter typed.
   Works in EN / AZ / RU at the same time (a word in any language finds the item).
   A well name in the query ("GL-03 horner") opens that chart for that well.
   Picking a result opens the page and scrolls to the chart, which flashes so it is easy to spot. */
(function () {
  if (!window.PN) return;
  const bar = document.querySelector(".topbar-right");
  if (!bar) return;

  // ---------------------------------------------------------------- what can be found
  // t = title text key (i18n), page, id = element to scroll to, kw = extra English search words,
  // k = kind (chart | card), well = true if the page shows one well (a well name in the query applies)
  const ITEMS = [
    // overview
    { t: "field_prod", page: "overview", id: "field-chart", k: "chart", kw: "field rates oil water gas trend daily total production chart" },
    { t: "schematic", page: "overview", id: "schematic", k: "chart", kw: "map wells manifold status layout" },
    { t: "k_avg_oil", page: "overview", id: "k-oil-f", k: "card", kw: "oil rate average kpi" },
    { t: "k_avg_water", page: "overview", id: "k-water-f", k: "card", kw: "water rate average kpi" },
    { t: "k_avg_gas", page: "overview", id: "k-gas-f", k: "card", kw: "gas rate average kpi" },
    { t: "k_wc", page: "overview", id: "k-wc-f", k: "card", kw: "water cut wc bsw kpi" },
    { t: "k_online", page: "overview", id: "k-online-f", k: "card", kw: "wells online producing count" },
    { t: "k_cum", page: "overview", id: "k-cum-f", k: "card", kw: "cumulative oil production" },
    { t: "alerts", page: "overview", id: "schematic", k: "card", kw: "alarms warnings events notifications" },
    // sensors
    { t: "srch_sensor_chart", page: "sensors", id: "sensor-chart", k: "chart", well: true,
      kw: "whp wellhead pressure downhole bottomhole dh pressure temperature annulus casing lift gas injection choke high frequency minute sensors" },
    // VFM
    { t: "srch_vfm_chart", page: "vfm", id: "vfm-chart", k: "chart", well: true, kw: "vfm virtual flow meter daily oil water gas rates well tests prediction" },
    { t: "hr_title", page: "vfm", id: "hourly-chart", k: "chart", well: true, kw: "hourly rates one day vfm" },
    { t: "lambda_txt", page: "vfm", id: "vfm-chart", k: "card", well: true, kw: "ipr lambda productivity" },
    // PTA
    { t: "pta_events", page: "pta", id: "events", k: "card", well: true, kw: "shut-in buildup build-up events list" },
    { t: "history", page: "pta", id: "c-hist", k: "chart", well: true, kw: "rate pressure history buildup shut-in" },
    { t: "loglog", page: "pta", id: "c-loglog", k: "chart", well: true, kw: "log-log derivative bourdet diagnostic plot radial flow wellbore storage" },
    { t: "horner", page: "pta", id: "c-horner", k: "chart", well: true, kw: "horner semilog straight line extrapolated pressure p*" },
    { t: "results", page: "pta", id: "extra", k: "card", well: true, kw: "pta results permeability skin reservoir pressure window" },
    { t: "interpretation", page: "pta", id: "interp", k: "card", well: true, kw: "interpretation comments boundary" },
    { t: "k", page: "pta", id: "r-k-a", k: "card", well: true, kw: "permeability md" },
    { t: "s", page: "pta", id: "r-s-a", k: "card", well: true, kw: "skin damage stimulation" },
    { t: "dps", page: "pta", id: "r-dps-a", k: "card", well: true, kw: "skin pressure drop" },
    { t: "m", page: "pta", id: "r-m-a", k: "card", well: true, kw: "horner slope" },
    // problems
    { t: "pb_by_well", page: "problems", id: "pb-well-chart", k: "chart", kw: "financial loss money per well cost" },
    { t: "pb_by_cause", page: "problems", id: "pb-cause-chart", k: "chart", kw: "loss cause pie damage choke lift gas" },
    { t: "pb_cum", page: "problems", id: "pb-cum-chart", k: "chart", kw: "cumulative loss over time" },
    { t: "pb_list", page: "problems", id: "pb-issues", k: "card", kw: "problems issues root cause solution fix list" },
    { t: "pb_prices", page: "problems", id: "price-oil", k: "card", kw: "oil price gas price dollar" },
    { t: "pb_k_total", page: "problems", id: "k-total-f", k: "card", kw: "lost value money" },
    { t: "pb_k_now", page: "problems", id: "k-now-f", k: "card", kw: "losing now per day" },
    // what-if
    { t: "wi_controls", page: "whatif", id: "choke-abs", k: "card", well: true, kw: "choke lift gas sliders scenario" },
    { t: "wi_effects", page: "whatif", id: "c-wf", k: "chart", well: true, kw: "effect breakdown waterfall scenario" },
    { t: "wi_chain", page: "whatif", id: "chain", k: "card", well: true, kw: "physics chain ipr how it works" },
    // well profile
    { t: "wellbore", page: "well", id: "wb", k: "chart", well: true, kw: "wellbore schematic completion tubing gauge valve drawing" },
    { t: "completion", page: "well", id: "w-comp", k: "card", well: true, kw: "completion tubing depth" },
    { t: "reservoir", page: "well", id: "w-pvt", k: "card", well: true, kw: "reservoir fluid pvt bubble point gor" },
    { t: "cleaning", page: "well", id: "clean-stats", k: "card", kw: "data cleaning report quality" },
    // import / export / home
    { t: "upload", page: "data", id: "n-hf", k: "card", kw: "upload import csv excel file" },
    { t: "exp_vfm", page: "export", id: "exports", k: "card", kw: "download excel vfm export" },
    { t: "exp_pta", page: "export", id: "exports", k: "card", kw: "download excel pta export" },
    { t: "exp_plots", page: "export", id: "exports", k: "card", kw: "download zip plots export" },
    { t: "validation", page: "home", id: "val-table", k: "card", kw: "model validation accuracy error well tests" },
    { t: "physics", page: "home", id: "model", k: "card", kw: "physics checks model lift gas cut" },
  ];
  const PAGES = { home: "n_home", overview: "n_overview", sensors: "n_sensors", vfm: "n_vfm", pta: "n_pta",
                  problems: "n_problems", whatif: "n_whatif", data: "n_data", export: "n_export", well: "n_well" };
  const PAGE_TITLE = { overview: "p_overview", sensors: "p_sensors", vfm: "p_vfm", pta: "p_pta", problems: "p_problems",
                       whatif: "p_whatif", data: "p_data", export: "p_export", well: "p_well" };
  const here = document.body.dataset.page || "home";

  // ---------------------------------------------------------------- text matching
  const norm = s => String(s || "").toLowerCase()
    .replace(/ə/g, "e").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9а-яё*]+/g, " ").trim();
  const tr = (key, lang) => { const d = window.I18N[lang] || {}; return d[key] != null ? d[key] : (window.I18N.en[key] || ""); };
  // the three languages together; step numbers like "2 · " at the start are left out
  const allLangs = key => ["en", "az", "ru"].map(l => tr(key, l).replace(/^\s*\d+\s*·\s*/, "")).join(" | ");

  function score(hay, q) {
    // hay and q are normalized; higher is better, 0 = no match
    if (!q) return 0;
    if (hay.startsWith(q)) return 100;
    if ((" " + hay).includes(" " + q)) return 80;
    if (hay.includes(q)) return 60;
    // small typos: letters in order inside ONE word, e.g. "hrnr" -> "horner"
    if (q.length < 3) return 0;
    for (const word of hay.split(" ")) {
      if (word[0] !== q[0]) continue;
      let i = 0;
      for (const ch of word) if (ch === q[i]) i++;
      if (i === q.length) return 25;
    }
    return 0;
  }
  function wellIn(q) {
    const m = q.match(/\bgl\s*-?\s*0?(\d{1,2})\b/i);
    if (!m) return null;
    const w = "GL-" + String(m[1]).padStart(2, "0");
    return { well: w, rest: q.replace(m[0], " ").trim() };
  }
  function wells() {
    const d = (PN.state.datasets || []).find(x => x.id === PN.state.ds);
    return d && d.wells && d.wells.length ? d.wells : Array.from({ length: 10 }, (_, i) => "GL-" + String(i + 1).padStart(2, "0"));
  }

  function search(raw) {
    let q = norm(raw), well = null;
    const w = wellIn(raw);
    if (w && wells().includes(w.well)) { well = w.well; q = norm(w.rest); }
    const out = [];
    // charts and cards: every word of the query must match somewhere
    const words = q ? q.split(" ") : [];
    for (const it of ITEMS) {
      if (well && !it.well) continue;
      const title = norm(allLangs(it.t)), page = norm(allLangs(PAGES[it.page])), kw = norm(it.kw);
      let s = 0;
      if (!words.length) s = well ? 50 : 0;        // only a well typed: show that well's charts
      else {
        for (const wd of words) {
          const v = Math.max(score(title, wd), score(kw, wd) * 0.8, score(page, wd) * 0.6);
          if (!v) { s = 0; break; }
          s += v;
        }
        s /= words.length;
      }
      if (s > 0) out.push({ s: s + (it.k === "chart" ? 4 : 0), type: it.k, item: it, well });
    }
    // pages
    if (!well) for (const [p, key] of Object.entries(PAGES)) {
      const hay = norm(allLangs(key) + " | " + (PAGE_TITLE[p] ? allLangs(PAGE_TITLE[p]) : ""));
      const s = words.length ? Math.min(...words.map(wd => score(hay, wd))) : 0;
      if (s > 0) out.push({ s: s + 6, type: "page", page: p });
    }
    // wells
    for (const wl of wells()) {
      // "gl", "gl0", "gl-03", "03" and "3" all find GL-03
      const compact = norm(wl).replace(/\s/g, ""), qc = q.replace(/\s/g, "");
      const s = well ? (well === wl && !words.length ? 120 : 0)
        : Math.max(score(compact, qc), score(norm(wl), q), /^\d{1,2}$/.test(qc) && +qc === +wl.slice(3) ? 90 : 0);
      if (s > 0) out.push({ s: s + 2, type: "well", well: wl });
    }
    // Nova
    const ns = words.length ? Math.min(...words.map(wd => score(norm("nova chat assistant ai bot help " + allLangs("nova_title")), wd))) : 0;
    if (ns > 0) out.push({ s: ns, type: "nova" });
    out.sort((a, b) => b.s - a.s);
    // good matches found: hide the weak, typo-style ones
    const best = out.length ? out[0].s : 0;
    return out.filter(r => best < 60 || r.s >= 45).slice(0, 8);
  }

  // ---------------------------------------------------------------- go to a result
  function go(r) {
    if (r.type === "nova") { close(); const f = document.querySelector(".nova-fab"); f && f.click(); return; }
    if (r.type === "well") { PN.state.well = r.well; location.href = "/well?well=" + encodeURIComponent(r.well); return; }
    if (r.type === "page") { location.href = r.page === "home" ? "/" : "/" + r.page; return; }
    const it = r.item;
    const sameWell = !r.well || r.well === PN.state.well;
    if (it.page === here && sameWell && document.getElementById(it.id)) { close(); reveal(it.id); return; }
    const u = new URL(it.page === "home" ? "/" : "/" + it.page, location.origin);
    u.searchParams.set("focus", it.id);
    if (r.well) u.searchParams.set("well", r.well);
    location.href = u.pathname + u.search;
  }

  // scroll to an element and flash its card
  function reveal(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    const box = el.closest(".card, .panel, section") || el;
    box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    box.classList.remove("srch-flash"); void box.offsetWidth; box.classList.add("srch-flash");
    setTimeout(() => box.classList.remove("srch-flash"), 2200);
    return true;
  }
  // arriving from a search on another page: ?focus=<id>
  (function arrive() {
    const p = new URLSearchParams(location.search), id = p.get("focus");
    if (!id) return;
    p.delete("focus");
    history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash);
    let n = 0;
    const tryIt = () => {
      if (reveal(id)) setTimeout(() => reveal(id), 900);      // again once charts have drawn and the page has settled
      else if (n++ < 60) setTimeout(tryIt, 100);
    };
    setTimeout(tryIt, 250);
  })();

  // ---------------------------------------------------------------- the box
  const wrap = document.createElement("div");
  wrap.className = "srch";
  wrap.innerHTML = `
    <svg class="srch-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
    <input type="search" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="srch-list" aria-autocomplete="list">
    <kbd class="srch-key">/</kbd>
    <ul class="srch-list hidden" id="srch-list" role="listbox"></ul>`;
  bar.prepend(wrap);
  const input = wrap.querySelector("input"), list = wrap.querySelector(".srch-list");
  let res = [], sel = 0;

  const label = () => { input.placeholder = PN.t("srch_ph"); input.setAttribute("aria-label", PN.t("srch_ph")); };
  label();

  function mark(text, raw) {
    const q = (wellIn(raw) ? wellIn(raw).rest : raw).trim();
    const safe = PN.esc(text);
    if (!q) return safe;
    // highlight the first word of the query where it appears (plain case-insensitive match)
    const w = q.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return w ? safe.replace(new RegExp("(" + w + ")", "i"), "<mark>$1</mark>") : safe;
  }
  function row(r, i) {
    let title, where, kind = PN.t("srch_" + r.type);
    if (r.type === "page") { title = PN.t(PAGE_TITLE[r.page] || PAGES[r.page]); where = PN.t(PAGES[r.page]); }
    else if (r.type === "well") { title = r.well; where = PN.t("n_well"); }
    else if (r.type === "nova") { title = PN.t("nova_title"); where = PN.t("srch_nova_where"); kind = "AI"; }
    else { title = PN.t(r.item.t); where = PN.t(PAGES[r.item.page]) + (r.well ? " · " + r.well : ""); }
    return `<li role="option" id="srch-o${i}" class="${i === sel ? "on" : ""}" data-i="${i}" aria-selected="${i === sel}">
      <span class="srch-kind k-${r.type}">${PN.esc(kind)}</span>
      <span class="srch-txt"><span class="srch-t">${mark(title, input.value)}</span><span class="srch-w">${PN.esc(where)}</span></span></li>`;
  }
  function draw() {
    const q = input.value.trim();
    if (!q) { close(); return; }
    res = search(q); sel = Math.min(sel, Math.max(0, res.length - 1));
    list.innerHTML = res.length ? res.map(row).join("") : `<li class="srch-none">${PN.esc(PN.t("srch_none"))}</li>`;
    list.classList.remove("hidden"); input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", res.length ? "srch-o" + sel : "");
    const on = list.querySelector("li.on"); on && on.scrollIntoView({ block: "nearest" });
  }
  function close() { list.classList.add("hidden"); input.setAttribute("aria-expanded", "false"); }

  input.addEventListener("input", () => { sel = 0; draw(); });
  input.addEventListener("focus", () => { if (input.value.trim()) draw(); });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!res.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + res.length) % res.length; draw();
    } else if (e.key === "Enter") {
      e.preventDefault(); if (res[sel]) go(res[sel]);
    } else if (e.key === "Escape") {
      if (!list.classList.contains("hidden")) close(); else { input.value = ""; input.blur(); }
    }
  });
  list.addEventListener("mousedown", e => {           // mousedown: before the input loses focus
    const li = e.target.closest("li[data-i]");
    if (li) { e.preventDefault(); go(res[+li.dataset.i]); }
  });
  list.addEventListener("mousemove", e => {
    const li = e.target.closest("li[data-i]");
    if (li && +li.dataset.i !== sel) { sel = +li.dataset.i; list.querySelectorAll("li[data-i]").forEach(x => x.classList.toggle("on", +x.dataset.i === sel)); }
  });
  document.addEventListener("click", e => { if (!wrap.contains(e.target)) close(); });

  // "/" or Ctrl+K from anywhere opens the search (and shows the auto-hiding top bar)
  document.addEventListener("keydown", e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      document.querySelector(".topbar")?.classList.add("show");
      input.focus(); input.select();
    }
  });

  // language switch: new placeholder and result names
  document.getElementById("lang")?.addEventListener("click", () => setTimeout(() => { label(); if (!list.classList.contains("hidden")) draw(); }));
})();
