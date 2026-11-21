(function () {
  const $ = id => document.getElementById(id);
  let r = null, timer = null;

  async function run() {
    const choke = +$("s-choke").value, lift = +$("s-lift").value;
    $("v-choke").textContent = `${PN.signed(choke, 1)} pt`;
    $("v-lift").textContent = `${PN.signed(lift, 0)} %`;
    try { r = await PN.api("/api/whatif", { well: PN.state.well, choke, lift }); render(); }
    catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 120); };

  function render() {
    if (!r) return;
    const c = PN.colors;
    [["oil", "oil_rate_stbd", 0, "oil"], ["water", "water_rate_stbd", 0, "liq"], ["gas", "gas_rate_mscfd", 0, "gas"]].forEach(([k, f, d, u]) => {
      $(`n-${k}`).textContent = PN.fmt(PN.cv(u, r.new[f]), d);
      const dv = PN.cv(u, r.delta[f]), cls = Math.abs(dv) < 0.5 ? "flat" : dv > 0 ? "up" : "down";
      $(`d-${k}`).innerHTML = `<span class="chip ${cls}">${PN.signed(dv, 0)}</span> <span class="dim">${PN.t("wi_base")}: ${PN.fmt(PN.cv(u, r.base[f]), 0)}</span>`;
    });
    $("choke-abs").textContent = `${PN.fmt(r.choke0, 1)} % → ${PN.fmt(r.choke1, 1)} %`;
    $("lift-abs").textContent = `${PN.fmt(PN.cv("gas", r.lift0), 0)} → ${PN.fmt(PN.cv("gas", r.lift1), 0)} ${PN.ul("gas")}`;
    $("chain").innerHTML = [
      `${PN.t("lift")} <b>${PN.signed(PN.cv("gas", r.lift1 - r.lift0), 0)}</b> ${PN.ul("gas")}`,
      `${PN.t("pwf")} <b>${PN.signed(PN.cv("dp", r.dpwf), 1)}</b> ${PN.ul("dp")} <span class="dim">(${PN.fmt(r.lift_slope_psi_per_mscfd, 3)} psi per Mscf/d, 14-Jun)</span>`,
      `${PN.t("drawdown")} <b>${PN.fmt(PN.cv("dp", r.drawdown), 0)}</b> ${PN.ul("dp")} <span class="dim">${r.drawdown_source === "own shut-in" ? "(PTA)" : "(median)"}</span>`,
      `${PN.t("lift_effect")} <b>${PN.signed(r.lift_effect_pct, 1)}%</b>`,
      `+ ${PN.t("choke_effect")} <b>${PN.signed(r.choke_effect_pct, 1)}%</b>`,
      `${PN.t("oil")} <b style="color:var(--oil)">${PN.signed((r.factor - 1) * 100, 1)}%</b>`,
    ].map((s, i) => (i ? `<span class="arrow">→</span>` : "") + `<span class="step">${s}</span>`).join("");
    $("notes").innerHTML = r.notes.map(n => `<div>⚠ ${PN.t(n)}</div>`).join("");

    const base = PN.cv("oil", r.base.oil_rate_stbd), nw = PN.cv("oil", r.new.oil_rate_stbd), dChoke = base * r.choke_effect_pct / 100, dLift = nw - base - dChoke;
    PN.plot($("c-wf"), [{
      type: "waterfall", orientation: "v", measure: ["absolute", "relative", "relative", "total"],
      x: [`${PN.t("oil")} · ${PN.t("wi_base")}`, PN.t("choke_effect"), PN.t("lift_effect"), `${PN.t("oil")} · ${PN.t("wi_new")}`],
      y: [base, dChoke, dLift, 0], text: [PN.fmt(base), PN.signed(dChoke, 0), PN.signed(dLift, 0), PN.fmt(nw)], textposition: "outside",
      connector: { line: { color: c.line } }, increasing: { marker: { color: c.ok } }, decreasing: { marker: { color: c.alarm } },
      totals: { marker: { color: c.oil } }, textfont: { family: "JetBrains Mono", color: c.ink },
    }], { yaxis: { title: { text: PN.t("stbd_oil") }, range: [Math.min(base, nw) * 0.8, Math.max(base, nw) * 1.08] }, showlegend: false, hovermode: "closest", margin: { t: 20 } });
  }

  PN.start({
    load() {
      $("s-choke").oninput = schedule; $("s-lift").oninput = schedule;
      $("reset").onclick = () => { $("s-choke").value = 0; $("s-lift").value = 0; run(); };
      return run();
    },
    render, onWell: run,
  });
})();
