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

  function delta(now, prev) {
    if (!prev) return "";
    const p = (now / prev - 1) * 100, cls = Math.abs(p) < 0.5 ? "flat" : p > 0 ? "up" : "down";
    return `<span class="chip ${cls}">${PN.signed(p, 1)}%</span> <span class="dim">${PN.t("vs30")}</span>`;
  }

  function render() {
    if (!data) return;
    const T = data.totals, P = data.totals_prev30;
    PN.countUp($("k-oil"), T.oil_rate_stbd); $("k-oil-f").innerHTML = delta(T.oil_rate_stbd, P.oil_rate_stbd);
    PN.countUp($("k-water"), T.water_rate_stbd); $("k-water-f").innerHTML = delta(T.water_rate_stbd, P.water_rate_stbd);
    PN.countUp($("k-gas"), T.gas_rate_mscfd); $("k-gas-f").innerHTML = delta(T.gas_rate_mscfd, P.gas_rate_mscfd);
    const wc = T.water_rate_stbd / (T.water_rate_stbd + T.oil_rate_stbd) * 100;
    const wcp = P.water_rate_stbd / (P.water_rate_stbd + P.oil_rate_stbd) * 100;
    PN.countUp($("k-wc"), wc, 1);
    $("k-wc-f").innerHTML = `<span class="chip ${wc > wcp ? "down" : "up"}">${PN.signed(wc - wcp, 1)} pt</span> <span class="dim">${PN.t("vs30")}</span>`;
    const online = data.wells.filter(w => w.oil > 0).length;
    $("k-online").textContent = `${online} / ${data.wells.length}`;
    $("k-online-f").innerHTML = `<span class="dim">${PN.date(data.date)}</span>`;
    PN.countUp($("k-cum"), data.period_cum_oil / 1000, 0);
    $("k-cum-f").innerHTML = `${PN.t("fastest_decline")}: <b>${data.fastest_decline.well}</b> <span class="mono">${PN.signed(data.fastest_decline.pct_yr, 0)}%</span> ${PN.t("per_year")}`;

    // schematic
    const byM = {};
    data.wells.forEach(w => (byM[w.manifold] = byM[w.manifold] || []).push(w));
    $("schematic").innerHTML = Object.keys(byM).sort().map(m => `
      <div class="mf">
        <div class="mf-label">${PN.t("manifold")} ${m}<span class="dim mono">· ${PN.fmt(byM[m].reduce((a, w) => a + w.oil, 0))} ${PN.t("stbd")}</span></div>
        <div class="tiles">${byM[m].map(w => `
          <div class="tile ${w.status}" data-well="${w.well}" title="${w.well}">
            <div class="top"><span class="dot ${w.status}"></span><span class="name">${w.well}</span>
              <span class="skin" title="${w.skin != null ? "" : PN.t("no_pta")}">S ${w.skin != null ? PN.signed(w.skin, 1) : "—"}</span></div>
            <div class="oil">${PN.fmt(w.oil)}<small>${PN.t("stbd")}</small></div>
            <div class="meta"><span style="color:var(--water)">WC ${PN.fmt(w.wc, 0)}%</span><span style="color:var(--gas)">${PN.fmt(w.gas)} Mscf</span></div>
            ${spark(w.spark, PN.colors.oil)}
          </div>`).join("")}</div>
        <div class="pipe"></div>
      </div>`).join("") + `<div class="sink"><span class="dim">→</span><span class="box">${PN.t("separator")}</span></div>`;
    document.querySelectorAll(".tile").forEach(el => el.onclick = () => { PN.setWell(el.dataset.well); location.href = "/well"; });

    // alerts
    const icon = { alarm: "alert", warning: "alert", info: "info" };
    $("alerts").innerHTML = data.alerts.map((a, i) => {
      let title = "", sub = "";
      const p = Object.assign({}, a, { skin: a.skin != null ? PN.signed(a.skin, 1) : "", pct: a.min_change_pct != null ? PN.fmt(a.min_change_pct, 0) : "" });
      title = PN.t(a.key, p);
      if (a.key === "ev_liftgas") sub = `${PN.date(a.start, true)} → ${PN.time(a.end)}`;
      else if (a.key === "ev_shutin") sub = PN.date(a.start, true);
      return `<div class="alert ${a.level}" data-i="${i}">${PN.icon(icon[a.level])}<div><div class="t1">${a.well ? `<span class="mono">${a.well}</span> · ` : ""}${title}</div>${sub ? `<div class="t2">${sub}</div>` : ""}</div></div>`;
    }).join("");
    document.querySelectorAll(".alert").forEach(el => el.onclick = () => {
      const a = data.alerts[+el.dataset.i];
      if (a.well) PN.setWell(a.well);
      location.href = a.key === "ev_shutin" ? "/pta" : a.key === "ev_liftgas" ? "/sensors" : a.well ? "/well" : "/data";
    });

    // field chart
    const s = data.field_series, c = PN.colors;
    PN.plot($("field-chart"), [
      { x: s.t, y: s.oil_rate_stbd, name: `${PN.t("oil")} (${PN.t("stbd")})`, type: "scatter", mode: "lines", line: { color: c.oil, width: 2 }, fill: "tozeroy", fillcolor: "rgba(63,138,36,.08)" },
      { x: s.t, y: s.water_rate_stbd, name: `${PN.t("water")} (${PN.t("stbd")})`, type: "scatter", mode: "lines", line: { color: c.water, width: 2 } },
      { x: s.t, y: s.gas_rate_mscfd, name: `${PN.t("gas")} (${PN.t("mscfd")})`, type: "scatter", mode: "lines", line: { color: c.gas, width: 2 }, yaxis: "y2" },
    ], { yaxis: { title: { text: PN.t("stbd") }, rangemode: "tozero" },
         yaxis2: { title: { text: PN.t("mscfd") }, overlaying: "y", side: "right", showgrid: false, rangemode: "tozero" }, margin: { r: 64 } });
  }

  PN.start({
    async load() {
      try { data = await PN.api("/api/overview"); render(); }
      catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
    },
    render,
  });
})();
