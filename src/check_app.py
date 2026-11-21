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
       "/api/pta/events", "/api/pta/2", "/api/whatif?well=GL-05&choke=3&lift=10", "/api/problems",
       "/api/vfm/hourly?well=GL-01&date=2025-06-14"]
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

# problems: detection, root cause texts and lost production
import re  # noqa: E402
pb = c.get("/api/problems").get_json()
iss = pb["issues"]
i18n = (ROOT / "app" / "static" / "js" / "i18n.js").read_text(encoding="utf-8")
missing = sorted({f"pb_{i['type']}{s}" for i in iss for s in ("_t", "_c", "_f")} - set(re.findall(r"\b(pb_\w+):", i18n)))
check("APP: problems found where the data show them (GL-01 damage alarm, 14-Jun lift-gas outage, shut-ins)",
      any(i["well"] == "GL-01" and i["type"] == "damage" and i["severity"] == "alarm" for i in iss)
      and any(i["type"] == "liftfield" and i["loss_oil_stb"] > 0 for i in iss)
      and sum(i["type"] == "downtime" for i in iss) >= 3)
check("APP: every problem has title, root cause and solution text (EN)", not missing, ", ".join(missing))
check("APP: lost production is never negative and adds up",
      all(r["oil_stb"] >= 0 and r["gas_mscf"] >= 0 for r in pb["loss_daily"])
      and abs(sum(r["oil_stb"] for r in pb["loss_daily"]) - sum(r["oil_stb"] for r in pb["loss_by_well"])) < 1)
ov_bad = {w["well"] for w in ov["wells"] if w["status"] != "ok"}
pb_bad = {i["well"] for i in iss if i["when"] == "now" and i["severity"] in ("alarm", "warning")}
check("APP: overview traffic lights = current problems", ov_bad == pb_bad, f"{sorted(ov_bad)} vs {sorted(pb_bad)}")

# hourly VFM: 24 hours average to the daily value, shut-in hours are zero
pdl = pred.assign(date=pd.to_datetime(pred.date))
ok_h = True
for w, day in [("GL-01", "2025-06-14"), ("GL-01", "2025-04-15"), ("GL-07", "2025-03-01")]:
    h = c.get(f"/api/vfm/hourly?well={w}&date={day}").get_json()
    daily = pdl[(pdl.well_name == w) & (pdl.date == day)].oil_rate_stbd.iloc[0]
    vals = [v if v is not None else 0 for v in h["oil_rate_stbd"]]
    ok_h &= len(vals) == 24 and abs(sum(vals) / 24 - daily) < 0.5
    ok_h &= all(v == 0 for v, sf in zip(vals, h["shut_frac"]) if sf == 1)
check("APP: hourly VFM adds up to the daily value; shut-in hours are 0", ok_h)
check("APP: hourly view refuses a day without data", c.get("/api/vfm/hourly?well=GL-01&date=2031-01-01").status_code == 400)

# display units: conversion factors used by the browser
core = (ROOT / "app" / "static" / "js" / "core.js").read_text(encoding="utf-8")
fac = lambda unit: float(re.search(r'\b' + unit + r': \["[^"]+", ([0-9.e]+)\]', core).group(1))
check("APP: unit conversion factors (1000 psi = 68.95 bar, 1000 stb = 158.99 m3, 1 Mscf = 28.32 m3)",
      abs(1000 * fac("bar") - 68.9476) < 1e-3 and abs(1000 * fac("m3d") - 158.987) < 1e-2 and abs(fac("kPa") - 6.89476) < 1e-5)

# exports
ok = True
for k in ("vfm", "pta", "plots"):
    r = c.get(f"/api/export/{k}")
    ok &= r.status_code == 200 and len(r.data) > 1000
x = pd.read_excel(io.BytesIO(c.get("/api/export/vfm").data), sheet_name="predictions")
check("APP: exports download (VFM Excel, PTA Excel, plots zip)", ok)
rp = c.get("/api/export/problems?oil_price=80&gas_price=3")
sheets = pd.ExcelFile(io.BytesIO(rp.data)).sheet_names if rp.status_code == 200 else []
check("APP: problems & losses Excel downloads", sheets == ["issues", "loss_by_well_cause", "loss_daily", "assumptions"], str(sheets))
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
if j["status"] == "done":
    up = {e: c.get(f"{e}{'&' if '?' in e else '?'}ds={j['dataset']}").status_code
          for e in ["/api/problems", "/api/overview", "/api/vfm/hourly?well=GL-01&date=" + str(sub.timestamp.min())[:10]]}
    check("APP: problems, overview and hourly view work on uploaded data", all(v == 200 for v in up.values()), str(up))
def upload(df, name="t.csv"):
    jid = c.post("/api/upload", data={"hf": (io.BytesIO(df.to_csv(index=False).encode()), name)},
                 content_type="multipart/form-data").get_json()["job"]
    for _ in range(600):
        jj = c.get(f"/api/upload/{jid}").get_json()
        if jj["status"] in ("done", "error"):
            return jj
        time.sleep(0.5)
    return jj


