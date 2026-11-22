# PetroNova pitch deck: plan, verification and sources

Deck: `presentation/PetroNova_Pitch_v2.pptx` (16:9, 6 pitch slides + a thank-you slide, English speaker notes, ~8.6 MB, plays offline).
Target: **3 min 30 s**, 3 speakers. Presenter clicks to change slide; everything inside a slide plays automatically.

## Slide titles

1. What Does a Three-Day Shutdown Cost?
2. How Much Oil Would the Well Have Produced?
3. What Can a Stopped Well Tell Us?
4. How Close Were Our Estimates?
5. Which Well Should We Check First?
6. Let’s Follow the Data for One Well
7. Thank You for Your Attention (after the live demo; Morph holds the terminal shot still while the closing text fades in)

## Design and motion concept

- **One pipeline through the whole deck.** A buried pipe in a soil cutaway runs along the bottom of every slide (y = 6.45–7.5 in). It is one 80-inch-long image moved left by exactly one slide width per slide. Each slide also holds the previous and next background images, one slide-width away. **Morph** (1.6 s) therefore slides the pipe and the backgrounds together, so it looks like the camera follows the same pipe from the pumpjack to the tanker.
- **Story arc (dark middle, sunny ends):** spring oilfield photo → production chart → well cutaway → quiet validation → decision → loading terminal (same photo light and colours as slide 1).
- **Palette:** oil amber `F2A33A` (GL‑01, money, oil), loss red `E5534B`, model green `3DBE8B`, steel `8C99A6` (baselines), on near-black `0E141B`. Font: Segoe UI / Segoe UI Semibold.
- **Oil drops** (slides 1 and 2) are a visual metaphor for oil that was not produced. They fall and disappear with a ripple. The speaker notes say clearly that there was no spill.
- **Motion rules:** every effect matches a sentence in the script, and the final frame is complete and readable. Charts are native PowerPoint charts (editable) and each one "draws" with a left-to-right wipe.

## Slide by slide

| # | Speaker · time | On screen | Motion (automatic) |
|---|---|---|---|
| 1 | S1 · 0:00–0:30 | Spring pumpjack photo. Kicker, title, question “If one oil well stops for three days, how much could that cost?”, **3 days** offline, **≈3,000** barrels of estimated oil loss, chip **GL‑01 · 15–18 April 2025**. Pipe cutaway under the wellhead. | Fade in from black; oil wipes into the pipe cutaway (1.8 s); title rises; question; “3 days”; “≈3,000” with three drops landing; case chip. |
| 2 | S1 · 0:30–1:10 | Real hourly GL‑01 chart (12–21 Apr): white dashed **Expected if the well had kept running**, amber **Production during shutdown**, red shaded **Estimated oil loss ≈3,000 barrels**. Right: one-sentence explanation + `998.6 bbl/day × 3 days = 2,995.7 barrels`. | Morph pan. Dashed line draws → actual line draws (drops to 0) → red area fades in, a drop falls into it → labels → formula. |
| 3 | S2 · 1:10–1:50 | Real downhole pressure build-up (−12 h → 72 h; 3,241 → 3,512 psi). Cutaway: well, casing, perforations in the oil-bearing rock, gauge. Two output cards: **How much production may have been lost: ≈3,000 barrels** and **What the engineer should check first: Damage near the well** (PTA: skin +5.7 · flow efficiency 68%). | Morph into the cutaway. Pressure curve draws; rings pulse out from the perforations (loop); gauge call-out; “+271 psi”; the two cards. |
| 4 | S2 · 1:50–2:20 | Two horizontal bars from one 0% line: **Past measurements only 7.1%** vs **PetroNova’s selected model 2.8%**. “Lower is better”, method note, **2.5×** smaller error. | Morph pan. 0% line → baseline bar grows → PetroNova bar grows → “Lower is better” → 2.5×. |
| 5 | S3 · 2:20–3:00 | Three beats: **≈3,000 × $70 ≈ $210,000**, note **Illustrative price: $70/barrel · Oil production value only**. Native bar chart: all six shutdowns valued the same way (GL‑01 in amber). “Why it matters” text. | Morph pan. Barrels → × $70 → ≈ $210,000 (zoom) → ranking chart wipes in → why it matters. |
| 6 | S3 · 3:00–3:30 | Terminal (same photo grade as slide 1): pipe rises into a loading gantry, loading arm into a tanker with a cutaway window. **10 wells · 273 days of data**; 1 Find the event → 2 Estimate the loss → 3 Decide what to check; **Next: live demo — GL‑01 in PetroNova →**. | Morph pan. Tank fills from the bottom (5 s) while the stats, the three steps and the hand-off line appear. Hold this frame for the demo. |

