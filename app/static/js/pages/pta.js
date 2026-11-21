(function () {
  const $ = id => document.getElementById(id);
  let events = [], skipped = [], cur = null, idx = 0;
  const qs = new URLSearchParams(location.search);

  function renderEvents() {
    $("events").innerHTML = events.map(e => `<div class="ev ${e.idx === idx ? "on" : ""}" data-i="${e.idx}">
      <div style="display:flex;gap:8px;align-items:center"><span class="w">${e.well_name}</span><span class="badge ${e.quality === "A" ? "ok" : "warning"}" style="padding:1px 7px">${e.quality}</span></div>
      <div class="d">${PN.date(e.shut_in_start, true)} · ${PN.fmt(e.duration_hr, 1)} h</div></div>`).join("")
      + skipped.map(e => `<div class="ev off" data-s="${e.idx}" title="${PN.t("pta_na_" + e.code)}" style="opacity:.55">
      <div style="display:flex;gap:8px;align-items:center"><span class="w">${e.well_name}</span><span class="badge warning" style="padding:1px 7px">${PN.t("pta_na")}</span></div>
      <div class="d">${PN.date(e.shut_in_start, true)} · ${PN.fmt(e.duration_hr, 1)} h</div></div>`).join("");
    document.querySelectorAll(".ev[data-i]").forEach(el => el.onclick = () => {
      idx = +el.dataset.i; PN.setWell(events.find(e => e.idx === idx).well_name); loadEvent(); });
    document.querySelectorAll(".ev[data-s]").forEach(el => el.onclick = () => {
      const e = skipped.find(x => x.idx === +el.dataset.s); showSkipped(e); });
    $("na-msg").innerHTML = skipped.map(e => `<div>⚠ <b>${e.well_name}</b> ${PN.date(e.shut_in_start, true)}: ${PN.t("pta_na_" + e.code)}</div>`).join("");
  }

  function showSkipped(e) { PN.toast(`${e.well_name}: ${PN.t("pta_na_" + e.code)}`); }

  async function loadEvent(w0, w1) {
    try {
      cur = await PN.api(`/api/pta/${idx}`, { w0, w1 });
      renderEvents(); render();
    } catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
  }

  const P = v => `${PN.fmt(PN.cv("p", v), ["bar", "MPa", "atm"].includes(PN.ul("p")) ? 1 : 0)}`;
  function kpi(id, v, auto, d, unit = "", kind = null) {
    if (kind) { v = PN.cv(kind, v); auto = PN.cv(kind, auto); }
    PN.countUp($(id), v, d, 450);
    const diff = auto != null && Math.abs(v - auto) > 1e-6;
    $(id + "-a").innerHTML = `<span class="dim">${PN.t("auto_val")}: ${PN.fmt(auto, d)}${unit}</span>` + (diff ? ` <span class="chip flat">${PN.signed((v / auto - 1) * 100, 1)}%</span>` : "");
  }

  function render() {
    if (!cur) return;
    const r = cur.results, a = cur.auto_results, c = PN.colors;
    kpi("r-m", r.horner_slope_psi_cycle, a.horner_slope_psi_cycle, 2, "", "dp");
    $("r-m-u").textContent = `${PN.ul("dp")}/cycle`;
    kpi("r-k", r.permeability_md, a.permeability_md, 1);
    kpi("r-s", r.skin, a.skin, 2);
    kpi("r-dps", r.dp_skin_psi, a.dp_skin_psi, 1, "", "dp");
    $("mode-badge").className = "badge " + (cur.window_auto ? "accent" : "warning");
    $("mode-badge").textContent = cur.window_auto ? PN.t("automatic") : PN.t("manual");
    $("q-src").textContent = PN.t("q_src_line", { q: `${PN.fmt(PN.cv("oil", r.q_oil_vfm_stbd), 0)} ${PN.ul("oil")}`, d: cur.q_source_date });
    $("fit-note").textContent = cur.window_auto ? PN.t("fit_auto_note") : PN.t("fit_manual_note");
    $("q-badge").className = "badge " + (cur.quality === "A" ? "ok" : "warning");
    $("q-badge").textContent = `${PN.t("quality")} ${cur.quality}`;
    $("w0").value = (+r.radial_window_start_hr).toFixed(2); $("w1").value = (+r.radial_window_end_hr).toFixed(2);

    $("extra").innerHTML = [
      ["q_used", `${PN.fmt(PN.cv("oil", r.q_oil_vfm_stbd), 0)} ${PN.ul("oil")} · ${PN.t("q_date")} ${cur.q_source_date}`], ["tp", `${PN.fmt(r.tp_hr, 0)} h`],
      ["pwf", `${P(r.pwf_psia)} ${PN.ul("p")}`], ["P1hr / P*", `${P(r.p1hr_psia)} / ${P(r.p_star_gauge_psia)} ${PN.ul("p")}`],
      ["pavg", `${P(r.avg_reservoir_pressure_datum_psia)} ${PN.ul("p")}`], ["fe", PN.fmt(r.flow_efficiency, 2)],
      ["flatness", `${PN.fmt(r.derivative_flatness_cv * 100, 1)} %`], ["rinv", `${PN.fmt(PN.cv("len", r.radius_investigation_ft), 0)} ${PN.ul("len")}`],
      ["storage", `≈ ${PN.fmt(r.wellbore_storage_bbl_psi / PN.cv("dp", 1), 3)} bbl/${PN.ul("dp")}`],
    ].map(([k, v]) => `<div class="k">${PN.t(k)}</div><div class="v">${v}</div>`).join("");

    $("interp").innerHTML = cur.interpretation.map(x => `<div>${PN.t(x.key, {
      skin: x.skin != null ? PN.signed(x.skin, 1) : "", fe: x.fe != null ? PN.fmt(x.fe * 100, 0) + "%" : "",
      k: x.k != null ? PN.fmt(x.k, 0) : "", radius: x.radius != null ? `${PN.fmt(PN.cv("len", x.radius), 0)} ${PN.ul("len")}` : "?",
      p: x.p != null ? `${P(x.p)} ${PN.ul("p")}` : "" })}</div>`).join("");

    // 1 history: pressure + rate as used by the analysis
    const H = cur.history, shut = [{ start: cur.shut_in_start, end: cur.shut_in_end }];
    PN.plot($("c-hist"), [
      { x: H.t, y: PN.cva("p", H.p), name: `${PN.t("dhp")} (${PN.ul("p")})`, type: "scatter", mode: "lines", line: { color: c.dhp, width: 1.6 } },
      { x: H.rate_t, y: PN.cva("oil", H.rate_q), name: `${PN.t("oil")} VFM (${PN.ul("oil")})`, type: "scatter", mode: "lines", line: { color: c.oil, width: 2, shape: "hv" }, yaxis: "y2" },
    ], { yaxis: { title: { text: PN.ul("p") } }, yaxis2: { overlaying: "y", side: "right", showgrid: false, rangemode: "tozero", title: { text: PN.ul("oil") } },
         shapes: PN.shade(shut, "rgba(224,138,0,0.12)"), margin: { r: 60 } });

    // 2 log-log with draggable window
    const L = cur.loglog, w0 = r.radial_window_start_hr, w1 = r.radial_window_end_hr;
    PN.plot($("c-loglog"), [
      { x: L.dt, y: PN.cva("dp", L.dp), name: PN.t("dp"), type: "scatter", mode: "markers", marker: { color: c.water, size: 5 } },
      { x: L.dt, y: PN.cva("dp", L.der), name: PN.t("deriv"), type: "scatter", mode: "markers", marker: { color: c.red, size: 5 } },
    ], { xaxis: { type: "log", title: { text: "Δt, h" } }, yaxis: { type: "log", title: { text: PN.ul("dp") } }, hovermode: "closest",
         dragmode: "select", selectdirection: "h",
         shapes: [{ type: "rect", xref: "x", yref: "paper", x0: w0, x1: w1, y0: 0, y1: 1, fillcolor: "rgba(21,128,61,.09)", line: { color: "rgba(21,128,61,.5)", width: 1 } },
                  { type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: PN.cv("dp", r.horner_slope_psi_cycle) / Math.LN10, y1: PN.cv("dp", r.horner_slope_psi_cycle) / Math.LN10, line: { color: c.ok, dash: "dash", width: 1 } }] },
      { modeBarButtonsToAdd: ["select2d"] });
    $("c-loglog").removeAllListeners && $("c-loglog").removeAllListeners("plotly_selected");
    $("c-loglog").on("plotly_selected", ev => {
      if (!ev || !ev.range || !ev.range.x) return;
      // Plotly reports the selected range in data units (hours); clamp to the measured data
      const lo = L.dt[0], hi = L.dt[L.dt.length - 1];
      const [a, b] = ev.range.x.map(v => Math.min(hi, Math.max(lo, v))).sort((x, y) => x - y);
      if (!(b > a * 1.2)) { PN.toast(PN.t("loglog_hint")); return; }
      loadEvent(+a.toFixed(3), +b.toFixed(3));
    });

    // 3 Horner
    const Hn = cur.horner, inW = L.dt.map(t => t >= w0 && t <= w1);
    PN.plot($("c-horner"), [
      { x: Hn.x, y: PN.cva("p", Hn.p), name: PN.t("data_pts"), type: "scatter", mode: "markers", marker: { color: c.muted, size: 5 } },
      { x: Hn.x.filter((_, i) => inW[i]), y: PN.cva("p", Hn.p.filter((_, i) => inW[i])), name: PN.t("radial_pts"), type: "scatter", mode: "markers", marker: { color: c.ok, size: 6 } },
      { x: Hn.fit_x, y: PN.cva("p", Hn.fit_p), name: `${PN.t("fit")} · m = ${PN.fmt(PN.cv("dp", r.horner_slope_psi_cycle), 1)} ${PN.ul("dp")}`, type: "scatter", mode: "lines", line: { color: c.accent, dash: "dash", width: 2 } },
      { x: [Hn.p1hr_x], y: [PN.cv("p", r.p1hr_psia)], name: `P1hr = ${P(r.p1hr_psia)}`, type: "scatter", mode: "markers", marker: { symbol: "square", size: 11, color: c.warn } },
      { x: [0], y: [PN.cv("p", r.p_star_gauge_psia)], name: `P* = ${P(r.p_star_gauge_psia)}`, type: "scatter", mode: "markers", marker: { symbol: "star", size: 15, color: c.ink } },
    ], { xaxis: { autorange: "reversed", title: { text: "log10[(tp + Δt) / Δt]" } }, yaxis: { title: { text: PN.ul("p") } }, hovermode: "closest" });
  }

  PN.start({
    async load() {
      $("apply").onclick = () => {
        const lo = cur ? cur.loglog.dt[0] : 0.01, hi = cur ? cur.loglog.dt[cur.loglog.dt.length - 1] : 1e4;
        const a = Math.max(lo, +$("w0").value), b = Math.min(hi, +$("w1").value);
        if (!(b > a * 1.2)) { PN.toast(PN.t("loglog_hint")); return; }
        loadEvent(a, b);
      };
      $("auto").onclick = () => loadEvent();
      try {
        [events, skipped] = await Promise.all([PN.api("/api/pta/events"), PN.api("/api/pta/skipped").catch(() => [])]);
        if (!events.length) {
          renderEvents();
          $("na-msg").insertAdjacentHTML("afterbegin", `<div><b>${PN.t("pta_none")}</b></div>`);
          if (!skipped.length) $("events").innerHTML = `<span class="muted">—</span>`;
          return;
        }
        const want = qs.get("event"), wantWell = qs.get("well") || PN.state.well;
        const hit = want != null ? events.find(e => e.idx === +want) : events.find(e => e.well_name === wantWell);
        if (want != null && !hit) { const s = skipped.find(e => e.idx === +want); if (s) showSkipped(s); }
        idx = (hit || events[0]).idx;
        renderEvents(); await loadEvent();
      } catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
    },
    render,
    onWell(w) {
      const e = events.find(x => x.well_name === w);
      if (e) { idx = e.idx; loadEvent(); return; }
      const s = skipped.find(x => x.well_name === w);
      s ? showSkipped(s) : PN.toast(`${w}: ${PN.t("no_pta")}`);
    },
  });
})();
