# PicAnalysis Architecture Reference

## Project Root
`/Users/kouzuimac/Documents/claude_code/pic-analysis/`

## Dual-Mode Philosophy

The system operates in two fundamentally opposed modes, selectable via header toggle:

| | Photo Mode (攝影) | Illustration Mode (電繪) |
|--|-------------------|------------------------|
| **Role** | Repair technician — fix unintentional flaws | Stylist — amplify existing artistic direction |
| **Scene detection** | "Don't touch this, it's intentional" → **suppress** | "Detected the direction, push harder" → **enhance** |
| **Direction logic** | Deviate from normal → correct back | Detect tendency → push further away |
| **WB/tint/brightness** | Correct toward neutral | Flip direction: amplify the bias |
| **Scene multipliers** | All < 1.0 (suppression only) | Mix of > 1.0 (enhance) and < 1.0 (protect) |
| **Thresholds** | Higher → fewer adjustments trigger | Lower → more sensitive to style characteristics |
| **Strengths** | Standard | Moderate (visible but not destructive) |

Mode is stored as `currentMode` in main.js. `Strategy.route()` accepts mode as 4th parameter.
`Strategy.defaultParams(mode)` returns mode-appropriate defaults.
`Strategy.MODES = { PHOTO: "photo", ILLUSTRATION: "illustration" }`.

## Module → File Map

| Module | File | Pipeline Stage | Role |
|--------|------|---------------|------|
| Color | `js/color.js` | Foundation | RGB/HSL/LAB conversions, luminance |
| Stats | `js/stats.js` | Foundation | mean, std, skewness, percentile, histogram, kMeans |
| Analyzer | `js/analyzer.js` | Stage 1 | ImageData → Diagnosis object |
| Scene | `js/scene.js` | Stage 1.5 | Diagnosis → Scene[] with confidence scores + factors |
| Strategy | `js/strategy.js` | Stage 2 | Diagnosis + Scene[] + params + mode → Adjustment[] |
| Adjuster | `js/adjuster.js` | Stage 3 | ImageData + Adjustment[] → adjusted ImageData |
| Lang | `js/lang.js` | UI | i18n, EN + zh-Hant |
| Main | `js/main.js` | UI/Orchestration | Pipeline coordination, DOM binding, presets, mode toggle |

---

## Diagnosis Object (Analyzer output)

```
luminance:    { mean, std, skewness, p5, p95, dynamicRange, histogram[256] }
saturation:   { mean, std }
colorTempBias: float -1(cool)…+1(warm)
tintBias:     float -1(magenta)…+1(green)
channels:     { rMean, gMean, bMean, rHistogram, gHistogram, bHistogram }
dominantColors: [{center:[R,G,B], count}]  ← up to 6, from kMeans(subsample 2000)
regions:      [{gx, gy, lumMean, satMean}]  ← 3×3 grid = 9 blocks
regionSummary: { regionContrast, darkest, brightest, centerEdgeDiff, darkestPos, brightestPos }
colorHarmony: { type, typeKey, score, hues[] }
  types: neutral / monochromatic / analogous / complementary /
         splitComplementary / triadic / tetradic / diverse
```

---

## 11 Scene Types (Scene Detector)

All confidence scores use `sigmoid(value, lo, hi)` — no hard thresholds.

| Key | Trigger Signature |
|-----|------------------|
| `lowKey` | dark mean 40-100, positive skewness, dynamicRange 60-120 |
| `highKey` | bright mean 160-220, negative skewness, p95 230-250 |
| `desaturated` | low sat mean + low sat std |
| `warmTone` | colorTempBias > 0.03, dominant hues 330°-60° |
| `coolTone` | colorTempBias < -0.03, dominant hues 180°-260° |
| `highContrast` | std 60-90, dynamicRange 180-230, bimodal histogram |
| `silhouette` | strong bimodality, dynamicRange 200-240, regionContrast 100-180 |
| `softDreamy` | low std 30-60 (inverted), bright mean 140-190, narrow range |
| `foggy` | low std, **lifted shadows** (p5: 20-70), low sat, uniform regions |
| `goldenHour` | strong warm bias 0.06-0.18, rich sat 0.25-0.5 |
| `portrait` | skin hues 10°-50°, skin sat 0.15-0.55, center brighter than edges |