# regression: an upload that starts on the shut-in day has no producing day before it -> no crash,
# the event is marked unavailable with a clear reason, VFM still works
demo = pd.read_csv(ROOT / "samples" / "demo_GL01_GL10_Apr-May2025.csv")
ts = pd.to_datetime(demo.timestamp, format="mixed")
cut = demo[(demo.well_name == "GL-01") & (ts >= "2025-04-15") & (ts < "2025-04-20")]
jc = upload(cut)
if jc["status"] == "done":
    q = f"?ds={jc['dataset']}"
    eps2 = ["/api/pta/events" + q, "/api/pta/skipped" + q, "/api/vfm?well=GL-01&ds=" + jc["dataset"],
            "/api/well?well=GL-01&ds=" + jc["dataset"], "/api/overview" + q, "/api/problems" + q]
    rs = {e: c.get(e) for e in eps2}
    sk = rs[eps2[1]].get_json()
    exp = c.get(f"/api/export/pta{q}")
    check("APP: upload starting on a shut-in day -> no 500, event marked 'no producing day', VFM still works",
          all(r.status_code == 200 for r in rs.values()) and rs[eps2[0]].get_json() == []
          and len(sk) >= 1 and sk[0]["code"] == "no_producing_day" and exp.status_code == 400
          and "producing day" in exp.get_json()["error"] and jc.get("pta_ok") == 0,
          f"{ {k.split('?')[0]: r.status_code for k, r in rs.items()} } export={exp.status_code} skipped={sk}")
else:
    check("APP: upload starting on a shut-in day -> no 500", False, jc.get("error"))

# the recommended demo sample still gives both PTA results (GL-01 ~107.8 mD, skin ~+5.7)
jd = upload(demo, "demo.csv")
evd = c.get(f"/api/pta/events?ds={jd.get('dataset')}").get_json() if jd["status"] == "done" else []
g1 = [e for e in evd if e["well_name"] == "GL-01"]
check("APP: demo sample -> 2 PTA results, GL-01 k ~107.8 mD and skin ~+5.7",
      len(evd) == 2 and bool(g1) and abs(g1[0]["permeability_md"] - 107.8) < 1 and abs(g1[0]["skin"] - 5.7) < 0.2,
      str([(e["well_name"], round(e["permeability_md"], 1), round(e["skin"], 2)) for e in evd]))

bad = c.post("/api/upload", data={"hf": (io.BytesIO(b"a,b\n1,2\n"), "bad.csv")}, content_type="multipart/form-data").get_json()["job"]
for _ in range(40):
    jb = c.get(f"/api/upload/{bad}").get_json()
    if jb["status"] in ("done", "error"):
        break
    time.sleep(0.25)
check("APP: wrong upload file gives a clear error", jb["status"] == "error" and "missing columns" in jb["error"], jb.get("error"))

# regression: odd inputs answer with a clear 4xx (never a 500); what-if stays inside the slider range
odd = {u: c.get(u).status_code for u in ["/api/vfm/hourly?well=GL-01&date=", "/api/vfm/hourly?well=GL-01&date=xyz"]}
wi_big = c.get("/api/whatif?well=GL-01&choke=1e9&lift=1e9").get_json()
wi_max = c.get("/api/whatif?well=GL-01&choke=10&lift=50").get_json()
wi_nan = c.get("/api/whatif?well=GL-01&choke=nan&lift=inf").get_json()
check("APP: empty/invalid hourly date -> 400; what-if clamps huge and NaN inputs",
      all(v == 400 for v in odd.values()) and abs(wi_big["factor"] - wi_max["factor"]) < 1e-9 and wi_nan["factor"] == 1.0,
      f"{odd} big={wi_big['factor']} max={wi_max['factor']} nan={wi_nan['factor']}")

# regression: an upload where the only well is shut in the whole time -> loads, and every page answers
shut_only = demo[(demo.well_name == "GL-01") & (ts >= "2025-04-15 09:00") & (ts < "2025-04-17")]
js = upload(shut_only, "shut_only.csv")
codes = {}
if js["status"] == "done":
    qq = "ds=" + js["dataset"]
    codes = {e: c.get(f"{e}{'&' if '?' in e else '?'}{qq}").status_code
             for e in ["/api/overview", "/api/problems", "/api/pta/events", "/api/vfm?well=GL-01",
                       "/api/well?well=GL-01", "/api/whatif?well=GL-01", "/api/sensors?well=GL-01"]}
check("APP: upload of a well shut in the whole time -> loads, no 500 on any page",
      js["status"] == "done" and all(v < 500 for v in codes.values()), f"{js.get('error')} {codes}")

print(f"\n{sum(results)}/{len(results)} app checks passed")
sys.exit(0 if all(results) else 1)
