# Methodology

**One-line summary:** a physics-hybrid virtual flow meter predicts daily oil, water and gas for 10 gas-lifted wells. Its oil rate feeds an automatic build-up analysis, and the reservoir pressure measured by that analysis feeds back into the flow meter.

---

## 1. Data: from raw sensors to trusted tables

| Problem in the raw data | Fix | Size |
|---|---|---|
| Duplicate per-minute rows | Dropped | 2,513 |
| `-999.25` "no reading" values | Set to missing | 7,410 |
| Spikes (single-minute jumps up to 5,690 psi) | Hampel filter: centred 11-minute median, limits at least 6× normal sensor noise | 448 |
| File not sorted by time | Sorted by well and time | all rows |
| A day with no data (GL-06, 24 Jun) | Kept and flagged, then filled from neighbouring days | 1 |
| Days with less than 12 h of data | Flagged, then blended with neighbouring days in proportion to coverage | 7 |

**Well-test labels were repaired, not thrown away.** Each test row stores the same facts several times: rates, water cut, GOR, GLR and totals. Twelve rows were internally inconsistent:
- **GL-06 gas** was about 28× too high, on all 9 tests.
- **Four negative values** were sign flips.

Each bad value was rebuilt from the ratio columns. It was accepted only when an independent column (GLR) confirmed it. Result: **all 85 tests usable** for every phase.

**Shut-ins** were taken from the choke log (choke = 0%). We also scanned the pressure data for build-ups the log might have missed, and found none.

## 2. VFM: what drives the rates

Findings from the data:
- **Rates change slowly within each well.** Oil declines and water cut rises month by month.
- **The flow responds to the choke, the downhole pressure and the lift gas.**
- **Trap found: "test mode".** During a well test the flow goes to the test separator. Downstream pressure drops 20–28 psi and downhole pressure drops 5–30 psi compared with normal days. A model trained only on tests sees "test-mode" sensors. A first version predicted normal days about 20% too high. Downstream pressure is therefore not used.
- **Unreported field-wide event:** on 14 Jun 2025, 10:00–15:00, the lift-gas supply dropped by about 30–50% on all wells, on both manifolds. Downhole pressure rose 15–110 psi. This event became our physics stress test.

## 3. VFM model (final: physics-hybrid)

```
log(oil) = well level + well decline trend
         + learned slow effects (choke, 15-day median of downhole pressure and temperature)
         - (Pwf - Pwf_15day) / drawdown          <- reservoir physics (inflow performance, IPR)
water = oil × water-oil ratio      gas = oil × gas-oil ratio
```

- **IPR term:** oil inflow is proportional to the drawdown, Pres − Pwf. So a short-term rise in Pwf of ΔP lowers the rate by about ΔP / drawdown. **The drawdown comes from our own build-up analysis**, measured from pressure only (6 wells; the other 4 use the median, 390 psi).
- **The data confirm the physics.** When the strength of the IPR term (λ) is left free, the well tests choose **λ = 0.86**, close to the theoretical 1.0.
- **Learned effects are sign-constrained:** a more open choke gives more oil, never less.
- **Why the first model (v1) was rejected.** It was slightly more accurate at the test points, but it learned "higher downhole pressure means more oil". That is true over months (depletion) but wrong within a day.

**Physics stress test (14 Jun lift-gas outage):**

| | v1 (unconstrained ML) | v2 (physics-hybrid, final) |
|---|---|---|
| Oil change during the outage | **+1% to +68%** (wrong direction) | **−3% to −19%** on all 10 wells |
| Normal days vs test level | 0% (ignores back-pressure) | **−2.2%** (back-pressure effect) |

## 4. VFM validation (no leakage: each test is hidden before fitting)

MAPE %, lower is better:

| Model | Oil | Water | Gas |
|---|---|---|---|
| Dummy: well average | 8.1 | 7.1 | 9.9 |
| Dummy: straight line between tests | 4.1 | 4.7 | 7.7 |
| v1: unconstrained ML | 2.6 | 3.1 | 6.0 |
| **v2: physics-hybrid (final)** | **2.5** | **3.6** | **6.1** |

