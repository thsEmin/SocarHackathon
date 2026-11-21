(function () {
  let d = null, hd = null, r0 = null, r1 = null;
  const $ = id => document.getElementById(id);
  const T = ["oil_rate_stbd", "water_rate_stbd", "gas_rate_mscfd"];
  const NAMES = { oil_rate_stbd: "oil", water_rate_stbd: "water", gas_rate_mscfd: "gas" };
  const KIND = { oil_rate_stbd: "oil", water_rate_stbd: "liq", gas_rate_mscfd: "gas" };
  const addDays = (iso, n) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

  // ---- period (date range) controls
  function setRange(a, b) {
    const first = d.t[0], last = d.t[d.t.length - 1];
    r0 = a && a >= first ? a : first; r1 = b && b <= last ? b : last;
    if (r0 > r1) [r0, r1] = [r1, r0];
    $("r-from").value = r0; $("r-to").value = r1;
    document.querySelectorAll("#r-quick button").forEach(x => {
      const n = +x.dataset.days;
      x.classList.toggle("on", n ? (r1 === last && r0 === addDays(last, -n + 1)) : (r0 === first && r1 === last));
    });
  }

  function render() {
    if (!d) return;
    const c = PN.colors;
    $("v-title").textContent = `${d.well} · ${PN.t("vfm_chart")}`;

    // totals over the selected period (volumes = sum of daily rates x 1 day)
    const idx = d.t.map((t, i) => (t >= r0 && t <= r1 ? i : -1)).filter(i => i >= 0);
    const sum = k => idx.reduce((a, i) => a + (d[k][i] || 0), 0);
    [["oil", "oil_rate_stbd"], ["water", "water_rate_stbd"], ["gas", "gas_rate_mscfd"]].forEach(([n, k]) => {
      PN.countUp($(`t-${n}`), PN.cv(KIND[k], sum(k)) / 1000, 1);
      $(`t-${n}-u`).textContent = `10³ ${PN.vl(KIND[k])}`;
      $(`t-${n}-f`).innerHTML = `<span class="dim">${PN.date(r0)} → ${PN.date(r1)} · ${idx.length} d</span>`;
    });
    PN.countUp($("lam"), d.diag.lambda, 2);

    const colour = { oil_rate_stbd: c.oil, water_rate_stbd: c.water, gas_rate_mscfd: c.gas };
    const traces = [];
    T.forEach(k => {
      const ax = k === "gas_rate_mscfd" ? "y2" : "y";
      traces.push({ x: d.t, y: PN.cva(KIND[k], d[k]), name: `${PN.t(NAMES[k])}`, type: "scatter", mode: "lines", line: { color: colour[k], width: 2 }, yaxis: ax,
                    hovertemplate: "%{y:,.0f}" });
      traces.push({ x: d.tests.t, y: PN.cva(KIND[k], d.tests[k]), name: `${PN.t(NAMES[k])} · test`, type: "scatter", mode: "markers", yaxis: ax, showlegend: false,
                    marker: { size: 10, color: "#FFFFFF", line: { color: colour[k], width: 2.5 } }, hovertemplate: "test %{y:,.0f}" });
    });
    const shut = []; d.flags.forEach((f, i) => { if (f === "shut" || f === "partial") shut.push({ start: d.t[i], end: d.t[i + 1] || d.t[i] }); });
    const el = $("vfm-chart");
    PN.plot(el, traces, {
      xaxis: { range: [r0, addDays(r1, 1)] },
      yaxis: { title: { text: PN.ul("oil") === PN.ul("liq") ? `${PN.t("oil")} / ${PN.t("water")}, ${PN.ul("liq")}` : `${PN.t("oil")}, ${PN.ul("oil")} / ${PN.t("water")}, ${PN.ul("liq")}` }, rangemode: "tozero" },
      yaxis2: { title: { text: `${PN.t("gas")}, ${PN.ul("gas")}` }, overlaying: "y", side: "right", showgrid: false, rangemode: "tozero" },
      shapes: [...PN.shade(shut, "rgba(224,138,0,0.12)"), ...PN.shade([{ start: hd ? hd.date : null, end: hd ? addDays(hd.date, 1) : null }].filter(s => s.start), "rgba(0,119,200,0.10)")],
      margin: { r: 70 },
    });
    if (!el._pnClick) {   // click a day -> hourly view of that day
      el._pnClick = true;
      el.on("plotly_click", ev => { const x = ev.points && ev.points[0] && String(ev.points[0].x).slice(0, 10); if (x) loadHourly(x); });
    }

    renderHourly();
  }

  // ---- hourly view of one day
  function renderHourly() {
    if (!hd) return;
    const c = PN.colors;
    const colour = { oil_rate_stbd: c.oil, water_rate_stbd: c.water, gas_rate_mscfd: c.gas };
    const shut = hd.t.map((t, i) => (hd.shut_frac[i] >= 0.5 ? { start: t, end: hd.t[i + 1] || addDays(hd.date, 1) } : null)).filter(Boolean);
    // separate axis scales so the gas line never sits on top of the oil line
    const mx = a => Math.max(1, ...a.filter(v => v != null && isFinite(v)));
    const liqMax = mx([...PN.cva("oil", hd.oil_rate_stbd), ...PN.cva("liq", hd.water_rate_stbd)]) * 1.15;
    const gasMax = mx(PN.cva("gas", hd.gas_rate_mscfd)) * 1.9;
    PN.plot($("hourly-chart"), [
      ...T.map(k => ({ x: hd.t, y: PN.cva(KIND[k], hd[k]), name: PN.t(NAMES[k]), type: "scatter", mode: "lines+markers", line: { color: colour[k], width: 2, shape: "hvh" },
                       marker: { size: 5 }, yaxis: k === "gas_rate_mscfd" ? "y2" : "y", hovertemplate: "%{y:,.0f}" })),
      { x: hd.t, y: hd.choke_opening_pct, name: `${PN.t("choke")} (%)`, type: "scatter", mode: "lines", line: { color: c.choke, width: 1.2, dash: "dot", shape: "hv" },
        yaxis: "y3", hovertemplate: "%{y:.1f}%" },
    ], {
      xaxis: { tickformat: "%H:%M" },
      yaxis: { title: { text: PN.ul("oil") === PN.ul("liq") ? `${PN.t("oil")} / ${PN.t("water")}, ${PN.ul("liq")}` : `${PN.t("oil")}, ${PN.ul("oil")} / ${PN.t("water")}, ${PN.ul("liq")}` }, range: [0, liqMax] },
      yaxis2: { title: { text: `${PN.t("gas")}, ${PN.ul("gas")}` }, overlaying: "y", side: "right", showgrid: false, range: [0, gasMax] },
      yaxis3: { overlaying: "y", side: "right", showgrid: false, visible: false, range: [0, 100] },
      shapes: PN.shade(shut, "rgba(224,138,0,0.14)"), margin: { r: 70 },
    });
    $("hourly-kv").innerHTML = `<div class="k">${d.well} · ${PN.date(hd.date)} · ${PN.t("hr_daily")}</div><div class="v">`
      + T.map(k => `${PN.t(NAMES[k])} ${PN.fmt(PN.cv(KIND[k], hd.daily[k]), 0)} ${PN.ul(KIND[k])}`).join(" · ")
      + (shut.length ? ` · ${shut.length} h ${PN.t("hr_shut")}` : "") + `</div>`;
  }

  async function loadHourly(day) {
    if (!d || !day) return;
    $("h-day").value = day;
    try { hd = await PN.api("/api/vfm/hourly", { well: d.well, date: day }); render(); }
    catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
  }

  function wire() {
    $("r-from").onchange = () => { setRange($("r-from").value, $("r-to").value); render(); };
    $("r-to").onchange = () => { setRange($("r-from").value, $("r-to").value); render(); };
    document.querySelectorAll("#r-quick button").forEach(b => { b.onclick = () => {
      const n = +b.dataset.days, last = d.t[d.t.length - 1];
      setRange(n ? addDays(last, -n + 1) : d.t[0], last); render();
    }; });
    $("h-day").onchange = () => loadHourly($("h-day").value);
  }

  async function load() {
    try {
      const keep = d && hd ? hd.date : null;
      d = await PN.api("/api/vfm", { well: PN.state.well });
      $("r-from").min = $("r-to").min = $("h-day").min = d.t[0];
      $("r-from").max = $("r-to").max = $("h-day").max = d.t[d.t.length - 1];
      setRange(r0, r1);
      hd = null;
      await loadHourly(keep || d.t[d.t.length - 1]);
    } catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
  }
  wire();
  PN.start({ load, render, onWell: load });
})();
