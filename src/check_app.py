"""Automatic checks for the PetroNova web app (runs without a browser, via Flask's test client).
Prints PASS/FAIL per check; exits with code 1 if anything fails."""
import io
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.server import create_app, PAGES  # noqa: E402

results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


app = create_app()
c = app.test_client()

# pages
codes = {p: c.get(f"/{p}").status_code for p in PAGES}
check("APP: every page renders", all(v == 200 for v in codes.values()), str(codes))

# API endpoints
eps = ["/api/datasets", "/api/overview", "/api/sensors?well=GL-04", "/api/vfm?well=GL-07", "/api/well?well=GL-09",
       "/api/pta/events", "/api/pta/2", "/api/whatif?well=GL-05&choke=3&lift=10"]
st = {e: c.get(e).status_code for e in eps}
check("APP: every API endpoint answers", all(v == 200 for v in st.values()), ", ".join(f"{k.split('?')[0]}={v}" for k, v in st.items()))

# numbers in the app == pipeline outputs
pred = pd.read_csv(ROOT / "work" / "daily_predictions.csv")
ov = c.get("/api/overview").get_json()
last = pred[pred.date == pred.date.max()]
check("APP: field totals = VFM daily predictions", abs(ov["totals"]["oil_rate_stbd"] - last.oil_rate_stbd.sum()) < 1e-6)
est = pd.read_csv(ROOT / "work" / "pta_estimates.csv")
ev = c.get("/api/pta/events").get_json()
check("APP: PTA (auto window) = pipeline PTA results",
      all(abs(a["permeability_md"] - b) < 1e-6 for a, b in zip(ev, est.permeability_md)) and len(ev) == len(est))
d0 = c.get("/api/pta/0").get_json()
w0, w1 = d0["results"]["radial_window_start_hr"], d0["results"]["radial_window_end_hr"]
dm = c.get(f"/api/pta/0?w0={w0}&w1={w1}").get_json()
check("APP: manual window equal to auto window gives the same k", abs(dm["results"]["permeability_md"] - d0["results"]["permeability_md"]) < 1e-9)
check("APP: bad windows are refused cleanly",
      c.get("/api/pta/0?w0=5&w1=2").status_code == 400 and c.get("/api/pta/0?w0=1&w1=1.05").status_code == 400
      and c.get("/api/pta/99").status_code == 404)

# what-if physics
base = c.get("/api/whatif?well=GL-01").get_json()
more_lift = c.get("/api/whatif?well=GL-01&lift=20").get_json()
less_lift = c.get("/api/whatif?well=GL-01&lift=-20").get_json()
more_choke = c.get("/api/whatif?well=GL-01&choke=5").get_json()
check("APP: what-if at 0/0 changes nothing", abs(base["factor"] - 1) < 1e-12)
check("APP: what-if follows physics (more lift / more choke -> more oil, less lift -> less)",
      more_lift["factor"] > 1 > less_lift["factor"] and more_choke["factor"] > 1 and more_lift["dpwf"] < 0)

# exports
ok = True
for k in ("vfm", "pta", "plots"):
    r = c.get(f"/api/export/{k}")
    ok &= r.status_code == 200 and len(r.data) > 1000
x = pd.read_excel(io.BytesIO(c.get("/api/export/vfm").data), sheet_name="predictions")
check("APP: exports download (VFM Excel, PTA Excel, plots zip)", ok)
check("APP: exported VFM Excel has the required columns",
      list(x.columns) == ["date", "well_name", "oil_rate_stbd", "water_rate_stbd", "gas_rate_mscfd"] and len(x) == len(pred))

# upload round trip (small file, same pipeline)
raw = pd.read_csv(ROOT / "Dataset" / "high_freq_data.csv", nrows=200000)
sub = raw[raw.well_name == "GL-01"]
r = c.post("/api/upload", data={"hf": (io.BytesIO(sub.to_csv(index=False).encode()), "t.csv")}, content_type="multipart/form-data")
job = r.get_json()["job"]
import time  # noqa: E402
for _ in range(120):
    j = c.get(f"/api/upload/{job}").get_json()
    if j["status"] in ("done", "error"):
        break
    time.sleep(0.5)
check("APP: upload -> clean -> VFM works", j["status"] == "done", j.get("error") or j.get("dataset"))
bad = c.post("/api/upload", data={"hf": (io.BytesIO(b"a,b\n1,2\n"), "bad.csv")}, content_type="multipart/form-data").get_json()["job"]
for _ in range(40):
    jb = c.get(f"/api/upload/{bad}").get_json()
    if jb["status"] in ("done", "error"):
        break
    time.sleep(0.25)
check("APP: wrong upload file gives a clear error", jb["status"] == "error" and "missing columns" in jb["error"], jb.get("error"))

print(f"\n{sum(results)}/{len(results)} app checks passed")
sys.exit(0 if all(results) else 1)