These are leave-one-test-out scores. Hiding each well's **last 2 tests** gives oil 2.8%, water 4.0% and gas 5.4% for v2. The shrinkage of the learned oil effects was lowered (alpha 0.3 to 0.03) after checking both splits; the outage response did not change.

Test points can't measure the normal-day back-pressure effect or behaviour in upsets. That's why we chose v2 even where v1 scores slightly better at test points.

**Estimation, not forecasting.** The VFM estimates rates for days whose sensor data already exist. Some inputs use data from both sides of the day: the slow sensor trend is a centred rolling median, short gaps are interpolated in both directions, and the drawdown comes from shut-in pressures that can fall after the day. So these scores measure *historical estimation* (the competition task), not a forward forecast. Hiding a test hides its rates, not its sensor readings.

## 5. PTA: automatic build-up analysis

| Step | Method |
|---|---|
| Rate q | VFM daily oil rate of the last full producing day before shut-in (taken straight from the VFM Excel). If no such day exists (e.g. an upload that starts on the shut-in day), or there are too few build-up points, that event is marked "PTA unavailable" with the reason; other events and VFM are unaffected |
| Producing time tp | Horner: 24·Np/q, with Np = cumulative oil to 1 Jan 2025 plus VFM volumes |
| Flowing pressure Pwf | Last flowing downhole gauge reading before the choke closed |
| Radial-flow window | Bourdet derivative on Agarwal equivalent time. The widest stretch where the derivative is flat within 2% |
| Slope m, P*, P1hr | Horner straight-line fit in that window. P1hr is read from the line, not the data |
| k | 162.6·q·B·μ / (m·h) |
| Skin | 1.1513·[(P1hr − Pwf)/m − log(k/(φ·μ·ct·rw²)) + 3.2275] |
| ΔP skin | 0.869·m·S |
| Extra results | Flow efficiency, radius investigated, when a boundary is felt, average reservoir pressure at datum, wellbore storage |

**Checks:**
- **Horner slope vs derivative plateau:** agree within 0.2%.
- **Robustness:** k moves by at most 4.1% when the window shifts, and by at most 2.8% between two definitions of tp.
- **Single-phase oil:** valid, because Pwf is more than 1,000 psi above the bubble point in every well.

## 6. Results and interpretation

| Well | m (psi/cycle) | k (mD) | Skin | ΔP skin (psi) | What it means |
|---|---|---|---|---|---|
| GL-01 | 23.3 | 107.8 | **+5.7** | +116 | **Damaged**, flow efficiency 0.68, so a stimulation candidate. Boundary felt at about 670 ft. |
| GL-02 | 52.7 | 58.3 | −0.6 | −25 | Healthy |
| GL-04 | 145.0 | 55.5 | −1.3 | −158 | Stimulated or fractured near the well |
| GL-06 | 15.0 | 296.1 | +2.0 | +25 | Very permeable rock, mild damage |
| GL-08 | 93.5 | 43.1 | −1.7 | −136 | Stimulated or fractured near the well |
| GL-10 | 28.9 | 181.2 | +2.0 | +50 | Mild damage. Boundary felt at about 490 ft. |

## 7. Quality assurance

`src/check_data.py` runs **57 automatic checks** after every run. They cover the raw data being untouched, the cleaning, label repairs, every shut-in curve being intact, the VFM output format, the VFM physics (λ, the outage response, the back-pressure effect), and the PTA formulas, cross-checks and robustness.

## 8. Known limits

- **The four wells without a shut-in** (GL-03, GL-05, GL-07, GL-09) use the median drawdown for the IPR term.
- **Accuracy can only be measured at the 85 test points.** True daily rates aren't available to us.
- **The VFM was trained on oil, water and gas rates measured in test mode.** Normal-day back-pressure is handled through physics, not through labels.
