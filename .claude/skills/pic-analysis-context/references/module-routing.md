# Module Routing Table

Map keywords in the modification request to the source files that must be read.

| Keywords in request | Read these files |
|---------------------|-----------------|
| luminance, histogram, saturation, color temp, tint, dominant color, region, color harmony, diagnosis | `js/analyzer.js` |
| scene, low-key, high-key, portrait, golden hour, silhouette, foggy, soft dreamy, warm tone, cool tone, desaturated, bimodal, confidence score | `js/scene.js` |
| adjustment, threshold, strength, suppression, enhancement, route, strategy, trigger condition, scene multiplier, param, mode, photo, illustration, direction flip | `js/strategy.js` |
| pixel, brightness, contrast, vibrance, white balance, shadow recovery, highlight recovery, edge protection, protection profile | `js/adjuster.js` |
| RGB, HSL, LAB, luminance formula, color conversion, clamp | `js/color.js` |
| mean, std, standard deviation, skewness, percentile, k-means, kMeans, histogram bins | `js/stats.js` |
| translation, i18n, language, Chinese, English, lang key, t(), locale | `js/lang.js` |
| recolor, scheme, palette, skin, hue rotate, monochromatic, analogous, complementary, triadic, warm shift, cool shift, noRecolor, variant, alternative, skinScore | `js/recolor.js` |
| reference match, transfer, Reinhard, LAB statistical transfer, histogram matching, CDF, hue alignment, hue map, dominant hues, buildProfile, Transfer.match, target image, reference image, lumStrength, colorStrength, histogramShape, detailRetain | `js/transfer.js` |
| UI, upload, drag, canvas, download, preset, slider, histogram render, pipeline trigger, DOM, localStorage, mode toggle, setMode, pipeline cache, character color, hair, AI recolor, Gemini, compare, collapsible, advanced analysis, smart vibrance, auto vibrance, computeAutoVibrance, recolorVibrance, API key modal, landing page, three-entry, transfer workspace, runTransferPipeline, AI compare divider, processing overlay | `js/main.js` |

## Multi-Module Rules

When a request spans multiple concerns, read **all** implicated modules:

| Request type | Modules to read |
|-------------|----------------|
| Add new scene type | `scene.js` + `strategy.js` + `lang.js` |
| Add new adjustment type | `strategy.js` + `adjuster.js` + `lang.js` |
| Add new UI parameter/slider | `strategy.js` + `main.js` + `lang.js` |
| Change pipeline flow | `main.js` + affected stage module |
| Add new lang key | `lang.js` only (update both EN and zh objects) |
| Change color math | `color.js` + `analyzer.js` |
| Change statistical method | `stats.js` + `analyzer.js` |
| Change mode behavior (photo/illustration) | `strategy.js` (OVERRIDES, SCENE_MODIFIERS, route direction flip) |
| Add new processing mode | `strategy.js` + `main.js` + `lang.js` + `index.html` |
| Add new recolor scheme | `recolor.js` + `main.js` + `lang.js` + `index.html` |
| Change pipeline cache behavior | `main.js` (pipelineCache, _pipelineBgTimer) |
| Change character color detection | `main.js` (extractCharacterColors, aiAnalyzeImage) + `recolor.js` (skinScore) |
| Change AI recolor prompt/flow | `main.js` (aiAnalyzeImage, aiRecolorImage, formatCharacterColorsForPrompt) |
| Change AI transfer flow | `main.js` (#transfer-ai-btn handler, transferAiResultData, aiRecolorImage adaptation) |
| Change recolor variant generation | `recolor.js` (generateVariants, NO_VARIANTS) + `main.js` (renderAlternativePalettes, applyVariant) |
| Change smart vibrance auto-tune | `main.js` (computeAutoVibrance, applyAutoVibrance, recolorVibranceUserSet) + `lang.js` |
| Add Transfer layer / change Transfer math | `transfer.js` + `main.js` (runTransferPipeline, transferParams wiring) + `lang.js` |
| Change Transfer UI control | `transfer.js` (add option key) + `main.js` (slider binding, transferParams) + `lang.js` + `index.html` (#transfer-strength-* slider) |
| Change Transfer skin protection | `transfer.js` (Layer 1 + Layer 3 skinW application) + `recolor.js` (skinScore thresholds) |
| Change Transfer profile / caching | `transfer.js` (buildProfile, buildSourceStats) + `main.js` (transferRefProfile invalidation) |
| Change API Key modal behavior | `main.js` (#api-key-* handlers, localStorage key, file export) + `lang.js` + `index.html` (#api-key-modal) |
| Change AI compare slider/divider | `main.js` (divider drag handlers for recolor + transfer) + `css/style.css` (`.ai-compare-divider`) |
| Change landing page layout | `index.html` + `css/style.css` + `lang.js` |
| Add new landing entry (fourth mode) | `index.html` (landing cards + file inputs + workspace div) + `main.js` (drop handlers, workspace toggle) + `lang.js` + `css/style.css` |

## Source File Base Path
`/Users/kouzuimac/Documents/claude_code/pic-analysis/js/`
