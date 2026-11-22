"""Nova: the PetroNova chat assistant.

How it works (no vector database needed):
- Numbers come from TOOLS: small functions that call the same code the app pages use
  (overview, problems, PTA, VFM, what-if, daily data). Claude decides which tool to call,
  reads the real numbers and then answers. It is told never to invent numbers.
- Text knowledge (how the app works) comes from METHODOLOGY.md and README.md, which are short
  enough to send in full with every question (cached by the API, so it is cheap).
- Needs internet and ANTHROPIC_API_KEY (in the environment or in a .env file in the project folder).
  Without a key the rest of the app works as before and Nova says it is not set up.
"""
import json
import math
import os
import re
import threading
import time
from collections import deque
from pathlib import Path

import numpy as np
import pandas as pd

from . import store, insights, views, diagnostics, pta_service

ROOT = Path(__file__).resolve().parents[2]

try:  # a .env file is optional: the key can also come from the host's environment
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

MODEL = os.environ.get("NOVA_MODEL", "claude-opus-5-5")
MAX_TURNS = 12            # messages kept from the conversation (older ones are dropped)
MAX_CHARS = 4000          # longest question accepted
MAX_TOOL_ROUNDS = 8       # how many tool rounds Nova may use for one answer
RATE_PER_IP = (30, 600)   # 30 questions per 10 minutes per visitor (the online copy is public)
RATE_GLOBAL = (600, 86400)  # 600 questions per day in total (protects the API bill)

T = ["oil_rate_stbd", "water_rate_stbd", "gas_rate_mscfd"]
SENSOR_COLS = ["whp_psia", "whp_downstream_psia", "dh_pressure_psia", "dh_temperature_degf",
               "annulus_pressure_psia", "gas_lift_rate_mscfd", "choke_opening_pct",
               "whp_dp", "lift_dp", "annulus_minus_whp"]
COLUMNS = T + ["water_cut_pct", "liquid_rate_stbd"] + SENSOR_COLS
LANGS = {"en": "English", "az": "Azerbaijani", "ru": "Russian"}


def available():
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


_client = None


def _get_client():
    global _client
    if _client is None:
        import anthropic
        # fixed address: ignore an ANTHROPIC_BASE_URL left in the shell by other tools
        _client = anthropic.Anthropic(base_url=os.environ.get("NOVA_BASE_URL") or "https://api.anthropic.com",
                                      timeout=120.0, max_retries=2)
    return _client


# ------------------------------------------------------------------ rate limit
_hits, _all_hits, _lock = {}, deque(), threading.Lock()


def allow(ip):
    """True if this visitor may ask another question now."""
    now = time.time()
    with _lock:
        n, win = RATE_GLOBAL
        while _all_hits and _all_hits[0] < now - win:
            _all_hits.popleft()
        if len(_all_hits) >= n:
            return False
        q = _hits.setdefault(ip, deque())
        n, win = RATE_PER_IP
        while q and q[0] < now - win:
            q.popleft()
        if len(q) >= n:
            return False
        q.append(now)
        _all_hits.append(now)
        return True


# ------------------------------------------------------------------ system prompt
def _problem_glossary():
    """English problem / alert texts from i18n.js, so Nova can explain the problem codes."""
    try:
        js = (ROOT / "app/static/js/i18n.js").read_text(encoding="utf-8")
        en = js.split("\n  az: {")[0]
        rows = re.findall(r'\b((?:pb|ev)_\w+): "((?:[^"\\]|\\.)*)"', en)
        return "\n".join(f"{k}: {v}" for k, v in rows)
    except OSError:
        return ""


def _doc(name):
    try:
        return (ROOT / name).read_text(encoding="utf-8")
    except OSError:
        return ""


_STATIC = None


