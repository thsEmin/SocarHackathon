"""PTA for the app: auto results per shut-in (cached) and live re-analysis with a manual window."""
import numpy as np
import pandas as pd

from . import store

pta = store.pta
RESULT_KEYS = ["horner_slope_psi_cycle", "permeability_md", "skin", "dp_skin_psi", "q_oil_vfm_stbd",
               "tp_hr", "pwf_psia", "p1hr_psia", "p_star_gauge_psia", "p_star_datum_psia",
               "avg_reservoir_pressure_datum_psia", "p_last_psia", "bubble_point_psia",
               "radial_window_start_hr", "radial_window_end_hr", "derivative_flatness_cv",
               "m_from_derivative", "wellbore_storage_bbl_psi", "flow_efficiency",
               "radius_investigation_ft", "drainage_radius_ft", "boundary_felt_at_radius_ft",
               "duration_hr"]


def _clean(v):
    if isinstance(v, (np.floating, float)):
        return None if not np.isfinite(v) else float(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (pd.Timestamp,)):
        return v.isoformat()
    return v


def interpretation_codes(r):
    """Same rules as pta.interpret(), as language-neutral codes the page translates (EN / AZ)."""
    codes = []
    s, k = r["skin"], r["permeability_md"]
    if s > 3:
        codes.append({"key": "skin_damaged", "skin": s, "fe": r["flow_efficiency"]})
    elif s > 0.5:
        codes.append({"key": "skin_mild", "skin": s})
    elif s < -1:
        codes.append({"key": "skin_stimulated", "skin": s})
    else:
        codes.append({"key": "skin_ok", "skin": s})
    codes.append({"key": "perm_high" if k > 150 else "perm_moderate" if k > 50 else "perm_low", "k": k})
    if r["late_time_behaviour"] == "boundary / pressure support":
        codes.append({"key": "late_support", "radius": _clean(r.get("boundary_felt_at_radius_ft")),
                      "p": r["p_last_psia"]})
    elif r["late_time_behaviour"] == "boundary / lower mobility":
        codes.append({"key": "late_rise"})
    else:
        codes.append({"key": "late_radial"})
    return codes


def _event(ds, idx):
    ev = ds.shut.iloc[idx]
    return ev


def events(ds):
    """Auto analysis of every shut-in (cached per dataset)."""
    if "auto" not in ds._pta_cache:
        inp = ds.pta_inputs()
        out = []
        for i in range(len(ds.shut)):
            res, _ = pta.analyse(inp, ds.shut.iloc[i])
            out.append(res)
        ds._pta_cache["auto"] = out
    rows = []
    for i, r in enumerate(ds._pta_cache["auto"]):
        rows.append({"idx": i, "well_name": r["well_name"], "shut_in_start": r["shut_in_start"].isoformat(),
                     "quality": r["quality"], "late": r["late_time_behaviour"],
                     **{k: _clean(r[k]) for k in RESULT_KEYS}})
    return rows


def detail(ds, idx, window=None):
    inp = ds.pta_inputs()
    ev = _event(ds, idx)
    res, cur = pta.analyse(inp, ev, window=window)
    if window is not None:
        n_in = int(((cur["dt"] >= window[0]) & (cur["dt"] <= window[1])).sum())
        if n_in < 5:
            raise ValueError(f"only {n_in} data points in {window[0]:g}-{window[1]:g} h; choose a wider window")
    auto = events(ds)[idx]
    # curves for the four plots
    hw = ds.hf[ds.hf.well_name == ev.well_name]
    hist = hw[hw.timestamp.between(ev.shut_start - pd.Timedelta(days=5), ev.shut_end + pd.Timedelta(days=1))]
    hist = hist.set_index("timestamp").dh_pressure_psia.resample("15min").mean().dropna()
    d = ds.preds[(ds.preds.well_name == ev.well_name)
                 & ds.preds.date.between(ev.shut_start.normalize() - pd.Timedelta(days=5),
                                         ev.shut_start.normalize() - pd.Timedelta(days=1))]
    q = res["q_oil_vfm_stbd"]
    rate_t = [x.isoformat() for x in d.date] + [ev.shut_start.normalize().isoformat(),
                                                ev.shut_start.isoformat(), ev.shut_end.isoformat()]
    rate_q = list(np.round(d.oil_rate_stbd, 1)) + [q, 0.0, 0.0]
    der = np.where(np.isfinite(cur["der"]) & (cur["der"] > 0), cur["der"], np.nan)
    xx = np.linspace(0, float(np.nanmax(cur["X"])), 40)
    return {
        "idx": idx, "well_name": ev.well_name, "shut_in_start": ev.shut_start.isoformat(),
        "shut_in_end": ev.shut_end.isoformat(), "window_auto": bool(res["window_auto"]),
        "auto_window": [auto["radial_window_start_hr"], auto["radial_window_end_hr"]],
        "quality": res["quality"], "late": res["late_time_behaviour"],
        "results": {k: _clean(res[k]) for k in RESULT_KEYS},
        "auto_results": {k: auto[k] for k in ("horner_slope_psi_cycle", "permeability_md", "skin", "dp_skin_psi")},
        "interpretation": interpretation_codes(res),
        "history": {"t": [x.isoformat() for x in hist.index], "p": list(np.round(hist.values, 2)),
                    "rate_t": rate_t, "rate_q": [float(v) for v in rate_q]},
        "loglog": {"dt": list(np.round(cur["dt"], 5)), "dp": list(np.round(cur["p"] - res["pwf_psia"], 3)),
                   "der": [None if not np.isfinite(v) else round(float(v), 4) for v in der]},
        "horner": {"x": list(np.round(cur["X"], 5)), "p": list(np.round(cur["p"], 3)),
                   "fit_x": list(np.round(xx, 4)), "fit_p": list(np.round(cur["icpt"] + cur["slope"] * xx, 3)),
                   "p1hr_x": float(np.log10(res["tp_hr"] + 1))},
    }
