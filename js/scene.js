// scene.js — Stage 1.5: Scene Detection
// Classifies artistic intent from diagnosis data to prevent
// the strategy layer from "correcting" intentional creative choices.
// Exposes: PicAnalysis.Scene

var PicAnalysis = PicAnalysis || {};

PicAnalysis.Scene = (function () {
  var Color = PicAnalysis.Color;

  // ═══════════════════════════════════════════
  // Utility functions
  // ═══════════════════════════════════════════

  // Smooth sigmoid mapping: value in [lo, hi] → 0..1 (smoothstep)
  function sigmoid(value, lo, hi) {
    if (value <= lo) return 0;
    if (value >= hi) return 1;
    var t = (value - lo) / (hi - lo);
    return t * t * (3 - 2 * t);
  }

  // Detect histogram bimodality: returns 0..1
  // Finds two tallest local maxima and measures the valley between them.
  function bimodality(histogram) {
    var len = histogram.length;
    // 5-bin moving average smoothing
    var smooth = new Float64Array(len);
    for (var i = 2; i < len - 2; i++) {
      smooth[i] = (histogram[i - 2] + histogram[i - 1] + histogram[i] +
                   histogram[i + 1] + histogram[i + 2]) / 5;
    }
    smooth[0] = histogram[0];
    smooth[1] = (histogram[0] + histogram[1] + histogram[2]) / 3;
    smooth[len - 2] = (histogram[len - 3] + histogram[len - 2] + histogram[len - 1]) / 3;
    smooth[len - 1] = histogram[len - 1];

    // Find local maxima (must be higher than all neighbors within ±10 bins)
    var peaks = [];
    for (var i = 10; i < len - 10; i++) {
      var isPeak = true;
      for (var j = 1; j <= 10; j++) {
        if (smooth[i] <= smooth[i - j] || smooth[i] <= smooth[i + j]) {
          isPeak = false;
          break;
        }
      }
      if (isPeak && smooth[i] > 0) peaks.push({ idx: i, val: smooth[i] });
    }

    if (peaks.length < 2) return 0;

    // Take the two tallest peaks
    peaks.sort(function (a, b) { return b.val - a.val; });
    var p1 = peaks[0], p2 = peaks[1];
    var lo = Math.min(p1.idx, p2.idx);
    var hi = Math.max(p1.idx, p2.idx);

    // Peaks too close together don't count as bimodal
    if (hi - lo < 40) return 0;

    // Find valley minimum between peaks
    var valley = Infinity;
    for (var i = lo; i <= hi; i++) {
      if (smooth[i] < valley) valley = smooth[i];
    }

    // Bimodality = valley depth relative to shorter peak
    var minPeak = Math.min(p1.val, p2.val);
    if (minPeak === 0) return 0;
    return Math.min(1, (minPeak - valley) / minPeak);
  }

  // Region luminance contrast: max - min of 3×3 grid means
  function regionContrast(regions) {
    var min = 255, max = 0;
    for (var i = 0; i < regions.length; i++) {
      if (regions[i].lumMean < min) min = regions[i].lumMean;
      if (regions[i].lumMean > max) max = regions[i].lumMean;
    }
    return max - min;
  }

  // Weighted average saturation of dominant colors
  function avgDominantSaturation(dominantColors) {
    if (!dominantColors || dominantColors.length === 0) return 0;
    var sum = 0, total = 0;
    for (var i = 0; i < dominantColors.length; i++) {
      var c = dominantColors[i];
      var hsl = Color.rgbToHsl(c.center[0], c.center[1], c.center[2]);
      sum += hsl[1] * c.count;
      total += c.count;
    }
    return total > 0 ? sum / total : 0;
  }

  // Fraction of dominant color pixels whose hue falls in [hueLo, hueHi] (degrees)
  // Only considers pixels with saturation > 0.1 (grays have meaningless hue)
  function dominantHueInRange(dominantColors, hueLo, hueHi) {
    if (!dominantColors || dominantColors.length === 0) return 0;
    var inRange = 0, total = 0;
    for (var i = 0; i < dominantColors.length; i++) {
      var c = dominantColors[i];
      var hsl = Color.rgbToHsl(c.center[0], c.center[1], c.center[2]);
      var hueDeg = hsl[0] * 360;
      if (hsl[1] > 0.1) {
        if (hueLo <= hueHi) {
          if (hueDeg >= hueLo && hueDeg <= hueHi) inRange += c.count;
        } else {
          // Wraps around 0° (e.g. 330..30)
          if (hueDeg >= hueLo || hueDeg <= hueHi) inRange += c.count;
        }
      }
      total += c.count;
    }
    return total > 0 ? inRange / total : 0;
  }

  // ═══════════════════════════════════════════
  // Scene detectors — each returns 0..1 confidence
  // ═══════════════════════════════════════════

  function detectLowKey(d) {
    var lum = d.luminance;
    var darkMean = 1 - sigmoid(lum.mean, 40, 100);
    var darkSkew = sigmoid(lum.skewness, 0.3, 1.5);
    var hasRange = sigmoid(lum.dynamicRange, 60, 120);
    var deepBlacks = sigmoid(30 - lum.p5, 0, 30);

    var confidence = Math.min(1, darkMean * 0.3 + darkSkew * 0.3 +
                       hasRange * 0.2 + deepBlacks * 0.2);
    return { confidence: confidence, factors: [
      { key: "factor.darkMean", score: darkMean },
      { key: "factor.darkSkew", score: darkSkew },
      { key: "factor.hasRange", score: hasRange },
      { key: "factor.deepBlacks", score: deepBlacks },
    ]};
  }

  function detectHighKey(d) {
    var lum = d.luminance;
    var brightMean = sigmoid(lum.mean, 160, 220);
    var brightSkew = sigmoid(-lum.skewness, 0.3, 1.5);
    var hasRange = sigmoid(lum.dynamicRange, 50, 100);
    var brightHighlights = sigmoid(lum.p95, 230, 250);

    var confidence = Math.min(1, brightMean * 0.3 + brightSkew * 0.3 +
                       hasRange * 0.2 + brightHighlights * 0.2);
    return { confidence: confidence, factors: [
      { key: "factor.brightMean", score: brightMean },
      { key: "factor.brightSkew", score: brightSkew },
      { key: "factor.hasRange", score: hasRange },
      { key: "factor.brightHighlights", score: brightHighlights },
    ]};
  }

  function detectDesaturated(d) {
    var sat = d.saturation;
    var lowMean = 1 - sigmoid(sat.mean, 0.05, 0.2);
    var lowStd = 1 - sigmoid(sat.std, 0.03, 0.12);
    var dominantSat = avgDominantSaturation(d.dominantColors);
    var lowDominant = 1 - sigmoid(dominantSat, 0.05, 0.2);

    var confidence = Math.min(1, lowMean * 0.4 + lowStd * 0.3 + lowDominant * 0.3);
    return { confidence: confidence, factors: [
      { key: "factor.lowSatMean", score: lowMean },
      { key: "factor.lowSatStd", score: lowStd },
      { key: "factor.lowDominantSat", score: lowDominant },
    ]};
  }

  function detectWarmTone(d) {
    var warmBias = sigmoid(d.colorTempBias, 0.03, 0.12);
    var warmDominant = dominantHueInRange(d.dominantColors, 330, 60);
    var consistency = sigmoid(d.colorTempBias, 0, 0.1);

    var confidence = Math.min(1, warmBias * 0.4 + warmDominant * 0.3 +
                       consistency * 0.3);
    return { confidence: confidence, factors: [
      { key: "factor.warmBias", score: warmBias },
      { key: "factor.warmDominant", score: warmDominant },
      { key: "factor.warmConsistency", score: consistency },
    ]};
  }

  function detectCoolTone(d) {
    var coolBias = sigmoid(-d.colorTempBias, 0.03, 0.12);
    var coolDominant = dominantHueInRange(d.dominantColors, 180, 260);
    var consistency = sigmoid(-d.colorTempBias, 0, 0.1);

    var confidence = Math.min(1, coolBias * 0.4 + coolDominant * 0.3 +
                       consistency * 0.3);
    return { confidence: confidence, factors: [
      { key: "factor.coolBias", score: coolBias },
      { key: "factor.coolDominant", score: coolDominant },
      { key: "factor.coolConsistency", score: consistency },
    ]};
  }

  function detectHighContrast(d) {
    var lum = d.luminance;
    var highStd = sigmoid(lum.std, 60, 90);
    var highRange = sigmoid(lum.dynamicRange, 180, 230);
    var bimodal = bimodality(lum.histogram);

    var confidence = Math.min(1, highStd * 0.3 + highRange * 0.3 + bimodal * 0.4);
    return { confidence: confidence, factors: [
      { key: "factor.highStd", score: highStd },
      { key: "factor.highRange", score: highRange },
      { key: "factor.bimodal", score: bimodal },
    ]};
  }

  function detectSilhouette(d) {
    var lum = d.luminance;
    var bimodal = bimodality(lum.histogram);
    var extremeRange = sigmoid(lum.dynamicRange, 200, 240);
    var regionGap = sigmoid(regionContrast(d.regions), 100, 180);
    var darkShadows = sigmoid(30 - lum.p5, 0, 25);
    var brightHighlights = sigmoid(lum.p95, 230, 250);

    var confidence = Math.min(1, bimodal * 0.3 + extremeRange * 0.2 +
                       regionGap * 0.2 + darkShadows * 0.15 +
                       brightHighlights * 0.15);
    return { confidence: confidence, factors: [
      { key: "factor.bimodal", score: bimodal },
      { key: "factor.extremeRange", score: extremeRange },
      { key: "factor.regionGap", score: regionGap },
      { key: "factor.deepBlacks", score: darkShadows },
      { key: "factor.brightHighlights", score: brightHighlights },
    ]};
  }

  function detectSoftDreamy(d) {
    var lum = d.luminance;
    var lowContrast = 1 - sigmoid(lum.std, 30, 60);
    var bright = sigmoid(lum.mean, 140, 190);
    var narrowRange = 1 - sigmoid(lum.dynamicRange, 80, 150);
    var softSat = 1 - sigmoid(d.saturation.mean, 0.15, 0.4);

    var confidence = Math.min(1, lowContrast * 0.3 + bright * 0.3 +
                       narrowRange * 0.2 + softSat * 0.2);
    return { confidence: confidence, factors: [
      { key: "factor.lowContrast", score: lowContrast },
      { key: "factor.brightOverall", score: bright },
      { key: "factor.narrowRange", score: narrowRange },
      { key: "factor.softSat", score: softSat },
    ]};
  }

  // ── Foggy / Hazy ──
  // Low contrast + narrow range + lifted shadows + low saturation + uniform regions.
  // Distinct from softDreamy: fog is neutral/cool, not bright/warm.
  function detectFoggy(d) {
    var lum = d.luminance;
    var lowStd = 1 - sigmoid(lum.std, 25, 55);
    var narrowRange = 1 - sigmoid(lum.dynamicRange, 60, 130);
    var liftedShadows = sigmoid(lum.p5, 20, 70);
    var lowSat = 1 - sigmoid(d.saturation.mean, 0.08, 0.25);
    var uniformRegions = 1 - sigmoid(regionContrast(d.regions), 15, 50);

    var confidence = Math.min(1, lowStd * 0.25 + narrowRange * 0.2 +
                       liftedShadows * 0.2 + lowSat * 0.2 +
                       uniformRegions * 0.15);
    return { confidence: confidence, factors: [
      { key: "factor.lowContrast", score: lowStd },
      { key: "factor.narrowRange", score: narrowRange },
      { key: "factor.liftedShadows", score: liftedShadows },
      { key: "factor.lowSat", score: lowSat },
      { key: "factor.uniformRegions", score: uniformRegions },
    ]};
  }

  // ── Golden Hour ──
  // Intense warm cast + vivid saturation + warm-hue dominance.
  // Stronger than warmTone: golden hour has both warmth AND color richness.
  function detectGoldenHour(d) {
    var strongWarm = sigmoid(d.colorTempBias, 0.06, 0.18);
    var richSat = sigmoid(d.saturation.mean, 0.25, 0.5);
    var warmHues = dominantHueInRange(d.dominantColors, 330, 60);
    var warmDominance = sigmoid(warmHues, 0.3, 0.7);
    var dominantSat = avgDominantSaturation(d.dominantColors);
    var vividDominants = sigmoid(dominantSat, 0.2, 0.45);

    // Gate: warmth is essential — without warm cast AND warm hues this is not golden hour
    var warmGate = Math.min(strongWarm, warmDominance);
    var raw = strongWarm * 0.3 + richSat * 0.2 +
              warmDominance * 0.25 + vividDominants * 0.25;
    var confidence = Math.min(1, raw * sigmoid(warmGate, 0.05, 0.3));
    return { confidence: confidence, factors: [
      { key: "factor.strongWarm", score: strongWarm },
      { key: "factor.richSat", score: richSat },
      { key: "factor.warmDominant", score: warmDominance },
      { key: "factor.vividDominants", score: vividDominants },
    ]};
  }

  // ── Color Accent ──
  // Mostly desaturated image with one or few vivid color pops.
  // Distinct from desaturated: the accent is intentional, not a defect.
  // Must protect the accent from being dulled by uniform desaturation.
  function detectColorAccent(d) {
    var sat = d.saturation;
    // Need overall low-to-moderate saturation
    var lowOverall = 1 - sigmoid(sat.mean, 0.08, 0.25);

    // Find vivid accent clusters among dominant colors
    var maxDomSat = 0;
    var accentCount = 0;
    var totalCount = 0;
    if (d.dominantColors) {
      for (var i = 0; i < d.dominantColors.length; i++) {
        var c = d.dominantColors[i];
        var hsl = Color.rgbToHsl(c.center[0], c.center[1], c.center[2]);
        totalCount += c.count;
        if (hsl[1] > maxDomSat) maxDomSat = hsl[1];
        if (hsl[1] > 0.4) accentCount += c.count;
      }
    }

    // At least one dominant cluster is vivid despite low overall sat
    var hasVividAccent = sigmoid(maxDomSat, 0.3, 0.6);

    // Accent is a minority of pixels (< 30%) — it's a pop, not the whole image
    var accentFraction = totalCount > 0 ? accentCount / totalCount : 0;
    var isMinority = 1 - sigmoid(accentFraction, 0.05, 0.3);

    // High saturation variance confirms mixed vivid + muted
    var highSatVariance = sigmoid(sat.std, 0.1, 0.25);

    var confidence = Math.min(1, lowOverall * 0.3 + hasVividAccent * 0.3 +
                       isMinority * 0.2 + highSatVariance * 0.2);
    return { confidence: confidence, factors: [
      { key: "factor.lowOverallSat", score: lowOverall },
      { key: "factor.vividAccent", score: hasVividAccent },
      { key: "factor.accentMinority", score: isMinority },
      { key: "factor.satVariance", score: highSatVariance },
    ]};
  }

  // ── Pastel ──
  // High lightness + moderate saturation + diverse hues.
  // Distinct from highKey (which is bright but doesn't care about color richness)
  // and softDreamy (which expects LOW saturation).
  // Pastel = "bright, colourful, but soft" — common in illustration, UI art, kawaii.
  function detectPastel(d) {
    var lum = d.luminance;
    // Bright overall — pastels live in the upper lightness range
    var bright = sigmoid(lum.mean, 150, 200);

    // Moderate saturation: not washed-out, not vivid. Sweet spot 0.15-0.45
    var modSat = sigmoid(d.saturation.mean, 0.12, 0.25) *
                 (1 - sigmoid(d.saturation.mean, 0.45, 0.65));

    // Low contrast — pastels are inherently soft
    var lowContrast = 1 - sigmoid(lum.std, 30, 65);

    // Hue diversity: at least 3+ distinct hue clusters → not monochromatic
    var hueDiversity = 0;
    if (d.colorHarmony) {
      var type = d.colorHarmony.type;
      if (type === "analogous") hueDiversity = 0.4;
      else if (type === "complementary" || type === "splitComplementary") hueDiversity = 0.7;
      else if (type === "triadic" || type === "tetradic" || type === "diverse") hueDiversity = 1.0;
    }

    var confidence = Math.min(1, bright * 0.3 + modSat * 0.3 +
                       lowContrast * 0.2 + hueDiversity * 0.2);
    return { confidence: confidence, factors: [
      { key: "factor.brightOverall", score: bright },
      { key: "factor.moderateSat", score: modSat },
      { key: "factor.lowContrast", score: lowContrast },
      { key: "factor.hueDiversity", score: hueDiversity },
    ]};
  }

  // ── Neon / Cyberpunk ──
  // High saturation + cool dominant hues (magenta, cyan, electric blue) + high contrast.
  // Very common in digital illustration, game art, cyberpunk aesthetics.
  function detectNeon(d) {
    var sat = d.saturation;
    // High saturation — neon colours are vivid
    var highSat = sigmoid(sat.mean, 0.35, 0.6);

    // High contrast or at least moderate dynamic range
    var highContrast = sigmoid(d.luminance.std, 50, 80);

    // Neon hue dominance: magenta (280-330), cyan (160-200), electric blue (220-270)
    var neonHueFraction = 0;
    if (d.dominantColors) {
      var neonCount = 0, totalCount = 0;
      for (var i = 0; i < d.dominantColors.length; i++) {
        var c = d.dominantColors[i];
        var hsl = Color.rgbToHsl(c.center[0], c.center[1], c.center[2]);
        var hueDeg = hsl[0] * 360;
        totalCount += c.count;
        // Neon hues: cyan 160-200, blue 220-270, magenta 280-330
        if (hsl[1] > 0.3 && (
            (hueDeg >= 160 && hueDeg <= 200) ||
            (hueDeg >= 220 && hueDeg <= 270) ||
            (hueDeg >= 280 && hueDeg <= 330))) {
          neonCount += c.count;
        }
      }
      neonHueFraction = totalCount > 0 ? neonCount / totalCount : 0;
    }
    var neonHues = sigmoid(neonHueFraction, 0.15, 0.5);

    // Vivid dominant clusters (high saturation in dominant colors)
    var dominantSat = avgDominantSaturation(d.dominantColors);
    var vividDominants = sigmoid(dominantSat, 0.35, 0.6);

    // Gate: need both vivid color AND neon hues present
    var neonGate = Math.min(highSat, neonHues);
    var raw = highSat * 0.25 + highContrast * 0.2 +
              neonHues * 0.3 + vividDominants * 0.25;
    var confidence = Math.min(1, raw * sigmoid(neonGate, 0.05, 0.25));
    return { confidence: confidence, factors: [
      { key: "factor.highSat", score: highSat },
      { key: "factor.highContrast", score: highContrast },
      { key: "factor.neonHues", score: neonHues },
      { key: "factor.vividDominants", score: vividDominants },
    ]};
  }

  // ── Portrait ──
  // Skin tones in dominant colors + center-weighted subject + moderate contrast.
  // Uses statistical heuristics (no face detection available).
  function detectPortrait(d) {
    var skinHueFraction = dominantHueInRange(d.dominantColors, 10, 50);
    var hasSkinHues = sigmoid(skinHueFraction, 0.1, 0.4);

    var skinSatScore = 0;
    if (d.dominantColors && d.dominantColors.length > 0) {
      var skinSatSum = 0, skinCount = 0;
      for (var i = 0; i < d.dominantColors.length; i++) {
        var c = d.dominantColors[i];
        var hsl = Color.rgbToHsl(c.center[0], c.center[1], c.center[2]);
        var hueDeg = hsl[0] * 360;
        if (hueDeg >= 10 && hueDeg <= 50 && hsl[1] > 0.1) {
          skinSatSum += hsl[1] * c.count;
          skinCount += c.count;
        }
      }
      if (skinCount > 0) {
        var avgSkinSat = skinSatSum / skinCount;
        skinSatScore = sigmoid(avgSkinSat, 0.1, 0.25) * (1 - sigmoid(avgSkinSat, 0.5, 0.7));
      }
    }

    var centerBrighter = 0;
    if (d.regionSummary) {
      centerBrighter = sigmoid(d.regionSummary.centerEdgeDiff, 5, 25);
    }

    var moderateContrast = 1 - sigmoid(d.luminance.std, 65, 90);

    var confidence = Math.min(1, hasSkinHues * 0.35 + skinSatScore * 0.2 +
                       centerBrighter * 0.25 + moderateContrast * 0.2);
    return { confidence: confidence, factors: [
      { key: "factor.skinHues", score: hasSkinHues },
      { key: "factor.skinSat", score: skinSatScore },
      { key: "factor.centerBrighter", score: centerBrighter },
      { key: "factor.moderateContrast", score: moderateContrast },
    ]};
  }

  // ═══════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════

  var SCENE_TYPES = [
    "lowKey", "highKey", "desaturated", "colorAccent", "warmTone",
    "coolTone", "highContrast", "silhouette", "softDreamy",
    "foggy", "goldenHour", "pastel", "neon", "portrait"
  ];

  var DETECTORS = {
    lowKey:       detectLowKey,
    highKey:      detectHighKey,
    desaturated:  detectDesaturated,
    colorAccent:  detectColorAccent,
    warmTone:     detectWarmTone,
    coolTone:     detectCoolTone,
    highContrast: detectHighContrast,
    silhouette:   detectSilhouette,
    softDreamy:   detectSoftDreamy,
    foggy:        detectFoggy,
    goldenHour:   detectGoldenHour,
    pastel:       detectPastel,
    neon:         detectNeon,
    portrait:     detectPortrait,
  };

  var CONFIDENCE_THRESHOLD = 0.3;

  function detect(diagnosis) {
    var scenes = [];
    for (var i = 0; i < SCENE_TYPES.length; i++) {
      var type = SCENE_TYPES[i];
      var result = DETECTORS[type](diagnosis);
      scenes.push({
        type: type,
        confidence: result.confidence,
        factors: result.factors,
        active: result.confidence >= CONFIDENCE_THRESHOLD,
      });
    }
    return scenes;
  }

  return {
    SCENE_TYPES: SCENE_TYPES,
    CONFIDENCE_THRESHOLD: CONFIDENCE_THRESHOLD,
    detect: detect,
  };
})();
