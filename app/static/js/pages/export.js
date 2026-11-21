(function () {
  async function download(btn) {
    const kind = btn.dataset.kind, label = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = `<span>${PN.t("preparing")}</span>`;
    try {
      const r = await fetch(`/api/export/${kind}?ds=${encodeURIComponent(PN.state.ds)}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      const blob = await r.blob();
      const name = (r.headers.get("Content-Disposition") || "").match(/filename="?([^"]+)"?/);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name ? name[1] : kind;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      PN.toast(`✓ ${a.download}`, true);
    } catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
    btn.disabled = false; btn.innerHTML = label;
  }
  function render() {
    const ds = PN.state.datasets.find(d => d.id === PN.state.ds);
    document.getElementById("exp-ds").textContent = ds ? ds.label : PN.state.ds;
  }
  PN.start({
    load() { document.querySelectorAll("[data-kind]").forEach(b => b.onclick = () => download(b)); render(); },
    render,
  });
})();