---

## 10 Adjustment Types (Strategy → Adjuster)

| Type | Trigger | Key Thresholds |
|------|---------|---------------|
| `brightness` | \|skewness\| > threshold | brightnessSkewThreshold |
| `contrast` | dynamicRange < min | contrastMinDynamicRange |
| `contrastReduction` | std > max | contrastMaxStd |
| `vibrance` | satMean < min | vibranceMinMean |
| `saturation` | satMean < min | saturationMinMean |
| `desaturation` | satMean > max | saturationMaxMean |
| `whiteBalance` | \|colorTempBias\| > max | whiteBalanceMaxBias |
| `tintCorrection` | \|tintBias\| > max | tintMaxBias |
| `shadowRecovery` | p5 < threshold | shadowP5Threshold |
| `highlightRecovery` | p95 > threshold | highlightP95Threshold |

**Final amount formula:**
```
amount = baseAmount × sceneMultiplier × globalStrength
```

---

## Scene Modifier Tables (Strategy)

Two separate tables: `SCENE_MODIFIERS` (photo) and `ILLUSTRATION_SCENE_MODIFIERS`.
Selected at runtime by `route()` based on mode parameter.

### Photo Mode — `SCENE_MODIFIERS` (suppression only, all ≤ 1.0)

| Scene | Suppressed Adjustments | Multiplier Range |
|-------|----------------------|-----------------|
| `lowKey` | brightness, shadowRecovery | 0.90 / 0.85 |
| `highKey` | brightness, highlightRecovery | 0.90 / 0.85 |
| `desaturated` | saturation, vibrance | 0.95 / 0.90 |
| `warmTone` | whiteBalance | 0.80 |
| `coolTone` | whiteBalance | 0.80 |
| `highContrast` | contrast, contrastReduction, recoveries | 0.90 / 0.95 / 0.60 |
| `silhouette` | **ALL** (strongest suppression) | 0.30-0.70 |
| `softDreamy` | contrast, highlightRecovery | 0.85 / 0.80 |
| `foggy` | contrast, saturation, vibrance, shadowRecovery | 0.90 / 0.85 / 0.80 / 0.70 |
| `goldenHour` | whiteBalance, desaturation, tintCorrection | 0.95 / 0.80 / 0.60 |
| `portrait` | saturation, vibrance, contrast, whiteBalance | 0.70 / 0.50 / 0.60 / 0.50 |

### Illustration Mode — `ILLUSTRATION_SCENE_MODIFIERS` (enhancement + selective suppression)

| Scene | Enhanced (>1.0) | Suppressed (<1.0) |
|-------|----------------|-------------------|
| `lowKey` | brightness 1.25, contrast 1.3, vibrance 1.15 | shadowRecovery 0.2 |
| `highKey` | brightness 1.2, contrast 1.2, vibrance 1.15 | highlightRecovery 0.3 |
| `desaturated` | desaturation 1.3 | saturation 0.7, vibrance 0.6 |
| `warmTone` | whiteBalance 1.3, vibrance 1.25, saturation 1.2 | — |
| `coolTone` | whiteBalance 1.3, vibrance 1.25, saturation 1.2 | — |
| `highContrast` | contrast 1.3 | contrastReduction 0.3, recoveries 0.4 |
| `silhouette` | brightness 1.3, contrast 1.4, vibrance 1.2 | shadowRecovery 0.15 |
| `softDreamy` | contrastReduction 1.2, vibrance 1.25 | contrast 0.7, highlightRecovery 0.5 |
| `foggy` | contrastReduction 1.2 | contrast 0.7, saturation 0.7, vibrance 0.8, shadowRecovery 0.5 |
| `goldenHour` | whiteBalance 1.35, vibrance 1.4, saturation 1.3 | tintCorrection 0.5 |
| `portrait` | vibrance 1.2, contrast 1.15, saturation 1.1 | — |

---

## Edge Protection Profiles (Adjuster)

Each adjustment protects three pixel categories. Value = protection strength (0=none, 1=full).

