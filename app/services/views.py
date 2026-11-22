"""JSON payloads for the Sensors, VFM, Well and Export pages."""
import io
import zipfile

import numpy as np
import pandas as pd

from . import store, pta_service

T = ["oil_rate_stbd", "water_rate_stbd", "gas_rate_mscfd"]


def _r(a, n=2):
    return [None if (v is None or (isinstance(v, float) and not np.isfinite(v))) else round(float(v), n) for v in a]


def sensors(ds, well, step="15min"):
    h = ds.hf[ds.hf.well_name == well].set_index("timestamp")
    cols = store.SENSORS + ["choke_opening_pct"]
    g = h[cols].resample(step).mean()
    g = g[g.notna().any(axis=1)]
    shut = ds.shut[ds.shut.well_name == well]
    tests = store.shared()["tests"]
    tw = tests[(tests.well_name == well) & (tests.test_start >= h.index.min()) & (tests.test_end <= h.index.max())]
    return {"well": well, "t": [x.isoformat() for x in g.index], **{c: _r(g[c].values) for c in cols},
            "shut_ins": [{"start": a.isoformat(), "end": b.isoformat()} for a, b in zip(shut.shut_start, shut.shut_end)],
            "tests": [{"start": a.isoformat(), "end": b.isoformat()} for a, b in zip(tw.test_start, tw.test_end)]}


VAL_SPLIT = "B"   # the exam we report: each well's last 2 tests hidden (forward prediction, the harder one)


def validation():
    """MAPE % per model on the reported exam (oil, water, gas), from the training-side validation table."""
    v = store.shared()["validation"]
    v = v[v.split.str.startswith(VAL_SPLIT)]
    piv = v.pivot_table(index="model", columns="target", values="MAPE_%", sort=False).reset_index()
    return piv.round(2).to_dict(orient="records")


def model_checks():
    """Home page "model results": validation table (one exam) + physics checks of v1 vs v2."""
    d = store.shared()["diag"]
    return {"validation": validation(),
            "diag": {"lambda": d["lambda_learned_from_tests"],
                     "liftcut_v1": d["liftcut_oil_change_pct_v1"], "liftcut_v2": d["liftcut_oil_change_pct_v2"],
                     "normal_v1": d["normal_days_vs_test_pct_v1"], "normal_v2": d["normal_days_vs_test_pct_v2"]}}


def vfm(ds, well):
    s = store.shared()
    p = ds.preds[ds.preds.well_name == well].sort_values("date")
    tests = s["tests"]
    tw = tests[(tests.well_name == well) & (tests.test_start >= p.date.min()) &
               (tests.test_start <= p.date.max() + pd.Timedelta(days=1))]
    mid = tw.test_start + (tw.test_end - tw.test_start) / 2
    d = s["diag"]
    return {"well": well, "t": [str(x.date()) for x in p.date], **{k: _r(p[k].values, 1) for k in T},
            "flags": [("shut" if sf == 1 else "partial" if sf > 0 else "nodata" if nd else "low" if lc else "")
                      for sf, nd, lc in zip(p.shut_frac.fillna(0), p.no_data, p.low_coverage)],
            "tests": {"t": [x.isoformat() for x in mid], **{k: _r(tw[k].values, 1) for k in T}},
            "diag": {"lambda": d["lambda_learned_from_tests"],
                     "liftcut_v1": d["liftcut_oil_change_pct_v1"], "liftcut_v2": d["liftcut_oil_change_pct_v2"],
                     "normal_v1": d["normal_days_vs_test_pct_v1"], "normal_v2": d["normal_days_vs_test_pct_v2"]},
            "period": {k: float(p[k].sum()) for k in T}}


def well_info(ds, well):
    s = store.shared()
    comp = s["comp"].loc[well].to_dict() if well in s["comp"].index else {}
    pvt = s["pvt"].loc[well].to_dict() if well in s["pvt"].index else {}
    ev = [r for r in pta_service.events(ds) if r["well_name"] == well]
    p = ds.preds[(ds.preds.well_name == well)].sort_values("date")
    today = p.iloc[-1]
    dly = ds.daily[(ds.daily.well_name == well) & (ds.daily.shut_frac == 0)].sort_values("date").tail(7)
    clean = lambda dct: {k: (v.item() if hasattr(v, "item") else v) for k, v in dct.items()}
    skip = [r for r in pta_service.skipped(ds) if r["well_name"] == well]
    return {"well": well, "completion": clean(comp), "pvt": clean(pvt), "pta": ev[-1] if ev else None,
            "pta_skipped": skip,
            "today": {"date": str(today.date.date()), **{k: float(today[k]) for k in T}},
            "sensors_7d": {c: float(dly[c].mean()) for c in store.SENSORS + ["choke_opening_pct"]},
            "drawdown": float(s["drawdown"].drawdown_psi.get(well, np.nan))}


