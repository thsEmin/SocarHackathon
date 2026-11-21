(function () {
  const $ = id => document.getElementById(id);
  let d = null, when = "all", wellF = "";
  const CAUSES = ["damage", "downtime", "choke", "liftgas"];
  const CC = { damage: "#D7263D", downtime: "#5F6F84", choke: "#F2A900", liftgas: "#0FA3B1" };
  const SEV = { alarm: 0, warning: 1, watch: 2, info: 3 };
  const WHEN = { now: 0, future: 1, past: 2 };

  const store = { get(k, v) { try { return localStorage.getItem("pn_" + k) || v; } catch (e) { return v; } },
                  set(k, v) { try { localStorage.setItem("pn_" + k, v); } catch (e) { /* private mode */ } } };
  const price = () => ({ oil: Math.max(0, +$("price-oil").value || 0), gas: Math.max(0, +$("price-gas").value || 0) });
  const usd = (oil, gas) => { const p = price(); return (oil || 0) * p.oil + (gas || 0) * p.gas; };

  function render() {
    if (!d) return;
    const P = price(), c = PN.colors;

    // ---- KPIs
    const total = d.loss_daily.reduce((a, r) => a + usd(r.oil_stb, r.gas_mscf), 0);
    const totOil = d.loss_daily.reduce((a, r) => a + r.oil_stb, 0);
    PN.countUp($("k-total"), total, 0);
    $("k-total-f").innerHTML = `<span class="mono">${PN.fmt(PN.cv("oil", totOil), 0)} ${PN.vl("oil")}</span> <span class="dim">${PN.t("pb_oil_lost")} · ${PN.date(d.period.start)} → ${PN.date(d.period.end)}</span>`;
    const now = d.issues.filter(i => i.when === "now");
    const perDay = now.reduce((a, i) => a + i.loss_oil_stbd_now * (P.oil + (i.gor || 0) * P.gas), 0);
    PN.countUp($("k-now"), perDay, 0);
    $("k-now-f").innerHTML = `<span class="dim">${PN.t("pb_now_foot", { y: PN.usdShort(perDay * 365) })}</span>`;
    const bad = [...new Set(now.filter(i => i.severity === "alarm" || i.severity === "warning").map(i => i.well).filter(Boolean))].sort();
    $("k-wells").textContent = `${bad.length} / ${d.wells.length}`;
    $("k-wells-f").innerHTML = bad.length ? `<span class="mono">${bad.join(", ")}</span>` : `<span class="dim">${PN.t("pb_none")}</span>`;
    const byCause = {}; CAUSES.forEach(k => { byCause[k] = 0; });
    d.loss_daily.forEach(r => { byCause[r.cause] = (byCause[r.cause] || 0) + usd(r.oil_stb, r.gas_mscf); });
    const top = Object.entries(byCause).sort((a, b) => b[1] - a[1])[0];
    $("k-cause").textContent = top && top[1] > 0 ? PN.t("cause_" + top[0]) : "—";
    $("k-cause-f").innerHTML = top && total > 0 ? `<span class="mono">${PN.usdShort(top[1])}</span> <span class="dim">· ${PN.fmt(top[1] / total * 100, 0)}% ${PN.t("pb_of_total")}</span>` : "";

    // ---- loss per well, stacked by cause
    const wells = d.wells;
    PN.plot($("pb-well-chart"), CAUSES.map(k => ({
      type: "bar", name: PN.t("cause_" + k), x: wells, marker: { color: CC[k] },
      y: wells.map(w => d.loss_by_well.filter(r => r.well === w && r.cause === k).reduce((a, r) => a + usd(r.oil_stb, r.gas_mscf), 0)),
      hovertemplate: "$%{y:,.0f}",
    })), { barmode: "stack", yaxis: { title: { text: "US $" }, tickprefix: "$", rangemode: "tozero" }, margin: { t: 30 } });

    // ---- donut by cause
    const ck = CAUSES.filter(k => byCause[k] > 0);
    PN.plot($("pb-cause-chart"), [{
      type: "pie", hole: 0.62, labels: ck.map(k => PN.t("cause_" + k)), values: ck.map(k => byCause[k]),
      marker: { colors: ck.map(k => CC[k]), line: { color: "#fff", width: 2 } }, sort: false,
      textinfo: "percent", hovertemplate: "%{label}<br>$%{value:,.0f}<extra></extra>",
    }], { showlegend: true, legend: { orientation: "h", y: -0.05 }, hovermode: "closest", margin: { t: 10, b: 10, l: 10, r: 10 },
          annotations: [{ text: `<b>${PN.usdShort(total)}</b>`, showarrow: false, font: { size: 20, color: c.ink } }] });

    // ---- cumulative loss over time, stacked by cause
    const dates = [...new Set(d.loss_daily.map(r => r.date))].sort();
    PN.plot($("pb-cum-chart"), ck.map(k => {
      let run = 0; const m = {};
      d.loss_daily.filter(r => r.cause === k).forEach(r => { m[r.date] = (m[r.date] || 0) + usd(r.oil_stb, r.gas_mscf); });
      return { type: "scatter", mode: "lines", stackgroup: "one", name: PN.t("cause_" + k), x: dates,
               y: dates.map(t => (run += (m[t] || 0))), line: { color: CC[k], width: 1.5 }, hovertemplate: "$%{y:,.0f}" };
    }), { yaxis: { title: { text: "US $" }, tickprefix: "$", rangemode: "tozero" }, margin: { t: 30 } });

    // ---- issue cards
    $("pb-well").innerHTML = `<option value="">${PN.t("pb_all_wells")}</option>` + wells.map(w => `<option ${w === wellF ? "selected" : ""}>${w}</option>`).join("");
    const list = d.issues.filter(i => (when === "all" || i.when === when) && (!wellF || i.well === wellF || !i.well));
    $("pb-issues").innerHTML = list.length ? list.map(card).join("") : `<div class="empty">${PN.t("pb_empty")}</div>`;
  }

  function card(i) {
    const P = price(), p = PN.issueParams(i.evidence), k = `pb_${i.type}`;
    const lost = usd(i.loss_oil_stb, i.loss_gas_mscf);
    const daily = i.loss_oil_stbd_now * (P.oil + (i.gor || 0) * P.gas);
    const money = i.when === "now" && daily > 0 ? `${PN.usdShort(daily)}${PN.t("pb_per_day")}` : lost > 0 ? PN.usdShort(lost) : "";
    const span = i.start ? (i.end && i.end !== i.start ? `${PN.date(i.start)} → ${PN.date(i.end)}`
                                                        : `${PN.t(i.when === "future" ? "pb_by" : "pb_since")} ${PN.date(i.start)}`) : "";
    const lostTxt = lost > 0 ? ` · ${PN.t("pb_lost_so_far")} ${PN.fmt(PN.cv("oil", i.loss_oil_stb), 0)} ${PN.vl("oil")} = ${PN.usdShort(lost)}` : "";
    return `<div class="issue ${i.severity}">
      <div class="top"><span class="badge ${i.severity}">${PN.t("sev_" + i.severity)}</span><span class="when">${PN.t("pb_" + i.when)}</span>
        <span class="well">${i.well || PN.t("pb_field")}</span>${money ? `<span class="money">−${money}</span>` : ""}</div>
      <div class="title">${PN.t(k + "_t", p)}</div>
      <div class="rc"><div class="k">${PN.t("pb_cause")}</div><div class="v">${PN.t(k + "_c", p)}</div>
        <div class="k">${PN.t("pb_fix")}</div><div class="v fix">${PN.t(k + "_f", p)}</div></div>
      ${span || lostTxt ? `<div class="dates">${span}${lostTxt}</div>` : ""}
    </div>`;
  }

  async function exportX() {
    const btn = $("pb-export"), label = btn.innerHTML, P = price();
    btn.disabled = true; btn.innerHTML = `<span>${PN.t("preparing")}</span>`;
    try {
      const r = await fetch(`/api/export/problems?ds=${encodeURIComponent(PN.state.ds)}&oil_price=${P.oil}&gas_price=${P.gas}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      const blob = await r.blob(), name = (r.headers.get("Content-Disposition") || "").match(/filename="?([^"]+)"?/);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name ? name[1] : "Problems_and_losses.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      PN.toast(`✓ ${a.download}`, true);
    } catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
    btn.disabled = false; btn.innerHTML = label;
  }

  function wire() {
    $("price-oil").value = store.get("oil_price", "70"); $("price-gas").value = store.get("gas_price", "3");
    $("price-oil").oninput = () => { store.set("oil_price", $("price-oil").value); render(); };
    $("price-gas").oninput = () => { store.set("gas_price", $("price-gas").value); render(); };
    document.querySelectorAll("#pb-when button").forEach(b => { b.onclick = () => {
      when = b.dataset.when; document.querySelectorAll("#pb-when button").forEach(x => x.classList.toggle("on", x === b)); render();
    }; });
    $("pb-well").onchange = () => { wellF = $("pb-well").value; render(); };
    $("pb-export").onclick = exportX;
  }

  wire();
  PN.start({
    async load() {
      try {
        d = await PN.api("/api/problems");
        d.issues.sort((a, b) => WHEN[a.when] - WHEN[b.when] || SEV[a.severity] - SEV[b.severity]);
        render();
      } catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
    },
    render,
  });
})();