The full script, transitions and technical backup for questions are in each slide’s speaker notes.

## Numbers checked against the project

| Claim | Value used | Source / check |
|---|---|---|
| GL‑01 shutdown | 15 Apr 08:00 → 18 Apr 08:00, 72 h | `Dataset/choke_events(in).csv` (choke 0%), `work/shut_ins.csv` |
| Estimated oil loss | **2,995.7 bbl** (≈3,000) | Problems page logic `app/services/diagnostics.py` run on the preloaded data: 998.557 bbl/day (median of 7 producing days before) × 3.0 days |
| Slide 2 series | real hourly VFM, 12–21 Apr | `diagnostics.hourly_rates()`; the red area sums to exactly 2,995.7 bbl (the build script checks this) |
| Build-up | 3,240.7 → 3,511.5 psia (+271 psi) | `work/hf_clean.parquet`, `dh_pressure_psia`, 30-min means |
| GL‑01 PTA | skin +5.72, flow efficiency 0.68, k 108 mD | `app/services/pta_service.events()` (not the old PTA results file) |
| Accuracy | baseline **7.14%**, PetroNova **2.84%** MAPE, oil, n = 20 | `work/vfm_validation.csv`, split “B: forward (last 2 tests)”, rows “trend only (no sensors)” and “v2: physics-hybrid (FINAL)” |
| $ value | 2,995.7 × $70 = $209,699 (≈$210,000) | $70 is the app’s default price; labelled illustrative, oil only |
| Ranking | GL‑08 $307.6k · GL‑01 $209.7k · GL‑04 $113.3k · GL‑10 $48.4k · GL‑02 $21.8k · GL‑06 $16.0k | all downtime events on the Problems page × $70 |
| Data size | 10 wells · 273 days (1 Jan – 30 Sep 2025) | `work/daily.csv` |

Note: the baseline is the “trend only (no sensors)” model: a trend fitted to each well’s earlier tests. The “straight line between tests” dummy scores 8.1% on the same split; it is not the one shown.

## Media and licences

| Asset | Source | Licence |
|---|---|---|
| Oilfield photo (slides 1 and 6) | “A pumpjack on an active oil or gas drilling site in New Mexico”, Michael Duniway, USGS, 22 May 2019. https://www.usgs.gov/media/images/a-pumpjack-active-oil-or-gas-drilling-site-new-mexico | Public domain (USGS). Credited on the slides anyway |
| Slide 6 backdrop | Left part of the same photo, mirrored, graded to match; distant tanks drawn | Public domain + own drawing |
| Pipeline lane, rock cutaway, drops, ripple, gantry, tanker, oil fill | Generated by `build/gen_assets.py` | Own work |

Wikimedia Commons blocked downloads from this network during the build (HTTP 429), so no Commons photos are used. No licensed photo of a tanker loading terminal was found, so the tanker and gantry are clean illustrations, labelled as such on slide 6.

## Rebuild

```
python presentation/build/gen_assets.py
node presentation/build/build_deck.js      # needs pptxgenjs on NODE_PATH
python presentation/build/add_motion.py
```
QA used the installed PowerPoint: `build/render.ps1` (stills) and `build/export_video.ps1` (MP4 of every animation and Morph).