def _static_prompt():
    global _STATIC
    if _STATIC is None:
        _STATIC = f"""You are Nova, the assistant inside PetroNova, a well-performance web app built for SOCAR.
The people asking are petroleum and production engineers. They want short, correct, practical answers.

Your personality: warm, friendly and upbeat, like a helpful colleague on the rig. You wear a SOCAR hard
hat and care about safety; you may call the user "comrade" now and then ("yoldaş" in Azerbaijani,
"товарищ" in Russian) and add a light touch of humour,
but never let friendliness get in the way of accuracy. Greet briefly only when the user greets you.

You answer three kinds of questions:
1. About the loaded data (wells, rates, pressures, problems, PTA, VFM, scenarios): use the tools.
2. About the PetroNova website itself (what a page shows, where to find something, how to use it):
   use the WEBSITE GUIDE, METHODOLOGY and README below.
3. General questions (petroleum engineering, science, how things work, everyday questions): answer from
   your own knowledge in the same friendly way.

How to answer
- For any question about this field's data, wells, rates, pressures, problems, PTA or VFM results or
  scenarios: call the tools first and answer only from what they return. Never invent or estimate a
  number that a tool did not give you. If the tools cannot answer, say so plainly and suggest which
  app page could help.
- For general petroleum-engineering questions (definitions, theory, typical practice) you may answer
  from your own knowledge; say briefly when an answer is general and not from this field's data.
- For questions about how PetroNova works or how to use it, use the WEBSITE GUIDE, METHODOLOGY and README below.
- Mention the well, the date or period, and the units with every number. The tools use field units:
  stb/d for oil and water, Mscf/d for gas, psia for pressure, degF for temperature, % for choke.
  A pressure difference or drop (drawdown, skin pressure drop) is in psi, not psia.
- If the user says "this well", use the well in the page context. If no well is in context, ask which well.
- "Today", "now" or "this month" mean the latest data in the dataset, not the real calendar date.
- Keep answers short: a direct answer first, then at most a few bullet points. No markdown tables
  and no headings. Use **bold** only for the key number or conclusion.
- Reply in the language the user writes in. If unclear, use the app language from the page context.
  Keep well names, units and code names (like pb_damage_t) as they are.
- Results are model estimates (virtual flow meter, build-up interpretation). When it matters for a
  decision, remind the user to confirm with a well test.

Field facts
- 10 gas-lifted wells (GL-01 ... GL-10). Rates are estimated daily by the VFM model from downhole and
  wellhead sensors, choke and lift gas. PTA results come from automatic build-up analysis of shut-ins.
- Problem and alert codes returned by the tools (key -> English text; {{x}} are filled from the result):
{_problem_glossary()}

===== WEBSITE GUIDE =====
Top bar (appears when the mouse moves to the top of the window): Home, Overview, Sensors, VFM, PTA,
Problems, What-if; the Units menu (psi/bar/kPa..., °F/°C, stb/d / m³/d / t/d) and the language switch
EN / AZ / RU. Below the page title: the Dataset selector (preloaded SOCAR data, short demo samples of
1/7/30/90 days, or your own uploads; its last entry "+ Import new data" opens the Import page) and, on
pages about one well, the Well selector.
- Home: the PetroNova story, plus model validation and physics checks of the VFM model.
- Overview ("All wells at a glance"): pick a period (dates or 1d/7d/30d/90d/All); field oil, water and gas
  per day vs the previous period, a field chart, a card per well (rates, water cut, decline, k and skin,
  status) and the alert list. Click a well to open its Well profile.
- Sensors: high-frequency measurements of one well (wellhead and downhole pressure and temperature,
  annulus pressure, lift gas, choke) at 15-minute steps.
- VFM (virtual flow meter): daily oil, water and gas of one well estimated from sensors, compared with
  well tests; click a day to see hourly rates.
- PTA (pressure transient analysis): automatic build-up interpretation of each shut-in: log-log and
  derivative plot, Horner plot, permeability, skin, reservoir pressure, quality grade. You can drag a
  manual radial-flow window to re-fit. Shut-ins that could not be analysed are listed with the reason.
- Problems & financial loss: current and past issues (formation damage, choke changes, lift-gas
  problems, data gaps...), root cause, suggested fix, and lost oil/gas turned into money with editable
  oil and gas prices.
- What-if: sliders for choke opening (±10 points) and lift-gas rate (±50 %) on one well, showing the
  expected oil, water and gas change from a physics-based model.
- Well profile: completion, PVT/reservoir data, latest PTA result and recent performance of one well.
- Import: upload a high-frequency sensor file (CSV or Excel; columns timestamp, well_name, whp_psia,
  whp_downstream_psia, dh_pressure_psia, dh_temperature_degf, annulus_pressure_psia, gas_lift_rate_mscfd)
  and optionally a choke file (timestamp, well_name, choke_opening_pct). It is cleaned, run through VFM and
  PTA and becomes a new dataset.
- Export: download VFM daily predictions (Excel), PTA results (Excel), PTA plots (zip) and the problems
  and losses table (Excel).
- Nova (you): the round avatar with the hard hat in the bottom-right corner of every page.

===== METHODOLOGY.md =====
{_doc("METHODOLOGY.md")}

===== README.md =====
{_doc("README.md")}
"""
    return _STATIC


