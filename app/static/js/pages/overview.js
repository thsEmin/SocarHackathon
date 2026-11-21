(function () {
  let data = null;
  const $ = id => document.getElementById(id);

  function spark(vals, color) {
    if (!vals || vals.length < 2) return "";
    const w = 160, h = 28, mn = Math.min(...vals), mx = Math.max(...vals), r = (mx - mn) || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 3 - ((v - mn) / r) * (h - 6)}`).join(" ");
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polyline points="0,${h} ${pts} ${w},${h}" fill="${color}" fill-opacity=".10" stroke="none"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  }

  // compare the period average with the period of the same length just before it
  const vsPrev = () => `<span class="dim">${PN.t("vs_prev", { n: data.days })}</span>`;
  function delta(now, prev) {
    if (!prev) return "";
    const p = (now / prev - 1) * 100, cls = Math.abs(p) < 0.5 ? "flat" : p > 0 ? "up" : "down";
    return `<span class="chip ${cls}">${PN.signed(p, 1)}%</span> ${vsPrev()}`;
  }

  // ---- Import / Export cards: data comes in on the left, results go out on the right.
  const ICON_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>';
  const ICON_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m0 0l-4.5-4.5M12 16l4.5-4.5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>';
  function flowStrip() {
    const ds = PN.state.datasets.find(d => d.id === PN.state.ds);
    const days = ds ? Math.round((new Date(ds.end) - new Date(ds.start)) / 864e5) + 1 : "—";
    const meta = PN.t("io_in_meta", { ds: ds && ds.source === "preloaded" ? PN.t("io_ds_pre") : ds && ds.source === "sample" ? PN.dsName(ds) : PN.t("io_ds_up"), days, wells: ds ? ds.wells.length : "—" });
    const card = (href, dir, icon, title, sub, m) => `
      <a class="io-card ${dir}" href="${href}">
        <span class="io-ic">${icon}</span>
        <span class="io-txt"><span class="io-k">${sub}</span><b>${title}</b><small>${m}</small></span>
        <span class="io-go" aria-hidden="true">→</span>
      </a>`;
    return `<div class="flow-strip">
      ${card("/data", "in", ICON_UP, PN.t("b_import"), PN.t("io_in"), meta)}
      ${card("/export", "out", ICON_DOWN, PN.t("n_export"), PN.t("io_out"), PN.t("io_out_meta"))}
    </div>`;
  }

  function render() {
    if (!data) return;
    // all KPI cards = average per day over the chosen period, compared with the previous period of the same length
    // an older server sends only last-day totals: fall back to those instead of crashing
    const T = data.avg || data.totals, P = data.avg_prev || (data.avg ? {} : data.totals_prev30) || {};
    if (!data.avg) data.avg_prev = data.totals_prev30, data.days = data.days || 30;
    const none = data.avg_prev ? "" : `<span class="dim">${PN.t("no_prev")}</span>`;
    PN.countUp($("k-oil"), PN.cv("oil", T.oil_rate_stbd)); $("k-oil-f").innerHTML = delta(T.oil_rate_stbd, P.oil_rate_stbd) || none;
    PN.countUp($("k-water"), PN.cv("liq", T.water_rate_stbd)); $("k-water-f").innerHTML = delta(T.water_rate_stbd, P.water_rate_stbd) || none;
    PN.countUp($("k-gas"), PN.cv("gas", T.gas_rate_mscfd)); $("k-gas-f").innerHTML = delta(T.gas_rate_mscfd, P.gas_rate_mscfd) || none;
    const wc = T.water_rate_stbd / (T.water_rate_stbd + T.oil_rate_stbd) * 100;
    PN.countUp($("k-wc"), wc, 1);
    if (data.avg_prev) {
      const wcp = P.water_rate_stbd / (P.water_rate_stbd + P.oil_rate_stbd) * 100;
      $("k-wc-f").innerHTML = `<span class="chip ${wc > wcp ? "down" : "up"}">${PN.signed(wc - wcp, 1)} pt</span> ${vsPrev()}`;
    } else $("k-wc-f").innerHTML = none;
    const online = data.wells.filter(w => (w.produced != null ? w.produced : w.oil > 0)).length;
    $("k-online").textContent = `${online} / ${data.wells.length}`;
    $("k-online-f").innerHTML = `<span class="dim">${PN.t("online_period")}</span>`;
    const cum = PN.cv("oil", data.period_cum_oil) / 1000;
    PN.countUp($("k-cum"), cum, cum < 10 ? 1 : 0);          // short periods: 1.7 rather than 2
    $("k-cum-u").textContent = `10³ ${PN.vl("oil")}`;
    $("k-cum-f").innerHTML = `${PN.t("fastest_decline")}: <b>${data.fastest_decline.well}</b> <span class="mono">${PN.signed(data.fastest_decline.pct_yr, 0)}%</span> ${PN.t("per_year")}`;

    // schematic
    const byM = {};
    data.wells.forEach(w => (byM[w.manifold] = byM[w.manifold] || []).push(w));
    $("schematic").innerHTML = Object.keys(byM).sort().map(m => `
      <div class="mf">
        <div class="mf-label">${PN.t("manifold")} ${m}<span class="dim mono">· ${PN.fmt(PN.cv("oil", byM[m].reduce((a, w) => a + (w.avg_oil != null ? w.avg_oil : w.oil), 0)))} ${PN.t("stbd_oil")}</span></div>
        <div class="tiles">${byM[m].map(w => `
          <div class="tile ${w.status}" data-well="${w.well}" title="${w.well}">
            <div class="top"><span class="dot ${w.status}"></span><span class="name">${w.well}</span>
              <span class="skin" title="${w.skin != null ? "" : PN.t("no_pta")}">S ${w.skin != null ? PN.signed(w.skin, 1) : "—"}</span></div>
            <div class="oil">${PN.fmt(PN.cv("oil", w.avg_oil != null ? w.avg_oil : w.oil))}<small>${PN.t("stbd_oil")}</small></div>
            <div class="meta"><span style="color:var(--water)">WC ${(w.avg_wc != null ? w.avg_wc : w.wc) != null ? PN.fmt(w.avg_wc != null ? w.avg_wc : w.wc, 0) : "—"}%</span><span style="color:var(--gas)">${PN.fmt(PN.cv("gas", w.avg_gas != null ? w.avg_gas : w.gas))} ${PN.ul("gas")}</span></div>
            ${spark(w.spark, PN.colors.oil)}
          </div>`).join("")}</div>
      </div>`).join("") + flowStrip();
    document.querySelectorAll(".tile").forEach(el => el.onclick = () => { PN.setWell(el.dataset.well); location.href = "/well"; });

    // alerts
    const icon = { alarm: "alert", warning: "alert", info: "info" };
    $("alerts").innerHTML = data.alerts.map((a, i) => {
      let title = "", sub = "";
      const p = a.key.startsWith("pb_") ? PN.issueParams(a)
        : Object.assign({}, a, { skin: a.skin != null ? PN.signed(a.skin, 1) : "", pct: a.min_change_pct != null ? PN.fmt(a.min_change_pct, 0) : "" });
      title = PN.t(a.key, p);
      if (a.key === "ev_liftgas") sub = `${PN.date(a.start, true)} → ${PN.time(a.end)}`;
      else if (a.key === "ev_shutin") sub = PN.date(a.start, true);
      return `<div class="alert ${a.level}" data-i="${i}">${PN.icon(icon[a.level])}<div><div class="t1">${a.well ? `<span class="mono">${a.well}</span> · ` : ""}${title}</div>${sub ? `<div class="t2">${sub}</div>` : ""}</div></div>`;
    }).join("");
    // live count on the header button: active = alarm + warning (info items are insights)
    const nA = data.alerts.filter(x => x.level === "alarm").length, nW = data.alerts.filter(x => x.level === "warning").length;
    const cnt = $("alerts-count");
    cnt.textContent = nA + nW;
    cnt.className = "ab-count" + (nA ? " alarm" : nW ? " warning" : "");
    $("alerts-open").title = `${nA} alarm · ${nW} warning · ${data.alerts.length - nA - nW} info`;
    document.querySelectorAll(".alert").forEach(el => el.onclick = () => {
      const a = data.alerts[+el.dataset.i];
      if (a.well) PN.setWell(a.well);
      location.href = a.key.startsWith("pb_") ? "/problems" : a.key === "ev_shutin" ? "/pta" : a.key === "ev_liftgas" ? "/sensors" : a.well ? "/well" : "/data";
    });

    // field chart
    // three stacked panels (oil, water, gas), each scaled to its own data so small changes are visible
    const s = data.field_series, c = PN.colors;
    // short periods come as hourly points (a 1-day period would otherwise be a single dot)
    const sub = $("field-sub"), key = s.hourly ? "field_prod_sub_h" : "field_prod_sub";
    sub.dataset.i18n = key; sub.textContent = PN.t(key);
    const rows = [
      ["oil", PN.cva("oil", s.oil_rate_stbd), PN.ul("oil"), c.oil],
      ["water", PN.cva("liq", s.water_rate_stbd), PN.ul("liq"), c.water],
      ["gas", PN.cva("gas", s.gas_rate_mscfd), PN.ul("gas"), c.gas],
    ];
    const gap = 0.07, h = (1 - 2 * gap) / 3, many = s.t.length > 60;
    const traces = [], layout = { showlegend: false, hovermode: "x unified", margin: { l: 70, r: 20, t: 26, b: 40 }, annotations: [] };
    rows.forEach(([key, y, unit, col], i) => {
      const ax = i ? String(i + 1) : "", top = 1 - i * (h + gap);
      const v = y.filter(x => x != null && isFinite(x)), lo = Math.min(...v), hi = Math.max(...v);
      const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.005, 1e-6);
      const first = v[0], last = v[v.length - 1], pct = first ? (last / first - 1) * 100 : 0;
      traces.push({ x: s.t, y, name: PN.t(key), type: "scatter", mode: many ? "lines" : "lines+markers",
        line: { color: col, width: 2.2 }, marker: { size: 6, color: col }, xaxis: "x", yaxis: "y" + ax,
        hovertemplate: `%{y:,.0f} ${unit}<extra>${PN.t(key)}</extra>` });
      layout["yaxis" + ax] = { domain: [top - h, top], range: [lo - pad, hi + pad], title: { text: unit }, tickformat: ",.0f", nticks: 4 };
      layout.annotations.push({ xref: "paper", yref: "paper", x: 0, y: top, xanchor: "left", yanchor: "bottom", showarrow: false,
        text: `<b>${PN.t(key)}</b>  ${PN.fmt(last, 0)} ${unit}` + (v.length > 1 ? `  <span style="color:${pct < 0 ? c.red : c.ok}">${PN.signed(pct, 1)}%</span>` : ""),
        font: { size: 12 } });
    });
    layout.xaxis = { anchor: "y3" };
    PN.plot($("field-chart"), traces, layout);
  }

  // ---- period (date range): like VFM. The server clamps the dates to the dataset and returns the
  //      period it used (data.range), so the inputs always show what the numbers are for.
  let r0 = null, r1 = null, dsId = null, req = 0;
  const addDays = (iso, n) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const KEY = "pn.overview.range";
  try { const saved = JSON.parse(sessionStorage.getItem(KEY) || "null"); if (saved) { r0 = saved.r0; r1 = saved.r1; dsId = saved.ds; } } catch (e) { /* no storage */ }

  function showRange() {
    const R = data.range;
    $("r-from").value = R.start; $("r-to").value = R.end;
    $("r-from").min = $("r-to").min = R.first; $("r-from").max = $("r-to").max = R.last;
    const total = Math.round((new Date(R.last) - new Date(R.first)) / 864e5) + 1;   // days the data covers
    document.querySelectorAll("#r-quick button").forEach(b => {
      const n = +b.dataset.days;
      b.disabled = n > total;                     // e.g. 1 day of data: only 1d and "All" can be clicked
      b.title = b.disabled ? PN.t("rng_short") : "";
      b.classList.toggle("on", n ? (R.end === R.last && R.start === addDays(R.last, -n + 1)) : (R.start === R.first && R.end === R.last));
    });
  }
  function setRange(a, b) {
    r0 = a || null; r1 = b || null;
    try { sessionStorage.setItem(KEY, JSON.stringify({ r0, r1, ds: PN.state.ds })); } catch (e) { /* no storage */ }
    load();
  }
  $("r-from").onchange = () => setRange($("r-from").value, $("r-to").value);
  $("r-to").onchange = () => setRange($("r-from").value, $("r-to").value);
  document.querySelectorAll("#r-quick button").forEach(b => b.onclick = () => {
    if (b.disabled || !data) return;              // not loaded yet: the dates are not known
    const n = +b.dataset.days, last = data ? data.range.last : null;
    n && last ? setRange(addDays(last, -n + 1), last) : setRange(null, null);
  });

  async function load() {
    if (dsId !== PN.state.ds) { r0 = r1 = null; dsId = PN.state.ds; }   // new dataset: start from its full period
    const my = ++req;
    try {
      const d = await PN.api("/api/overview", { start: r0, end: r1 });
      if (my !== req) return;                                            // a newer request is on its way
      data = d; showRange(); render();
    } catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
  }

  // ---- Alerts & insights drawer: opens from the header button; closes with ×, backdrop click or Esc
  const drawer = $("alerts-drawer"), backdrop = $("alerts-backdrop"), openBtn = $("alerts-open");
  let closeTimer = 0;
  function openDrawer() {
    clearTimeout(closeTimer);
    backdrop.hidden = false; drawer.inert = false;
    drawer.setAttribute("aria-hidden", "false"); openBtn.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => { backdrop.classList.add("open"); drawer.classList.add("open"); });
    setTimeout(() => $("alerts-close").focus({ preventScroll: true }), 60);
  }
  function closeDrawer() {
    if (!drawer.classList.contains("open")) return;
    backdrop.classList.remove("open"); drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true"); openBtn.setAttribute("aria-expanded", "false");
    closeTimer = setTimeout(() => { backdrop.hidden = true; drawer.inert = true; }, 300);   // after the slide-out
    openBtn.focus({ preventScroll: true });
  }
  openBtn.onclick = openDrawer;
  $("alerts-close").onclick = closeDrawer;
  backdrop.onclick = closeDrawer;
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

  PN.start({ load, render });
})();
