"""Problem detection (current, past and future) with root cause, solution and lost production.

Every rule compares a well with its OWN recent history, so it works on any dataset (preloaded
or uploaded). Each issue carries numbers ("evidence"); the page turns them into text in EN / AZ
using the keys pb_<type>_t (title), pb_<type>_c (root cause), pb_<type>_f (solution).

Lost production is returned in barrels / Mscf per day and cause; the page multiplies by the oil
and gas price the user enters, so changing a price needs no new request.
"""
from functools import lru_cache

import numpy as np
import pandas as pd

from . import store, pta_service

T = ["oil_rate_stbd", "water_rate_stbd", "gas_rate_mscfd"]
RECENT, BASE = 7, 30            # days: "now" window and the baseline before it
SEV_ORDER = {"alarm": 0, "warning": 1, "watch": 2, "info": 3}
WHEN_ORDER = {"now": 0, "future": 1, "past": 2}


# ------------------------------------------------------------------ hourly VFM (also used by the VFM page)
def hourly_rates(ds, well, start, end):
    """Run the trained VFM on hourly means of the cleaned 1-minute sensors between start and end.
    Shut-in hours produce 0. Returns hour, sensors, raw model rates, shut-in fraction."""
    s = store.shared()
    h = ds.hf[(ds.hf.well_name == well) & (ds.hf.timestamp >= start) & (ds.hf.timestamp < end)]
    if h.empty:
        return pd.DataFrame()
    h = h.assign(hour=h.timestamp.dt.floor("h"))
    cols = store.SENSORS + ["choke_opening_pct"]
    flowing = h[~h.shut_in].groupby("hour")[cols].mean()
    g = h.groupby("hour").agg(n=("shut_in", "size"), shut_frac=("shut_in", "mean")).join(flowing)
    g = g.reset_index()
    g["well_name"] = well
    g["t_mid"] = g.hour + pd.Timedelta(minutes=30)
    ok = g[store.SENSORS].notna().all(axis=1) & (g.shut_frac < 1)
    for k in T:
        g[k] = 0.0
    if ok.any():
        x = s["model"].prepare(g[ok], "t_mid", ds.daily)
        p = s["model"].predict(x)
        for k in T:
            g.loc[ok, k] = np.asarray(p[k]) * (1 - g.loc[ok, "shut_frac"].values)
    g.loc[~ok & (g.shut_frac < 1), T] = np.nan    # flowing but no sensor data
    return g


# ------------------------------------------------------------------ helpers
def _table(ds):
    """Daily sensors + VFM rates per well/day."""
    p = ds.preds[["date", "well_name"] + T]
    d = ds.daily.merge(p, on=["date", "well_name"], how="left").sort_values(["well_name", "date"])
    liq = d.oil_rate_stbd + d.water_rate_stbd
    d["wc_pct"] = np.where(liq > 0, d.water_rate_stbd / liq * 100, np.nan)
    d["gor"] = np.where(d.oil_rate_stbd > 0, d.gas_rate_mscfd / d.oil_rate_stbd, np.nan)   # Mscf/stb
    return d


def decline_pct_yr(g):
    """Exponential trend through log(oil) of producing days, % per year (negative = decline)."""
    prod = g[(g.shut_frac == 0) & (g.oil_rate_stbd > 0)]
    if len(prod) <= 10:
        return 0.0
    x = (prod.date - prod.date.iloc[0]).dt.days.values
    slope = np.polyfit(x, np.log(prod.oil_rate_stbd.clip(lower=1).values), 1)[0]
    return float((np.exp(slope * 365) - 1) * 100)


def _events(mask, dates, max_gap=2):
    """Group flagged days into (start, end) events, allowing gaps of up to max_gap days."""
    ev, cur = [], None
    for f, dt in zip(mask, dates):
        if not f:
            continue
        if cur and (dt - cur[1]).days <= max_gap + 1:
            cur[1] = dt
        else:
            if cur:
                ev.append(tuple(cur))
            cur = [dt, dt]
    if cur:
        ev.append(tuple(cur))
    return ev


def _r(v, n=1):
    return None if v is None or not np.isfinite(v) else round(float(v), n)


# ------------------------------------------------------------------ main
@lru_cache(maxsize=8)
def _analyse_cached(ds_id, created):
    return _analyse(store.get(ds_id))


def analyse(ds):
    """Cached per dataset: {issues: [...], losses: [{well, date, cause, oil_stb, gas_mscf}]}."""
    return _analyse_cached(ds.id, ds.created)


