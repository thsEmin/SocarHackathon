(function () {
  let d = null;
  const $ = id => document.getElementById(id);
  const T = ["oil_rate_stbd", "water_rate_stbd", "gas_rate_mscfd"];
  const NAMES = { oil_rate_stbd: "oil", water_rate_stbd: "water", gas_rate_mscfd: "gas" };

  function render() {
    if (!d) return;
    const c = PN.colors;
    $("v-title").textContent = `${d.well} · ${PN.t("vfm_chart")}`;
    PN.countUp($("t-oil"), d.period.oil_rate_stbd / 1000, 1);
    PN.countUp($("t-water"), d.period.water_rate_stbd / 1000, 1);
    PN.countUp($("t-gas"), d.period.gas_rate_mscfd / 1000, 1);
    ["oil", "water", "gas"].forEach(k => $(`t-${k}-f`).innerHTML = `<span class="dim">${d.t[0]} → ${d.t[d.t.length - 1]}</span>`);
    PN.countUp($("lam"), d.diag.lambda, 2);

    const colour = { oil_rate_stbd: c.oil, water_rate_stbd: c.water, gas_rate_mscfd: c.gas };
    const traces = [];
    T.forEach(k => {
      const ax = k === "gas_rate_mscfd" ? "y2" : "y";
      traces.push({ x: d.t, y: d[k], name: `${PN.t(NAMES[k])}`, type: "scatter", mode: "lines", line: { color: colour[k], width: 2 }, yaxis: ax,
                    hovertemplate: "%{y:,.0f}" });
      traces.push({ x: d.tests.t, y: d.tests[k], name: `${PN.t(NAMES[k])} · test`, type: "scatter", mode: "markers", yaxis: ax, showlegend: false,
                    marker: { size: 10, color: "#FFFFFF", line: { color: colour[k], width: 2.5 } }, hovertemplate: "test %{y:,.0f}" });
    });
    const shut = []; d.flags.forEach((f, i) => { if (f === "shut" || f === "partial") shut.push({ start: d.t[i], end: d.t[i + 1] || d.t[i] }); });
    PN.plot($("vfm-chart"), traces, {
      yaxis: { title: { text: `${PN.t("oil")} / ${PN.t("water")}, ${PN.t("stbd")}` }, rangemode: "tozero" },
      yaxis2: { title: { text: `${PN.t("gas")}, ${PN.t("mscfd")}` }, overlaying: "y", side: "right", showgrid: false, rangemode: "tozero" },
      shapes: PN.shade(shut, "rgba(224,138,0,0.12)"), margin: { r: 70 },
    });

    // validation table
    const rows = d.validation;
    $("val-table").innerHTML = `<tr><th>${PN.t("split")}</th><th>${PN.t("model")}</th><th class="n">${PN.t("oil")}</th><th class="n">${PN.t("water")}</th><th class="n">${PN.t("gas")}</th></tr>`
      + rows.map(r => `<tr class="${r.model.includes("FINAL") ? "hl" : ""}"><td class="dim">${r.split.slice(0, 1)}</td><td>${r.model.replace("(FINAL)", "★")}</td>
        <td class="n">${PN.fmt(r.oil_rate_stbd, 2)}</td><td class="n">${PN.fmt(r.water_rate_stbd, 2)}</td><td class="n">${PN.fmt(r.gas_rate_mscfd, 2)}</td></tr>`).join("")
      + `<tr><td colspan="5" class="dim" style="font-size:12px">A = leave-one-test-out · B = forward (last 2 tests hidden)</td></tr>`;

    // physics: lift-cut response v1 vs v2
    const wells = Object.keys(d.diag.liftcut_v2).sort();
    PN.plot($("liftcut-chart"), [
      { x: wells, y: wells.map(w => d.diag.liftcut_v1[w]), name: PN.t("v1"), type: "bar", marker: { color: c.muted } },
      { x: wells, y: wells.map(w => d.diag.liftcut_v2[w]), name: PN.t("v2"), type: "bar", marker: { color: c.accent } },
    ], { barmode: "group", yaxis: { title: { text: "%" }, zeroline: true, zerolinecolor: c.line }, margin: { t: 30, b: 30 }, hovermode: "x" });
    $("normal-kv").innerHTML = `<div class="k">${PN.t("liftcut_note")}</div><div class="v"></div>
      <div class="k">${PN.t("normal_vs_test")} · ${PN.t("v1")}</div><div class="v">${PN.signed(d.diag.normal_v1, 2)} %</div>
      <div class="k">${PN.t("normal_vs_test")} · ${PN.t("v2")}</div><div class="v" style="color:var(--accent-ink)">${PN.signed(d.diag.normal_v2, 2)} %</div>
      <div class="k dim">${PN.t("normal_note")}</div><div class="v"></div>`;
  }

  async function load() {
    try { d = await PN.api("/api/vfm", { well: PN.state.well }); render(); }
    catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
  }
  PN.start({ load, render, onWell: load });
})();