| Adjustment | highlight | shadow | achromatic |
|-----------|-----------|--------|-----------|
| brightness | 1.0 | 1.0 | 0.3 |
| contrast | 0.6 | 0.6 | 0.3 |
| contrastReduction | 0.5 | 0.5 | 0.3 |
| saturation | 0.8 | 0.8 | **1.0** |
| desaturation | 0.2 | 0.2 | 0.0 |
| whiteBalance | 0.7 | 0.4 | **0.0** (must affect neutrals) |
| tintCorrection | 0.7 | 0.4 | **0.0** |
| shadowRecovery | 0.0 | 0.0 | 0.4 |
| highlightRecovery | 0.0 | 0.0 | 0.3 |
| vibrance | 0.7 | 0.7 | 0.4 |

Protection activates via cubic/quadratic falloff:
- highlight: lum > 0.8
- shadow: lum < 0.1
- achromatic: chroma < 0.1

---

## 32 Tunable Parameters (Strategy.defaultParams)

`defaultParams(mode)` returns mode-specific defaults. Photo mode uses base values;
illustration mode applies `ILLUSTRATION_OVERRIDES` on top.

### Strategy Thresholds
`sceneAwareness`, `brightnessSkewThreshold`, `contrastMinDynamicRange`, `contrastMaxStd`,
`vibranceMinMean`, `saturationMinMean`, `saturationMaxMean`, `whiteBalanceMaxBias`,
`tintMaxBias`, `shadowP5Threshold`, `highlightP95Threshold`

### Target Values
`brightnessTarget` (60-200), `contrastTarget` (80-220), `saturationTarget` (0.1-0.8)

### Adjustment Strengths
`globalStrength`, `brightnessStrength`, `contrastStrength`, `contrastReductionStrength`,
`vibranceStrength`, `saturationStrength`, `desaturationStrength`,
`whiteBalanceStrength`, `tintStrength`, `shadowStrength`, `highlightStrength`

### Key Photo vs Illustration Default Differences

| Parameter | Photo | Illustration | Why |
|-----------|-------|-------------|-----|
| `whiteBalanceMaxBias` | 0.10 | 0.04 | Illust: very sensitive to detect colour direction |
| `tintMaxBias` | 0.06 | 0.03 | Illust: very sensitive to tint direction |
| `brightnessSkewThreshold` | 0.40 | 0.25 | Illust: catch subtle brightness moods |
| `shadowP5Threshold` | 25 | 35 | Illust: detect shadow character early |
| `globalStrength` | 1.0 | 0.7 | Illust: noticeable but not destructive |
| `shadowStrength` | 0.5 | 0.15 | Illust: deep shadows are intentional |
| `highlightStrength` | 0.5 | 0.15 | Illust: bright highlights are intentional |
| `sceneAwareness` | 0.85 | 0.90 | Illust: trust scene detection more |

Stored in localStorage via 5 named preset slots.

---

## Key Design Constraints (Must-Know Before Modifying)

1. **No external dependencies** — vanilla JS ES5, no build step, no npm
2. **Diagnosis is cached** — param slider changes skip Stage 1, re-run from Stage 2 only
3. **Scene awareness is multiplicative** — `sceneAwareness` param (0-1) scales ALL scene multipliers
4. **Achromatic pixels are sacred for saturation** — protection = 1.0, never add colour to grey pixels
5. **whiteBalance/tintCorrection must affect neutrals** — achromatic protection = 0.0 by design
6. **K-means subsamples to 2000 points** — for performance; changing this affects dominant colour accuracy
7. **MAX_PROCESS_DIM = 2048** — images are downscaled before processing
8. **Lang keys must exist in both EN and zh** — adding a new UI label requires updating both language objects in lang.js
9. **Histogram is 256-bin, normalised** — values are Float64 fractions, not raw counts
10. **Pipeline re-entry point** — when params change, only Stages 2+3 rerun (Diagnosis+Scene results are reused)
11. **Dual-mode direction flip** — in illustration mode, `route()` inverts direction for brightness, whiteBalance, and tintCorrection. Same detection, opposite action.
12. **Two scene modifier tables** — `SCENE_MODIFIERS` (photo, suppress-only) and `ILLUSTRATION_SCENE_MODIFIERS` (enhance+suppress). Selected by mode in `route()`.
13. **Mode switch resets params** — `setMode()` calls `defaultParams(mode)` then reruns pipeline. Mode does NOT affect Stage 1 or 1.5 (same diagnosis, same scene detection).