# ------------------------------------------------------------------ helpers for tool results
def _num(v, nd=2):
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        v = float(v)
        if not math.isfinite(v):
            return None
        return round(v, nd) if abs(v) >= 1 or v == 0 else float(f"{v:.3g}")
    return v


def _tidy(o):
    if isinstance(o, dict):
        return {str(k): _tidy(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_tidy(v) for v in o]
    if isinstance(o, (pd.Timestamp,)):
        return o.isoformat()
    if hasattr(o, "item") and not isinstance(o, (str, bytes)):
        try:
            o = o.item()
        except (ValueError, AttributeError):
            pass
    return _num(o)


def _out(o, limit=24000):
    s = json.dumps(_tidy(o), ensure_ascii=False, default=str)
    if len(s) > limit:
        s = s[:limit] + ' ... [cut: ask for a shorter period or one well]'
    return s


def _date(v, name):
    if not v:
        return None
    try:
        return pd.Timestamp(v).normalize()
    except (ValueError, TypeError):
        raise ValueError(f"{name} '{v}' is not a date; use YYYY-MM-DD")


def _check_well(ds, well):
    w = (well or "").strip().upper()
    if w not in ds.wells():
        raise ValueError(f"unknown well '{well}'. Wells in this dataset: {', '.join(ds.wells())}")
    return w


def _table(ds):
    """Daily table: VFM rates joined with daily sensor averages, one row per well and day."""
    p = ds.preds[["date", "well_name", "shut_frac", "no_data"] + T]
    d = ds.daily[["date", "well_name"] + SENSOR_COLS]
    t = p.merge(d, on=["date", "well_name"], how="left")
    t["liquid_rate_stbd"] = t.oil_rate_stbd + t.water_rate_stbd
    t["water_cut_pct"] = np.where(t.liquid_rate_stbd > 0, t.water_rate_stbd / t.liquid_rate_stbd * 100, np.nan)
    return t


# ------------------------------------------------------------------ tools
def _make_tools(ds):
    from anthropic import beta_tool

    @beta_tool
    def dataset_summary() -> str:
        """Which dataset is loaded: its period (first and last day), well names, number of shut-ins,
        and the data-cleaning log (what was removed or filled)."""
        s = ds.summary()
        s["cleaning"] = json.dumps(_tidy(s.get("cleaning")), default=str)[:3000]
        return _out(s)

    @beta_tool
    def field_overview(start: str = "", end: str = "") -> str:
        """Field overview for a period, like the Overview page: per-well rates on the last day and period
        averages, water cut, decline %/year, cumulative oil, k and skin from PTA, well status, and the
        alert list (problem codes, lift-gas drops, shut-ins, data gaps). Field totals and averages vs the
        previous period of the same length.

        Args:
            start: First day YYYY-MM-DD. Empty = start of the data.
            end: Last day YYYY-MM-DD. Empty = end of the data.
        """
        _date(start, "start"), _date(end, "end")
        o = insights.overview(ds, start or None, end or None)
        o.pop("field_series", None)
        for w in o["wells"]:
            w.pop("spark", None)
        o["alerts"] = o["alerts"][:60]
        return _out(o)

    @beta_tool
    def well_info(well: str) -> str:
        """One well: completion data, PVT, latest PTA result (k, skin, pressures), shut-ins that could not
        be analysed, rates on the last day, 7-day average sensor readings, and the drawdown used.

        Args:
            well: Well name, e.g. GL-03.
        """
        return _out(views.well_info(ds, _check_well(ds, well)))

    @beta_tool
    def daily_data(well: str, column: str, start: str = "", end: str = "", resolution: str = "summary") -> str:
        """Daily values of one quantity for one well (or the whole field), from the VFM rates and
        daily sensor averages. Use it for trends, "when did X change", min/max and averages.

        Args:
            well: Well name, e.g. GL-03, or FIELD for the field total (rates only).
            column: One of oil_rate_stbd, water_rate_stbd, gas_rate_mscfd, liquid_rate_stbd, water_cut_pct,
                whp_psia, whp_downstream_psia, dh_pressure_psia, dh_temperature_degf, annulus_pressure_psia,
                gas_lift_rate_mscfd, choke_opening_pct, whp_dp, lift_dp, annulus_minus_whp.
            start: First day YYYY-MM-DD. Empty = start of the data.
            end: Last day YYYY-MM-DD. Empty = end of the data.
            resolution: summary (mean, min, max with dates, first/last values, change), daily, weekly or monthly.
        """
        if column not in COLUMNS:
            raise ValueError(f"unknown column '{column}'. Use one of: {', '.join(COLUMNS)}")
        t = _table(ds)
        a, b = _date(start, "start"), _date(end, "end")
        if a is not None:
            t = t[t.date >= a]
        if b is not None:
            t = t[t.date <= b]
        if (well or "").strip().upper() == "FIELD":
            if column not in T + ["liquid_rate_stbd", "water_cut_pct"]:
                raise ValueError("FIELD works for rates and water cut only; ask per well for sensors")
            g = t.groupby("date")[T + ["liquid_rate_stbd"]].sum().reset_index()
            g["water_cut_pct"] = np.where(g.liquid_rate_stbd > 0, g.water_rate_stbd / g.liquid_rate_stbd * 100, np.nan)
            g["shut_frac"] = 0.0
            label = "FIELD"
        else:
            label = _check_well(ds, well)
            g = t[t.well_name == label]
        g = g.sort_values("date")
        if g.empty:
            return _out({"well": label, "column": column, "error": "no data in this period"})
        s = g.set_index("date")[column]
        info = {"well": label, "column": column, "period": [str(g.date.min().date()), str(g.date.max().date())],
                "days": int(len(g)), "shut_in_days": int((g.shut_frac >= 1).sum())}
        v = s.dropna()
        if resolution == "summary" or v.empty:
            if not v.empty:
                info.update({"mean": v.mean(), "min": v.min(), "min_date": str(v.idxmin().date()),
                             "max": v.max(), "max_date": str(v.idxmax().date()),
                             "first": v.iloc[0], "last": v.iloc[-1], "change": v.iloc[-1] - v.iloc[0]})
                if column in T:
                    info["cumulative"] = v.sum()
            return _out(info)
        rule = {"daily": None, "weekly": "W", "monthly": "MS"}.get(resolution)
        if resolution not in ("daily", "weekly", "monthly"):
            raise ValueError("resolution must be summary, daily, weekly or monthly")
        if rule:
            v = v.resample(rule).mean().dropna()
        if len(v) > 200:
            raise ValueError(f"{len(v)} points is too many; use a shorter period or weekly/monthly")
        info["values"] = {str(k.date()): x for k, x in v.items()}
        return _out(info)

    @beta_tool
    def compare_wells(column: str, start: str = "", end: str = "") -> str:
        """Average of one quantity for every well over a period, sorted high to low. Use it for
        "which well has the highest/lowest ...". Shut-in days are left out of the average.

        Args:
            column: Same names as in daily_data, e.g. water_cut_pct or oil_rate_stbd.
            start: First day YYYY-MM-DD. Empty = start of the data.
            end: Last day YYYY-MM-DD. Empty = end of the data.
        """
        if column not in COLUMNS:
            raise ValueError(f"unknown column '{column}'. Use one of: {', '.join(COLUMNS)}")
        t = _table(ds)
        a, b = _date(start, "start"), _date(end, "end")
        if a is not None:
            t = t[t.date >= a]
        if b is not None:
            t = t[t.date <= b]
        t = t[t.shut_frac < 1]
        m = t.groupby("well_name")[column].mean().sort_values(ascending=False)
        return _out({"column": column, "period": [str(t.date.min().date()), str(t.date.max().date())] if len(t) else None,
                     "average_by_well": {k: v for k, v in m.items()}})

    @beta_tool
    def vfm_vs_well_tests(well: str) -> str:
        """VFM model check for one well: the well-test rates measured in this period and the model's
        global validation / physics-check numbers, plus total oil, water and gas in the period.

        Args:
            well: Well name, e.g. GL-03.
        """
        v = views.vfm(ds, _check_well(ds, well))
        tests = v["tests"]
        rows = [{"time": t, **{k: tests[k][i] for k in T}} for i, t in enumerate(tests["t"])]
        pred = dict(zip(v["t"], zip(*[v[k] for k in T])))
        for r in rows:
            p = pred.get(r["time"][:10])
            if p:
                r["vfm_same_day"] = dict(zip(T, p))
        return _out({"well": v["well"], "well_tests": rows, "period_totals": v["period"], "model_diag": v["diag"]})

    @beta_tool
    def model_validation() -> str:
        """How accurate the VFM model is overall: the validation table (error vs well tests) and the
        physics checks of model v1 vs v2."""
        return _out(views.model_checks())

    @beta_tool
    def problems() -> str:
        """The Problems page: every detected issue (type, well, severity, now/past, start/end, oil and gas
        lost, evidence numbers) and lost oil/gas by well and cause."""
        p = diagnostics.problems(ds)
        lo = pd.DataFrame(p["loss_daily"])
        p["loss_by_cause"] = lo.groupby("cause")[["oil_stb", "gas_mscf"]].sum().round(1).to_dict(orient="index") if len(lo) else {}
        p.pop("loss_daily", None)
        p["issues"] = p["issues"][:60]
        return _out(p)

    @beta_tool
    def pta_results(well: str = "") -> str:
        """Pressure-transient (build-up) results for every analysed shut-in: permeability k (md), skin,
        skin pressure drop, average reservoir pressure, quality grade, late-time behaviour. Also the
        shut-ins that could NOT be analysed and why. `idx` identifies a shut-in for pta_detail.

        Args:
            well: Optional well name to filter, e.g. GL-03. Empty = all wells.
        """
        ev, sk = pta_service.events(ds), pta_service.skipped(ds)
        if well:
            w = _check_well(ds, well)
            ev = [r for r in ev if r["well_name"] == w]
            sk = [r for r in sk if r["well_name"] == w]
        return _out({"analysed": ev, "not_analysed": sk})

    @beta_tool
    def pta_detail(idx: int) -> str:
        """Full interpretation of one analysed shut-in (from pta_results `idx`): results, automatic radial
        window, quality, late-time behaviour and interpretation codes.

        Args:
            idx: Shut-in index from pta_results.
        """
        if not 0 <= idx < len(ds.shut):
            raise ValueError(f"idx must be between 0 and {len(ds.shut) - 1}")
        d = pta_service.detail(ds, idx)
        for k in ("history", "loglog", "horner"):
            d.pop(k, None)
        return _out(d)

    @beta_tool
    def whatif(well: str, choke_change_points: float = 0.0, lift_gas_change_pct: float = 0.0) -> str:
        """What-if scenario like the What-if page: change the choke opening and/or the gas-lift rate of one
        well and get the expected oil, water and gas rates vs the last 7 producing days.

        Args:
            well: Well name, e.g. GL-03.
            choke_change_points: Change of choke opening in percentage points, -10 to +10
                (e.g. 36% -> 41% is +5). The current opening is in the result (choke0).
            lift_gas_change_pct: Change of gas-lift rate in percent of the current rate, -50 to +50.
        """
        w = _check_well(ds, well)
        c = float(choke_change_points or 0)
        l_ = float(lift_gas_change_pct or 0)
        notes = []
        if not -10 <= c <= 10:
            notes.append("choke change was limited to +-10 points (model range)")
        if not -50 <= l_ <= 50:
            notes.append("lift-gas change was limited to +-50 % (model range)")
        r = insights.whatif(ds, w, max(-10, min(10, c)), max(-50, min(50, l_)))
        r["limits"] = notes
        return _out(r)

    return [dataset_summary, field_overview, well_info, daily_data, compare_wells, vfm_vs_well_tests,
            model_validation, problems, pta_results, pta_detail, whatif]


# ------------------------------------------------------------------ chat
class NovaError(Exception):
    def __init__(self, code, msg, status=500):
        super().__init__(msg)
        self.code, self.status = code, status


def _clean_history(messages):
    out = []
    for m in (messages or [])[-MAX_TURNS:]:
        role, text = m.get("role"), str(m.get("content") or "").strip()
        if role not in ("user", "assistant") or not text:
            continue
        text = text[:MAX_CHARS]
        if out and out[-1]["role"] == role:          # keep roles alternating
            out[-1]["content"] += "\n\n" + text
        else:
            out.append({"role": role, "content": text})
    while out and out[0]["role"] != "user":
        out.pop(0)
    if not out or out[-1]["role"] != "user":
        raise NovaError("bad_request", "the last message must be a question", 400)
    return out


def chat(ds, messages, page="", well="", lang="en"):
    """Answer the last user message. Returns {"answer": str, "tools": [tool names used]}."""
    if not available():
        raise NovaError("not_configured", "Nova is not set up: ANTHROPIC_API_KEY is missing", 503)
    import anthropic

    msgs = _clean_history(messages)
    s = ds.summary()
    ctx = (f"Page context: the user is on the '{page or 'home'}' page. App language: {LANGS.get(lang, 'English')}. "
           f"Dataset: {s['label']} ({s['source']}), data from {s['start']} to {s['end']}, wells {', '.join(s['wells'])}. "
           + (f"Selected well on this page: {well}." if well else "No well is selected on this page."))
    system = [{"type": "text", "text": _static_prompt(), "cache_control": {"type": "ephemeral"}},
              {"type": "text", "text": ctx}]
    # server-side refusal fallback exists for Opus / Sonnet / Fable, not for Haiku
    extra = ({"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
             if not MODEL.startswith("claude-haiku") else {})
    try:
        runner = _get_client().beta.messages.tool_runner(
            model=MODEL, max_tokens=16000, system=system, messages=msgs, tools=_make_tools(ds),
            output_config={"effort": "low"}, max_iterations=MAX_TOOL_ROUNDS, **extra)
        used, final = [], None
        for message in runner:
            final = message
            used += [b.name for b in message.content if b.type == "tool_use"]
    except anthropic.AuthenticationError:
        raise NovaError("bad_key", "the API key was rejected", 502)
    except anthropic.PermissionDeniedError:
        raise NovaError("bad_key", "the API key has no access to this model", 502)
    except anthropic.RateLimitError:
        raise NovaError("busy", "the AI service is busy; try again in a minute", 503)
    except anthropic.APIConnectionError:
        raise NovaError("offline", "no internet connection to the AI service", 503)
    except anthropic.APIStatusError as e:
        msg = getattr(e, "message", str(e))
        if "credit" in msg.lower() or "billing" in msg.lower():
            raise NovaError("no_credit", "the API account has no credit left", 502)
        raise NovaError("api", f"AI service error ({e.status_code})", 502)

    text = "".join(b.text for b in final.content if b.type == "text").strip() if final else ""
    if final is not None and final.stop_reason == "refusal":
        return {"answer": "", "tools": list(dict.fromkeys(used)), "code": "refused"}
    if not text:
        text = ("I looked at the data but ran out of steps before finishing. Please ask a narrower "
                "question, for example one well or a shorter period.")
    return {"answer": text, "tools": list(dict.fromkeys(used))}
