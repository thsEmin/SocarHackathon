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
    if h.empty:                      # every well shut in for the whole dataset: no lift gas to watch
        return []
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
    """Traffic light per well = worst CURRENT problem found by diagnostics (alarm / warning)."""
    from . import diagnostics
    pta_wells = {r["well_name"] for r in pta_service.events(ds)}
    out = {w: {"status": "ok", "reasons": [], "has_pta": w in pta_wells} for w in ds.wells()}
    rank = {"ok": 9, "alarm": 0, "warning": 1}
    for it in diagnostics.analyse(ds)["issues"]:
        if it["when"] != "now" or it["severity"] not in ("alarm", "warning") or it["well"] not in out:
            continue
        o = out[it["well"]]
        o["reasons"].append({"key": f"pb_{it['type']}_t", "level": it["severity"], **it["evidence"]})
        if rank[it["severity"]] < rank[o["status"]]:
            o["status"] = it["severity"]
    return out


def _day(v):
    try:
        return pd.Timestamp(v).normalize() if v else None
    except (ValueError, TypeError):
        return None


def overview(ds, start=None, end=None):
    """Field overview for a period (default: the whole dataset). "Today" = the last day of the period;
    the 30-day comparison may look before the period start. Well status/problems use all data."""
    from . import diagnostics
    s = store.shared()
    full = ds.preds.sort_values(["well_name", "date"])
    first_all, last_all = full.date.min(), full.date.max()
    a, b = _day(start) or first_all, _day(end) or last_all
    clip = lambda d: min(max(d, first_all), last_all)     # keep both ends inside the data
    a, b = clip(a), clip(b)
    if a > b:
        a, b = b, a
    p = full[(full.date >= a) & (full.date <= b)]
    if p.empty:                                   # nothing in the period: fall back to all data
        p, a, b = full, first_all, last_all
    last = p.date.max()
    status = well_status(ds)
    pta_rows = {r["well_name"]: r for r in pta_service.events(ds)}
    wells = []
    for w, g in p.groupby("well_name"):
        today = g[g.date == last].iloc[0]
        prod = g[g.shut_frac == 0]
        spark = prod                                  # the whole chosen period
        avg = g[T].mean()                             # average daily rate over the period (shut-in days count)
        avg_liq = avg.oil_rate_stbd + avg.water_rate_stbd
        # decline trend over the period; too few producing days -> use the whole history
        decline = diagnostics.decline_pct_yr(g if (prod.oil_rate_stbd > 0).sum() > 10 else full[full.well_name == w])
        liq = today.oil_rate_stbd + today.water_rate_stbd
        r = pta_rows.get(w)
        wells.append({
            "well": w, "manifold": str(s["comp"].loc[w, "production_manifold"]) if w in s["comp"].index else "?",
            "oil": float(today.oil_rate_stbd), "water": float(today.water_rate_stbd), "gas": float(today.gas_rate_mscfd),
            "wc": float(today.water_rate_stbd / liq * 100) if liq > 0 else None,
            "avg_oil": float(avg.oil_rate_stbd), "avg_water": float(avg.water_rate_stbd), "avg_gas": float(avg.gas_rate_mscfd),
            "avg_wc": float(avg.water_rate_stbd / avg_liq * 100) if avg_liq > 0 else None,
            "produced": bool((g.oil_rate_stbd > 0).any()),
            "spark": [round(float(v), 1) for v in spark.oil_rate_stbd],
            "decline_pct_yr": round(float(decline), 1),
            "cum_oil": float((g.oil_rate_stbd).sum()),
            "k": r["permeability_md"] if r else None, "skin": r["skin"] if r else None,
            **status[w]})
    tot = p[p.date == last][T].sum()
    prev = full[full.date == last - pd.Timedelta(days=30)][T].sum()
    # period averages (field total per day, averaged over the days), compared with the period of the
    # same length just before it; no comparison when the data does not reach back that far
    n_days = int((b - a).days) + 1
    avg = p.groupby("date")[T].sum().mean()
    pa, pb = a - pd.Timedelta(days=n_days), a - pd.Timedelta(days=1)
    pp = full[(full.date >= pa) & (full.date <= pb)]
    avg_prev = pp.groupby("date")[T].sum().mean() if pa >= first_all and not pp.empty else None
    alerts = []
    for w in wells:
        for rs in w["reasons"]:
            alerts.append({"well": w["well"], **rs})
    for e in lift_gas_events(ds):
        if a <= pd.Timestamp(e["start"]).normalize() <= b:
            alerts.append({"level": "warning", "well": None, "key": "ev_liftgas", **e})
    flags = p[(p.no_data) | (p.low_coverage & ~p.no_data)]
    if len(flags):
        alerts.append({"level": "info", "well": None, "key": "ev_datagaps", "n": int(len(flags))})
    for _, ev in ds.shut.iterrows():
        if not (a <= ev.shut_start.normalize() <= b):
            continue
        alerts.append({"level": "info", "well": ev.well_name, "key": "ev_shutin",
                       "start": ev.shut_start.isoformat(), "hours": round(float(ev.duration_hr), 1)})
    # field chart: one point per day, or one per HOUR for short periods (1 day would be a single dot)
    series = {"t": [str(x.date()) for x in sorted(p.date.unique())],
              **{k: [round(float(v), 1) for v in p.groupby("date")[k].sum().values] for k in T}, "hourly": False}
    if n_days <= HOURLY_MAX_DAYS:
        hs = _field_hourly(ds, p)
        if hs is not None:
            series = hs
    order = {"alarm": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: order[a["level"]])
    fastest = min(wells, key=lambda x: x["decline_pct_yr"])
    return {"date": str(last.date()), "wells": wells, "alerts": alerts,
            "range": {"start": str(a.date()), "end": str(b.date()), "first": str(first_all.date()), "last": str(last_all.date())},
            "totals": {k: float(v) for k, v in tot.items()},
            "totals_prev30": {k: float(v) for k, v in prev.items()},
            "days": n_days,
            "avg": {k: float(v) for k, v in avg.items()},
            "avg_prev": {k: float(v) for k, v in avg_prev.items()} if avg_prev is not None else None,
            "period_cum_oil": float(p.oil_rate_stbd.sum()),
            "fastest_decline": {"well": fastest["well"], "pct_yr": fastest["decline_pct_yr"]},
            "field_series": series}


