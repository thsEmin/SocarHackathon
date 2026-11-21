(function () {
  const $ = id => document.getElementById(id);
  let newDs = null;
  const stat = (v, l, d = 0) => `<div class="stat"><div class="v">${typeof v === "string" ? v : PN.fmt(v, d)}</div><div class="l">${PN.t(l)}</div></div>`;

  function render() {
    const ds = PN.state.datasets.find(d => d.id === PN.state.ds) || PN.state.datasets[0];
    if (!ds) return;
    $("ds-src").textContent = PN.t("src_" + ds.source);
    $("ds-label").textContent = ds.label;
    const days = Math.round((new Date(ds.end) - new Date(ds.start)) / 864e5) + 1;
    $("ds-stats").innerHTML = stat(`${days} d`, "period") + stat(ds.wells.length, "wells")
      + stat(ds.n_minutes, "minutes") + stat(ds.n_shut_ins, "shutins");
    const c = ds.cleaning || {}, spikes = c.spikes_removed ? Object.values(c.spikes_removed).reduce((a, b) => a + b, 0) : 0;
    $("clean-stats").innerHTML = stat(c.rows_raw, "rows_raw") + stat(c.exact_duplicates_dropped, "dups")
      + stat(c.sentinels_to_nan, "sentinels") + stat(spikes, "spikes");
    $("ds-table").innerHTML = `<tr><th>${PN.t("dataset")}</th><th>${PN.t("period")}</th><th class="n">${PN.t("wells")}</th><th class="n">${PN.t("shutins")}</th><th></th></tr>`
      + PN.state.datasets.map(d => `<tr class="${d.id === PN.state.ds ? "hl" : ""}"><td>${d.label}</td><td class="mono">${d.start} → ${d.end}</td>
        <td class="n">${d.wells.length}</td><td class="n">${d.n_shut_ins}</td>
        <td style="text-align:right">${d.id === PN.state.ds ? `<span class="badge accent">${PN.t("active")}</span>` : `<button class="btn ghost" data-ds="${d.id}">${PN.t("use_ds")}</button>`}</td></tr>`).join("");
    document.querySelectorAll("[data-ds]").forEach(b => b.onclick = () => { PN.setDataset(b.dataset.ds); render(); });
  }

  function bindDrop(zone, input, label) {
    input.onchange = () => { $(label).textContent = input.files[0] ? `${input.files[0].name} · ${(input.files[0].size / 1e6).toFixed(1)} MB` : PN.t("choose"); $("go").disabled = !$("f-hf").files[0]; };
    zone.ondragover = e => { e.preventDefault(); zone.classList.add("over"); };
    zone.ondragleave = () => zone.classList.remove("over");
    zone.ondrop = e => { e.preventDefault(); zone.classList.remove("over"); input.files = e.dataTransfer.files; input.onchange(); };
  }

  async function upload() {
    const fd = new FormData();
    fd.append("hf", $("f-hf").files[0]);
    if ($("f-choke").files[0]) fd.append("choke", $("f-choke").files[0]);
    $("go").disabled = true; $("prog").classList.remove("hidden"); $("done").classList.add("hidden"); $("warn").textContent = "";
    $("stage").textContent = "uploading…"; $("prog").firstElementChild.style.width = "3%";
    try {
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      poll(j.job);
    } catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); $("go").disabled = false; }
  }

  async function poll(job) {
    const j = await (await fetch(`/api/upload/${job}`)).json();
    $("stage").textContent = j.stage; $("prog").firstElementChild.style.width = j.progress + "%";
    $("warn").innerHTML = (j.warnings || []).map(w => `⚠ ${w}`).join("<br>");
    if (j.status === "error") { PN.toast(`${PN.t("error")}: ${j.error}`); $("go").disabled = false; return; }
    if (j.status === "done") {
      newDs = j.dataset; await PN.refreshDatasets(); render();
      $("done").classList.remove("hidden"); $("go").disabled = false; PN.toast("✓ " + j.dataset, true); return;
    }
    setTimeout(() => poll(job), 800);
  }

  PN.start({
    load() {
      bindDrop($("drop-hf"), $("f-hf"), "n-hf"); bindDrop($("drop-choke"), $("f-choke"), "n-choke");
      $("go").onclick = upload;
      $("open-ds").onclick = () => { if (newDs) { PN.setDataset(newDs); location.href = "/overview"; } };
      render();
    },
    render,
  });
})();