def vfm_hourly(ds, well, date):
    """24 hourly rates for one day: the VFM run on hourly sensor means, then scaled so that the
    mean of the 24 hours equals the daily VFM value (hourly and daily views always agree)."""
    from . import diagnostics
    try:
        day = pd.Timestamp(date)
    except (ValueError, TypeError):
        day = pd.NaT
    if pd.isna(day):                      # "" or other empty input parses to NaT
        raise ValueError("please choose a valid date")
    day = day.normalize()
    row = ds.preds[(ds.preds.well_name == well) & (ds.preds.date == day)]
    if row.empty:
        raise ValueError(f"no data for {well} on {date}")
    g = diagnostics.hourly_rates(ds, well, day, day + pd.Timedelta(days=1))
    hours = pd.date_range(day, periods=24, freq="h")
    g = (g.set_index("hour").reindex(hours) if len(g) else pd.DataFrame(index=hours, columns=T + ["shut_frac"]))
    out = {"well": well, "date": str(day.date()), "t": [h.isoformat() for h in hours],
           "daily": {k: float(row[k].iloc[0]) for k in T}}
    for k in T:
        raw = pd.to_numeric(g[k], errors="coerce")
        m = raw.mean()
        scale = out["daily"][k] / m if m and np.isfinite(m) and m > 0 else 1.0
        out[k] = _r((raw * scale).values, 1)
    for c in ["choke_opening_pct", "dh_pressure_psia", "whp_psia", "gas_lift_rate_mscfd"]:
        out[c] = _r(pd.to_numeric(g[c], errors="coerce").values, 1) if c in g else [None] * 24
    out["shut_frac"] = _r(pd.to_numeric(g["shut_frac"], errors="coerce").fillna(1).values, 2)
    return out


# ------------------------------------------------------------------ exports
def export_problems_xlsx(ds, oil_price, gas_price):
    from . import diagnostics
    buf = io.BytesIO()
    diagnostics.export_xlsx(ds, oil_price, gas_price, buf)
    return buf.getvalue()


def export_vfm_xlsx(ds):
    s = store.shared()
    piv = s["validation"].pivot_table(index=["split", "model"], columns="target", values="MAPE_%",
                                      sort=False).round(2)
    piv["mean"] = piv.mean(axis=1).round(2)
    buf = io.BytesIO()
    store.vfm.export_excel(ds.preds, piv, s["diag"], s["drawdown"], path=buf)
    return buf.getvalue()


def _pta_table(ds):
    inp = ds.pta_inputs()
    r, curves = store.pta.run_all(inp)
    return inp, r, curves


NO_ELIGIBLE = ("no shut-in in this dataset has enough data for PTA. "
               "Include at least one full producing day before each shut-in.")


def export_pta_xlsx(ds):
    if not len(ds.shut):
        raise ValueError("this dataset has no shut-ins")
    _, r, _ = _pta_table(ds)
    if r.empty:
        raise ValueError(NO_ELIGIBLE)
    buf = io.BytesIO()
    store.pta.write_excel(r, buf)
    return buf.getvalue()


# CSV versions: the main table of each workbook (CSV holds one table only). UTF-8 with BOM so Excel
# shows the text correctly; comma separator, dot decimals.
def _csv(df):
    return df.to_csv(index=False, lineterminator="\r\n").encode("utf-8-sig")


def export_vfm_csv(ds):
    p = ds.preds[["date", "well_name"] + store.vfm.TARGETS].copy()
    p["date"] = p.date.dt.date
    p[store.vfm.TARGETS] = p[store.vfm.TARGETS].round(1)
    return _csv(p)


def export_pta_csv(ds):
    if not len(ds.shut):
        raise ValueError("this dataset has no shut-ins")
    _, r, _ = _pta_table(ds)
    if r.empty:
        raise ValueError(NO_ELIGIBLE)
    return _csv(r[["well_name", "shut_in_start", "duration_hr", "horner_slope_psi_cycle",
                   "permeability_md", "skin", "dp_skin_psi"]].round(3))


def export_plots_zip(ds):
    if not len(ds.shut):
        raise ValueError("this dataset has no shut-ins")
    inp, r, curves = _pta_table(ds)
    if r.empty:
        raise ValueError(NO_ELIGIBLE)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for _, res in r.iterrows():
            img = io.BytesIO()
            store.pta.plot(inp, res, curves[(res.well_name, res.shut_in_start)], img)
            z.writestr(f"{res.well_name}_{res.shut_in_start:%Y%m%d_%H%M}.png", img.getvalue())
    return buf.getvalue()
