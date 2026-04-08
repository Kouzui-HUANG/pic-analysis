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
| UI, upload, drag, canvas, download, preset, slider, histogram render, pipeline trigger, DOM, localStorage, mode toggle, setMode, pipeline cache, character color, hair, AI recolor, Gemini, compare, collapsible, advanced analysis | `js/main.js` |

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
| Change recolor variant generation | `recolor.js` (generateVariants, NO_VARIANTS) + `main.js` (renderAlternativePalettes, applyVariant) |
| Change landing page layout | `index.html` + `css/style.css` + `lang.js` |

## Source File Base Path
`/Users/kouzuimac/Documents/claude_code/pic-analysis/js/`