def _analyse(ds):
    from . import insights            # lazy: insights imports this module too
    s = store.shared()
    d = _table(ds)
    last = d.date.max()
    issues, losses = [], []

    def add(**kw):
        kw.setdefault("evidence", {})
        kw.setdefault("loss_oil_stb", 0.0)
        kw.setdefault("loss_oil_stbd_now", 0.0)
        issues.append(kw)

    def lose(well, date, cause, oil, gor):
        if oil > 0:
            losses.append({"issue": len(issues), "well": well, "date": str(pd.Timestamp(date).date()), "cause": cause,
                           "oil_stb": float(oil), "gas_mscf": float(oil * (gor if np.isfinite(gor) else 0))})

    pta_rows = {r["well_name"]: r for r in pta_service.events(ds)}

    for w, g in d.groupby("well_name"):
        g = g.reset_index(drop=True)
        prod = g[(g.shut_frac == 0) & ~g.no_data]
        rec = prod[prod.date > last - pd.Timedelta(days=RECENT)]
        base = prod[(prod.date <= last - pd.Timedelta(days=RECENT)) & (prod.date > last - pd.Timedelta(days=RECENT + BASE))]
        gor_w = float(prod.gor.median()) if len(prod) else np.nan
        pb = float(s["pvt"].loc[w, "bubble_point_pressure_psia"]) if w in s["pvt"].index else np.nan
        med = lambda x, c: float(x[c].median()) if len(x) else np.nan

        # 1. formation damage (from the build-up test)
        r = pta_rows.get(w)
        if r and r["skin"] is not None and r["skin"] > 1.5 and r.get("flow_efficiency") and r["flow_efficiency"] < 1:
            fe = r["flow_efficiency"]
            t0 = pd.Timestamp(r["shut_in_start"]).normalize()
            lost = 0.0
            for _, row in g[g.date >= t0].iterrows():
                q = row.oil_rate_stbd if np.isfinite(row.oil_rate_stbd) else 0
                lo = q * (1 / fe - 1)
                lose(w, row.date, "damage", lo, row.gor if np.isfinite(row.gor) else gor_w)
                lost += lo
            q_now = med(rec, "oil_rate_stbd")
            add(well=w, type="damage", severity="alarm" if r["skin"] > 5 else "warning", when="now",
                start=str(t0.date()), end=None, loss_oil_stb=lost,
                loss_oil_stbd_now=q_now * (1 / fe - 1) if np.isfinite(q_now) else 0,
                evidence={"skin": _r(r["skin"], 2), "fe": _r(fe * 100, 0), "dp_skin": _r(r["dp_skin_psi"], 0),
                          "gain": _r(q_now * (1 / fe - 1), 0)})

        # 2. downtime (shut-in days)
        down = g.shut_frac.fillna(0) > 0
        for a, b in _events(down.values, g.date, max_gap=0):
            before = prod[prod.date < a].tail(7)
            q_b = med(before, "oil_rate_stbd")
            if not np.isfinite(q_b):
                continue
            lost, hours = 0.0, 0.0
            for _, row in g[(g.date >= a) & (g.date <= b)].iterrows():
                lo = q_b * row.shut_frac
                lose(w, row.date, "downtime", lo, gor_w)
                lost += lo
                hours += row.shut_frac * 24
            ongoing = b >= last
            add(well=w, type="downtime", severity="warning" if (ongoing or hours > 24) else "info",
                when="now" if ongoing else "past", start=str(a.date()), end=str(b.date()), loss_oil_stb=lost,
                loss_oil_stbd_now=q_b if ongoing else 0,
                evidence={"hours": _r(hours, 0), "q": _r(q_b, 0)})

        # 3. production cut back by the choke (deferred production)
        roll = prod[["oil_rate_stbd", "choke_opening_pct"]].shift(1).rolling(14, min_periods=7).median()
        cut = (prod.choke_opening_pct < roll.choke_opening_pct - 2) & (prod.oil_rate_stbd < 0.97 * roll.oil_rate_stbd)
        for a, b in _events(cut.values, prod.date):
            seg = prod[(prod.date >= a) & (prod.date <= b)]
            rb = roll.loc[seg.index]
            lo_day = (rb.oil_rate_stbd - seg.oil_rate_stbd).clip(lower=0)
            lost = float(lo_day.sum())
            if lost < 50:          # ignore tiny adjustments
                continue
            for (_, row), lo in zip(seg.iterrows(), lo_day):
                lose(w, row.date, "choke", lo, row.gor)
            ongoing = b > last - pd.Timedelta(days=RECENT)
            add(well=w, type="choke", severity="warning" if ongoing else "info", when="now" if ongoing else "past",
                start=str(a.date()), end=str(b.date()), loss_oil_stb=lost,
                loss_oil_stbd_now=max(float(rb.oil_rate_stbd.iloc[-1] - seg.oil_rate_stbd.iloc[-1]), 0) if ongoing else 0,
                evidence={"from": _r(float(rb.choke_opening_pct.iloc[0]), 0), "to": _r(float(seg.choke_opening_pct.min()), 0),
                          "dq": _r(float((rb.oil_rate_stbd - seg.oil_rate_stbd).mean()), 0)})

        if len(rec) and len(base):
            # 4. water breakthrough / coning (now)
            dwc = med(rec, "wc_pct") - med(base, "wc_pct")
            if dwc > 3:
                add(well=w, type="water", severity="alarm" if dwc > 8 else "warning", when="now",
                    start=str(rec.date.min().date()), end=None,
                    evidence={"wc": _r(med(rec, "wc_pct")), "dwc": _r(dwc)})
            # 5. gas coming out of solution near the well
            pwf = med(rec, "dh_pressure_psia")
            if np.isfinite(pb) and pwf < 1.1 * pb:
                add(well=w, type="gasbreak", severity="alarm" if pwf < pb else "warning", when="now",
                    start=str(rec.date.min().date()), end=None,
                    evidence={"pwf": _r(pwf, 0), "pb": _r(pb, 0), "dgor": _r((med(rec, "gor") / med(base, "gor") - 1) * 100)})
            # 6. flow restriction (scale / wax / hydrate)
            whp_r, whp_b = med(rec, "whp_psia"), med(base, "whp_psia")
            if (whp_r > 1.08 * whp_b and abs(med(rec, "choke_opening_pct") - med(base, "choke_opening_pct")) < 1
                    and med(rec, "oil_rate_stbd") < 0.95 * med(base, "oil_rate_stbd")):
                dq = med(base, "oil_rate_stbd") - med(rec, "oil_rate_stbd")
                add(well=w, type="restriction", severity="warning", when="now", start=str(rec.date.min().date()), end=None,
                    loss_oil_stbd_now=dq, evidence={"dwhp": _r(whp_r - whp_b, 0), "dq": _r(dq, 0)})
            # 7. lift gas lost on this well only
            lr, lb = med(rec, "gas_lift_rate_mscfd"), med(base, "gas_lift_rate_mscfd")
            if lb > 0 and lr < 0.8 * lb:
                add(well=w, type="liftwell", severity="warning", when="now", start=str(rec.date.min().date()), end=None,
                    evidence={"lift": _r(lr, 0), "lift_b": _r(lb, 0), "ddhp": _r(med(rec, "dh_pressure_psia") - med(base, "dh_pressure_psia"), 0)})

        # 8. gauge / telemetry problems
        gaps = g[(g.no_data | g.low_coverage) & (g.shut_frac < 1)]
        recent_gaps = gaps[gaps.date > last - pd.Timedelta(days=BASE)]
        if len(recent_gaps):
            ongoing = recent_gaps.date.max() > last - pd.Timedelta(days=RECENT)
            add(well=w, type="gauge", severity="warning" if ongoing else "info", when="now" if ongoing else "past",
                start=str(recent_gaps.date.min().date()), end=str(recent_gaps.date.max().date()),
                evidence={"days": len(recent_gaps)})

        # ---------------- future
        p60 = prod[prod.date > last - pd.Timedelta(days=60)]
        if len(p60) > 20:
            x = (p60.date - last).dt.days.values
            # 9. Pwf heading for the bubble point
            sl = np.polyfit(x, p60.dh_pressure_psia.values, 1)[0]
            pwf = med(rec, "dh_pressure_psia")
            if np.isfinite(pb) and sl < 0 and pwf > pb:
                days = (pwf - pb) / -sl
                if days < 365:
                    add(well=w, type="pbfuture", severity="warning" if days < 90 else "watch", when="future",
                        start=str((last + pd.Timedelta(days=int(days))).date()), end=None,
                        evidence={"days": _r(days, 0), "pwf": _r(pwf, 0), "pb": _r(pb, 0), "rate": _r(sl * 30, 1)})
        # 10. water cut trend
        if len(prod) > 30:
            x = (prod.date - prod.date.iloc[0]).dt.days.values
            sl = np.polyfit(x, prod.wc_pct.values, 1)[0] * 30          # points / month
            wc_now = med(rec, "wc_pct")
            if sl * 6 >= 5:
                add(well=w, type="wcfuture", severity="watch", when="future", start=None, end=None,
                    evidence={"wc": _r(wc_now), "wc6": _r(wc_now + sl * 6), "rate": _r(sl, 2)})
        # 11. fast decline
        dec = decline_pct_yr(g)
        q_now = med(rec, "oil_rate_stbd")
        if dec < -25 and np.isfinite(q_now):
            q90 = q_now * (1 + dec / 100) ** (90 / 365)
            add(well=w, type="decline", severity="watch", when="future", start=None, end=None,
                evidence={"dec": _r(dec, 0), "q": _r(q_now, 0), "q90": _r(q90, 0), "dq90": _r(q_now - q90, 0)})

    # 12. field-wide lift-gas outages: hourly VFM during the event vs the 3 hours before
    for e in insights.lift_gas_events(ds):
        t0, t1 = pd.Timestamp(e["start"]), pd.Timestamp(e["end"]) + pd.Timedelta(minutes=30)
        lost_all, wells = 0.0, []
        for w in ds.wells():
            hr = hourly_rates(ds, w, t0 - pd.Timedelta(hours=3), t1 + pd.Timedelta(hours=1))
            if hr.empty:
                continue
            before = hr[hr.hour < t0.floor("h")].oil_rate_stbd
            during = hr[(hr.hour >= t0.floor("h")) & (hr.hour < t1)].oil_rate_stbd
            if before.isna().all() or during.isna().all():
                continue
            lo = float((before.mean() - during).clip(lower=0).sum() / 24)      # stb (rates are per day)
            if lo > 0.5:
                gor_w = float(d[d.well_name == w].gor.median())
                lose(w, t0.normalize(), "liftgas", lo, gor_w)
                lost_all += lo
                wells.append(w)
        add(well=None, type="liftfield", severity="warning", when="past", start=e["start"], end=e["end"],
            loss_oil_stb=lost_all,
            evidence={"pct": _r(e["min_change_pct"], 0), "wells": e["wells"],
                      "hours": _r((t1 - t0).total_seconds() / 3600, 1), "lost": _r(lost_all, 0)})

    gas_by_issue = pd.Series({}, dtype=float)
    if losses:
        gas_by_issue = pd.DataFrame(losses).groupby("issue").gas_mscf.sum()
    gor_well = d.groupby("well_name").gor.median()
    for i, it in enumerate(issues):
        it["id"] = i
        it["loss_gas_mscf"] = round(float(gas_by_issue.get(i, 0.0)), 1)
        g = gor_well.get(it["well"], np.nan) if it["well"] else np.nan
        it["gor"] = None if not np.isfinite(g) else round(float(g), 4)
        it["loss_oil_stb"] = round(float(it["loss_oil_stb"]), 1)
        it["loss_oil_stbd_now"] = round(float(it["loss_oil_stbd_now"] or 0), 1)
    issues.sort(key=lambda x: (WHEN_ORDER[x["when"]], SEV_ORDER[x["severity"]], -x["loss_oil_stb"]))
    return {"date": str(last.date()), "issues": issues, "losses": losses}


