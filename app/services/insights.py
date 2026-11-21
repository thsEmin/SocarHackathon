"""Field overview, well status, alerts, and the what-if engine."""
from functools import lru_cache

import numpy as np
import pandas as pd

from . import store, pta_service

T = ["oil_rate_stbd", "water_rate_stbd", "gas_rate_mscfd"]


# ------------------------------------------------------------------ field events (e.g. lift-gas outages)
def lift_gas_events(ds):
    """Field-wide lift-gas supply drops: 30-min field total < 75 % of its 3-day median while at
    least half of the producing wells see their own lift gas drop by > 20 %."""
    h = ds.hf[~ds.hf.shut_in]
    g = h.set_index("timestamp").groupby("well_name").gas_lift_rate_mscfd.resample("30min").mean().unstack(0)
    base = g.rolling("3D").median()
    drop = (g / base) < 0.8
    total, total_base = g.sum(axis=1), base.sum(axis=1)
    flag = (total < 0.75 * total_base) & (drop.sum(axis=1) >= max(2, g.shape[1] // 2))
    events, start = [], None
    idx = flag.index
    for i, f in enumerate(flag.values):
        if f and start is None:
            start = i
        if (not f or i == len(flag) - 1) and start is not None:
            end = i if not f else i + 1
            seg = slice(start, end)
            if end - start >= 2:  # at least 1 hour
                pct = float((total.iloc[seg] / total_base.iloc[seg]).min() - 1) * 100
                events.append({"start": idx[start].isoformat(), "end": idx[end - 1].isoformat(),
                               "min_change_pct": round(pct, 1),
                               "wells": int(drop.iloc[seg].any(axis=0).sum())})
            start = None
    return events


# ------------------------------------------------------------------ status per well
def well_status(ds):
    pta_rows = {r["well_name"]: r for r in pta_service.events(ds)}  # latest event per well wins
    p = ds.preds
    last = p.date.max()
    out = {}
    for w in ds.wells():
        r = pta_rows.get(w)
        status, reasons = "ok", []
        if r:
            if r["skin"] > 5:
                status = "alarm"; reasons.append({"key": "st_damaged", "skin": r["skin"]})
            elif r["skin"] > 1.5:
                status = "warning"; reasons.append({"key": "st_mild_damage", "skin": r["skin"]})
        recent = p[(p.well_name == w) & (p.date > last - pd.Timedelta(days=7))]
        if recent.low_coverage.any() and status == "ok":
            status = "warning"; reasons.append({"key": "st_data_gap"})
        out[w] = {"status": status, "reasons": reasons, "has_pta": r is not None}
    return out


def overview(ds):
    s = store.shared()
    p = ds.preds.sort_values(["well_name", "date"])
    last = p.date.max()
    status = well_status(ds)
    pta_rows = {r["well_name"]: r for r in pta_service.events(ds)}
    wells = []
    for w, g in p.groupby("well_name"):
        today = g[g.date == last].iloc[0]
        prod = g[g.shut_frac == 0]
        spark = prod[prod.date > last - pd.Timedelta(days=90)]
        # decline = trend line through log(oil) of all producing days (robust to single noisy days)
        x = (prod.date - prod.date.iloc[0]).dt.days.values
        slope = np.polyfit(x, np.log(prod.oil_rate_stbd.clip(lower=1).values), 1)[0] if len(prod) > 10 else 0.0
        decline = (np.exp(slope * 365) - 1) * 100
        liq = today.oil_rate_stbd + today.water_rate_stbd
        r = pta_rows.get(w)
        wells.append({
            "well": w, "manifold": str(s["comp"].loc[w, "production_manifold"]) if w in s["comp"].index else "?",
            "oil": float(today.oil_rate_stbd), "water": float(today.water_rate_stbd), "gas": float(today.gas_rate_mscfd),
            "wc": float(today.water_rate_stbd / liq * 100) if liq > 0 else None,
            "spark": [round(float(v), 1) for v in spark.oil_rate_stbd],
            "decline_pct_yr": round(float(decline), 1),
            "cum_oil": float((g.oil_rate_stbd).sum()),
            "k": r["permeability_md"] if r else None, "skin": r["skin"] if r else None,
            **status[w]})
    tot = p[p.date == last][T].sum()
    prev = p[p.date == last - pd.Timedelta(days=30)][T].sum()
    alerts = []
    for w in wells:
        for rs in w["reasons"]:
            alerts.append({"level": w["status"], "well": w["well"], **rs})
    for e in lift_gas_events(ds):
        alerts.append({"level": "warning", "well": None, "key": "ev_liftgas", **e})
    flags = p[(p.no_data) | (p.low_coverage & ~p.no_data)]
    if len(flags):
        alerts.append({"level": "info", "well": None, "key": "ev_datagaps", "n": int(len(flags))})
    for _, ev in ds.shut.iterrows():
        alerts.append({"level": "info", "well": ev.well_name, "key": "ev_shutin",
                       "start": ev.shut_start.isoformat(), "hours": round(float(ev.duration_hr), 1)})
    order = {"alarm": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: order[a["level"]])
    fastest = min(wells, key=lambda x: x["decline_pct_yr"])
    return {"date": str(last.date()), "wells": wells, "alerts": alerts,
            "totals": {k: float(v) for k, v in tot.items()},
            "totals_prev30": {k: float(v) for k, v in prev.items()},
            "period_cum_oil": float(p.oil_rate_stbd.sum()),
            "fastest_decline": {"well": fastest["well"], "pct_yr": fastest["decline_pct_yr"]},
            "field_series": {"t": [str(x.date()) for x in sorted(p.date.unique())],
                             **{k: [round(float(v), 1) for v in p.groupby("date")[k].sum().values] for k in T}}}


# ------------------------------------------------------------------ what-if
@lru_cache(maxsize=1)
def lift_gas_response():
    """Per-well downhole-pressure response to lift gas, measured in the 14-Jun-2025 field-wide
    outage (a natural step test): dPwf / dQlift in psi per mscfd (negative: less gas -> higher Pwf)."""
    ds = store.get("preloaded")
    h = ds.hf[ds.hf.timestamp.between("2025-06-14 06:00", "2025-06-14 16:00")].copy()
    hr = h.timestamp.dt.hour + h.timestamp.dt.minute / 60
    base = h[(hr >= 6) & (hr < 9.5)].groupby("well_name")[["gas_lift_rate_mscfd", "dh_pressure_psia"]].mean()
    dip = h[(hr >= 11) & (hr < 14)].groupby("well_name")[["gas_lift_rate_mscfd", "dh_pressure_psia"]].mean()
    d = dip - base
    slope = d.dh_pressure_psia / d.gas_lift_rate_mscfd
    return slope.to_dict()


def whatif(ds, well, choke_delta_pct, lift_delta_pct):
    """Scenario on the last 7 producing days. Physics:
       choke  -> oil model's learned choke effect (log-rate per % opening)
       lift   -> dPwf = (dPwf/dQlift from the 14-Jun outage) * dQlift ; d ln q = -dPwf / drawdown (IPR)
       water and gas follow oil (fluid ratios unchanged)."""
    s = store.shared()
    m = s["model"].oil
    p = ds.preds[(ds.preds.well_name == well) & (ds.preds.shut_frac == 0)].sort_values("date").tail(7)
    dly = ds.daily[(ds.daily.well_name == well) & (ds.daily.shut_frac == 0)].sort_values("date").tail(7)
    base = {k: float(p[k].mean()) for k in T}
    choke0 = float(dly.choke_opening_pct.mean())
    lift0 = float(dly.gas_lift_rate_mscfd.mean())
    pwf0 = float(dly.dh_pressure_psia.mean())
    dd = float(s["drawdown"].drawdown_psi.get(well, s["drawdown"].drawdown_psi.median()))
    dd_src = str(s["drawdown"].source.get(well, "median"))

    i = m.feats.index("choke_opening_pct")
    per_pct = m.coef[i] / m.sd["choke_opening_pct"]
    dln_choke = per_pct * choke_delta_pct

    slope = lift_gas_response().get(well, np.nan)
    dq_lift = lift0 * lift_delta_pct / 100
    dpwf = float(slope * dq_lift) if np.isfinite(slope) else 0.0
    dln_lift = -dpwf / dd

    f = float(np.exp(dln_choke + dln_lift))
    new = {k: base[k] * f for k in T}
    notes = []
    if lift_delta_pct > 25:
        notes.append("note_lift_diminishing")
    if abs(choke_delta_pct) > 10:
        notes.append("note_choke_range")
    if dd_src != "own shut-in":
        notes.append("note_dd_median")
    return {"well": well, "base": base, "new": new, "delta": {k: new[k] - base[k] for k in T},
            "factor": f, "choke0": choke0, "choke1": choke0 + choke_delta_pct,
            "lift0": lift0, "lift1": lift0 + dq_lift, "pwf0": pwf0, "pwf1": pwf0 + dpwf, "dpwf": dpwf,
            "drawdown": dd, "drawdown_source": dd_src, "lift_slope_psi_per_mscfd": float(slope),
            "choke_effect_pct": (np.exp(dln_choke) - 1) * 100, "lift_effect_pct": (np.exp(dln_lift) - 1) * 100,
            "notes": notes}