HOURLY_MAX_DAYS = 7


def _field_hourly(ds, p):
    """Hourly field totals for the period: the hourly VFM of every well (each day scaled so its 24
    hours average to the daily VFM value, same as the VFM page), summed over wells."""
    from . import diagnostics
    a, b = p.date.min(), p.date.max()
    hours = pd.date_range(a, b + pd.Timedelta(hours=23), freq="h")
    tot = pd.DataFrame(0.0, index=hours, columns=T)
    for w, pw in p.groupby("well_name"):
        g = diagnostics.hourly_rates(ds, w, a, b + pd.Timedelta(days=1))     # one model run per well
        g = g.set_index("hour").reindex(hours) if len(g) else pd.DataFrame(index=hours, columns=T)
        daily = pw.set_index("date")[T].reindex(hours.normalize()).set_axis(hours)
        for k in T:
            raw = pd.to_numeric(g[k], errors="coerce")
            m = raw.groupby(hours.normalize()).transform("mean")
            scale = (daily[k] / m).where((m > 0) & np.isfinite(m), 1.0)
            # each day's 24 hours average to the daily VFM (as on the VFM page); hours with no
            # sensor data use the daily value so the field total does not dip
            tot[k] += (raw * scale).fillna(daily[k]).fillna(0).values
    return {"t": [x.strftime("%Y-%m-%d %H:%M") for x in tot.index], "hourly": True,
            **{k: [None if pd.isna(v) else round(float(v), 1) for v in tot[k].values] for k in T}}


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