def problems(ds):
    """Payload for the Problems page: issues + daily loss table + per-well gas/oil ratio."""
    a = analyse(ds)
    lo = pd.DataFrame(a["losses"], columns=["issue", "well", "date", "cause", "oil_stb", "gas_mscf"])
    daily = lo.groupby(["date", "cause"])[["oil_stb", "gas_mscf"]].sum().round(2).reset_index()
    by_well = lo.groupby(["well", "cause"])[["oil_stb", "gas_mscf"]].sum().round(1).reset_index()
    return {"date": a["date"], "wells": ds.wells(), "issues": a["issues"],
            "loss_daily": daily.to_dict(orient="records"), "loss_by_well": by_well.to_dict(orient="records"),
            "period": {"start": str(ds.preds.date.min().date()), "end": a["date"]}}


def export_xlsx(ds, oil_price, gas_price, path):
    a = analyse(ds)
    iss = pd.DataFrame([{**{k: v for k, v in i.items() if k != "evidence"},
                         **{f"ev_{k}": v for k, v in i["evidence"].items()}} for i in a["issues"]])
    lo = pd.DataFrame(a["losses"], columns=["issue", "well", "date", "cause", "oil_stb", "gas_mscf"]).drop(columns="issue")
    lo["usd"] = lo.oil_stb * oil_price + lo.gas_mscf * gas_price
    if len(iss):
        iss["loss_usd"] = iss.loss_oil_stb * oil_price + iss.loss_gas_mscf * gas_price
    summ = lo.groupby(["well", "cause"])[["oil_stb", "gas_mscf", "usd"]].sum().round(0).reset_index()
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        iss.to_excel(xw, sheet_name="issues", index=False)
        summ.to_excel(xw, sheet_name="loss_by_well_cause", index=False)
        lo.round(2).to_excel(xw, sheet_name="loss_daily", index=False)
        pd.DataFrame({"item": ["oil price $/bbl", "gas price $/Mscf", "loss method"],
                      "value": [oil_price, gas_price,
                                "damage: q*(1/FE-1) since the build-up test; downtime: 7-day rate before x hours shut; "
                                "choke: 14-day baseline - actual; lift-gas outage: hourly VFM vs 3 h before"]}
                     ).to_excel(xw, sheet_name="assumptions", index=False)
