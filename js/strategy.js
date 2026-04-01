// strategy.js — Stage 2: Strategy Router
// Decides which adjustments to apply and their strengths based on diagnosis.
// Scene-aware and bidirectional: can both boost and reduce properties.
// Exposes: PicAnalysis.Strategy

var PicAnalysis = PicAnalysis || {};

PicAnalysis.Strategy = (function () {
  var ADJUSTMENT_TYPES = {
    BRIGHTNESS: "brightness",
    CONTRAST: "contrast",
    CONTRAST_REDUCTION: "contrastReduction",
    SATURATION: "saturation",
    DESATURATION: "desaturation",
    WHITE_BALANCE: "whiteBalance",
    TINT_CORRECTION: "tintCorrection",
    SHADOW_RECOVERY: "shadowRecovery",
    HIGHLIGHT_RECOVERY: "highlightRecovery",
    VIBRANCE: "vibrance",
    CLARITY: "clarity",
  };

  // Scene modifier table — controls how each scene type affects adjustments.
  // Values are target multipliers at full confidence:
  //   < 1 = suppress (reduce the adjustment to preserve artistic intent)
  //   1   = no effect (omit from table)
  // Design principle: scene detection ONLY suppresses; it never enhances beyond
  // what defect-correction already calls for. Enhancement would mean the system
  // is imposing an aesthetic preference, not correcting a technical flaw.
  // Formula: multiplier = 1 + (target - 1) × confidence × awareness
  var SCENE_MODIFIERS = {
    lowKey: {
      brightness:     0.9,
      shadowRecovery: 0.85,
    },
    highKey: {
      brightness:        0.9,
      highlightRecovery: 0.85,
    },
    desaturated: {
      saturation: 0.95,
      vibrance:   0.9,
    },
    colorAccent: {
      desaturation: 0.5,   // protect the vivid accent from being dulled
      saturation:   0.85,  // don't uniformly boost (would narrow the vivid/muted gap)
      vibrance:     0.9,   // gentle vibrance suppression (vibrance targets low-sat areas)
    },
    warmTone: {
      whiteBalance: 0.8,
    },
    coolTone: {
      whiteBalance: 0.8,
    },
    highContrast: {
      contrast:          0.9,
      contrastReduction: 0.95,
      shadowRecovery:    0.6,
      highlightRecovery: 0.6,
    },
    silhouette: {
      brightness:        0.5,   // silhouette IS the tonal structure — barely touch it
      contrast:          0.6,
      contrastReduction: 0.6,
      shadowRecovery:    0.3,   // deep shadows are the whole point of a silhouette
      highlightRecovery: 0.7,
      saturation:        0.5,
      vibrance:          0.5,
    },
    softDreamy: {
      contrast:          0.85,
      clarity:           0.7,   // softness is the point — don't sharpen midtones
      highlightRecovery: 0.8,
    },
    foggy: {
      contrast:          0.9,
      clarity:           0.6,   // haze is intentional — don't add midtone punch
      saturation:        0.85,
      vibrance:          0.8,
      shadowRecovery:    0.7,
    },
    goldenHour: {
      whiteBalance:      0.95,
      desaturation:      0.8,
      tintCorrection:    0.6,
    },
    pastel: {
      contrast:          0.8,   // preserve the softness
      clarity:           0.6,   // pastels are soft by nature
      desaturation:      0.85,  // don't dull the candy colors
      highlightRecovery: 0.8,   // bright pastels are intentional
    },
    neon: {
      desaturation:      0.5,   // vivid is the whole point
      whiteBalance:      0.7,   // don't neutralise the cool cast
      contrastReduction: 0.6,   // don't soften the punch
    },
    portrait: {
      saturation:        0.7,
      vibrance:          0.5,
      contrast:          0.6,
      whiteBalance:      0.5,
    },
  };

  // Processing modes
  var MODES = { PHOTO: "photo", ILLUSTRATION: "illustration" };

  // Illustration mode: the OPPOSITE of photo mode.
  // Photo = repair technician (correct toward normal).
  // Illustration = stylist (detect the existing direction, push it further).
  //
  // Key differences:
  //   1. LOWER thresholds → more sensitive to detecting style characteristics
  //   2. Direction FLIPPED for brightness/WB/tint (handled in route())
  //   3. Scene modifiers ENHANCE (>1) instead of SUPPRESS (<1)
  //   4. Shadow/highlight recovery suppressed (dark/bright extremes are intentional)
  var ILLUSTRATION_OVERRIDES = {
    // Lower thresholds → detect characteristics earlier to enhance
    brightnessSkewThreshold: 0.25,   // catch subtle brightness moods
    contrastMinDynamicRange: 80,     // detect contrast potential
    contrastMaxStd: 75,              // detect high contrast earlier
    vibranceMinMean: 0.30,
    saturationMinMean: 0.20,
    saturationMaxMean: 0.80,
    whiteBalanceMaxBias: 0.04,       // very sensitive to colour direction
    tintMaxBias: 0.03,               // very sensitive to tint direction
    shadowP5Threshold: 35,           // detect shadow character early
    highlightP95Threshold: 225,      // detect highlight character early
    clarityMinMidtoneRange: 40,      // more sensitive to midtone flatness

    // Moderate strengths — noticeable but not destructive
    globalStrength: 0.7,
    brightnessStrength: 0.4,
    contrastStrength: 0.45,
    contrastReductionStrength: 0.35,
    vibranceStrength: 0.5,
    saturationStrength: 0.4,
    desaturationStrength: 0.35,
    whiteBalanceStrength: 0.5,
    tintStrength: 0.4,
    shadowStrength: 0.15,            // mostly suppressed — deep shadows are intentional
    highlightStrength: 0.15,         // mostly suppressed — bright highlights are intentional
    clarityStrength: 0.4,            // moderate midtone enhancement

    sceneAwareness: 0.9,
  };

  // Illustration scene modifiers — enhancement-focused.
  // When a scene is detected, BOOST the relevant adjustments to amplify the style.
  var ILLUSTRATION_SCENE_MODIFIERS = {
    lowKey: {
      brightness:     1.25,    // push the darkness deeper
      contrast:       1.3,     // dramatic tonal separation
      clarity:        1.2,     // midtone texture adds mood
      shadowRecovery: 0.2,     // never recover — the shadows ARE the mood
      vibrance:       1.15,    // subtle colour richness in the dark
    },
    highKey: {
      brightness:        1.2,  // push the airy brightness
      contrast:          1.2,  // tonal separation in brights
      highlightRecovery: 0.3,  // don't pull highlights down
      vibrance:          1.15,
    },
    desaturated: {
      saturation:   0.7,       // don't add saturation
      vibrance:     0.6,       // don't add vibrance
      desaturation: 1.3,       // push the muted palette further
    },
    colorAccent: {
      desaturation: 0.2,       // strongly protect accent from desaturation
      saturation:   0.5,       // don't add uniform saturation (preserve vivid/muted contrast)
      vibrance:     0.7,       // moderate vibrance (targets low-sat areas, could close the gap)
    },
    warmTone: {
      whiteBalance: 1.3,       // push even warmer
      vibrance:     1.25,
      saturation:   1.2,
    },
    coolTone: {
      whiteBalance: 1.3,       // push even cooler
      vibrance:     1.25,
      saturation:   1.2,
    },
    highContrast: {
      contrast:          1.3,  // push more dramatic
      clarity:           1.25, // midtone punch matches the drama
      contrastReduction: 0.3,  // don't soften
      shadowRecovery:    0.4,
      highlightRecovery: 0.4,
    },
    silhouette: {
      brightness:        1.3,  // deepen the silhouette
      contrast:          1.4,  // maximum drama
      shadowRecovery:    0.15, // shadows are sacred
      vibrance:          1.2,  // vivid background sky
    },
    softDreamy: {
      contrast:          0.7,  // keep it soft — don't add contrast
      clarity:           0.5,  // softness is the aesthetic
      contrastReduction: 1.2,  // push softer
      vibrance:          1.25, // dreamy + colourful
      highlightRecovery: 0.5,
    },
    foggy: {
      contrast:          0.7,  // preserve the haze
      clarity:           0.4,  // haze = no midtone definition
      contrastReduction: 1.2,
      saturation:        0.7,
      vibrance:          0.8,
      shadowRecovery:    0.5,
    },
    goldenHour: {
      whiteBalance:   1.35,    // push the golden glow
      vibrance:       1.4,     // vivid warm tones
      saturation:     1.3,     // rich golden palette
      tintCorrection: 0.5,     // don't neutralise the tint
    },
    pastel: {
      contrast:          0.6,  // keep it soft — don't add contrast
      clarity:           0.4,  // pastels are soft — no midtone crunch
      contrastReduction: 1.2,  // push softer if needed
      vibrance:          1.2,  // enrich the candy palette
      desaturation:      0.5,  // protect pastel colors strongly
      highlightRecovery: 0.4,  // bright is the point
    },
    neon: {
      saturation:        1.3,  // push vivid colors harder
      vibrance:          1.35, // boost the neon pop
      contrast:          1.25, // dramatic punch
      clarity:           1.3,  // sharp midtone definition fits neon
      desaturation:      0.2,  // never dull neon
      whiteBalance:      0.6,  // preserve the cool cast
      contrastReduction: 0.3,  // don't soften
    },
    portrait: {
      vibrance: 1.2,           // lively skin tones
      contrast: 1.15,          // gentle drama
      saturation: 1.1,
    },
  };

  function defaultParams(mode) {
    var base = {
      brightnessSkewThreshold: 0.4,
      contrastMinDynamicRange: 100,
      contrastMaxStd: 85,
      vibranceMinMean: 0.30,
      saturationMinMean: 0.25,
      saturationMaxMean: 0.7,
      whiteBalanceMaxBias: 0.10,
      tintMaxBias: 0.06,
      shadowP5Threshold: 25,
      highlightP95Threshold: 235,
      clarityMinMidtoneRange: 50,

      brightnessTarget: 128,
      contrastTarget: 160,
      saturationTarget: 0.4,

      brightnessStrength: 0.6,
      contrastStrength: 0.5,
      contrastReductionStrength: 0.4,
      vibranceStrength: 0.6,
      saturationStrength: 0.5,
      desaturationStrength: 0.4,
      whiteBalanceStrength: 0.7,
      tintStrength: 0.6,
      shadowStrength: 0.5,
      highlightStrength: 0.5,
      clarityStrength: 0.45,

      globalStrength: 1.0,

      sceneAwareness: 0.85,
    };

    if (mode === MODES.ILLUSTRATION) {
      for (var key in ILLUSTRATION_OVERRIDES) {
        base[key] = ILLUSTRATION_OVERRIDES[key];
      }
    }

    return base;
  }

  function computeSceneMultipliers(scenes, awareness, modifierTable) {
    var multipliers = {};
    for (var key in ADJUSTMENT_TYPES) {
      multipliers[ADJUSTMENT_TYPES[key]] = 1.0;
    }

    if (!scenes || awareness <= 0) return multipliers;

    for (var i = 0; i < scenes.length; i++) {
      var scene = scenes[i];
      if (!scene.active) continue;
      var modifiers = modifierTable[scene.type];
      if (!modifiers) continue;

      for (var adjType in modifiers) {
        var target = modifiers[adjType];
        // Interpolate: at full confidence & awareness → reach target
        // multiplier = 1 + (target - 1) × confidence × awareness
        var delta = (target - 1) * scene.confidence * awareness;
        multipliers[adjType] *= Math.max(0, 1 + delta);
      }
    }

    return multipliers;
  }

  // ── Conflict Resolution ──
  // Detects contradictory or redundant active adjustments and attenuates them.
  // Rules:
  //   1. Mutually exclusive: contrast ↔ contrastReduction — keep stronger, deactivate weaker
  //   2. Mutually exclusive: saturation ↔ desaturation — keep stronger, deactivate weaker
  //   3. Overlap: vibrance + saturation — reduce saturation by 40% (vibrance covers it smarter)
  //   4. Double-lift: brightness(up) + shadowRecovery — reduce shadowRecovery by 30%
  //   5. Double-pull: brightness(down) + highlightRecovery — reduce highlightRecovery by 30%
  //   6. Overlap: clarity + contrast — reduce clarity by 40% (contrast already widens midtones)

  function resolveConflicts(adjustments) {
    var byType = {};
    for (var i = 0; i < adjustments.length; i++) {
      byType[adjustments[i].type] = adjustments[i];
    }

    var T = ADJUSTMENT_TYPES;

    // Rule 1: contrast vs contrastReduction — mutually exclusive
    var con = byType[T.CONTRAST];
    var conR = byType[T.CONTRAST_REDUCTION];
    if (con && conR && con.active && conR.active) {
      if (con.amount >= conR.amount) {
        conR.active = false;
        conR.conflictKey = "conflict.contrastWins";
      } else {
        con.active = false;
        con.conflictKey = "conflict.contrastReductionWins";
      }
    }

    // Rule 2: saturation vs desaturation — mutually exclusive
    var sat = byType[T.SATURATION];
    var desat = byType[T.DESATURATION];
    if (sat && desat && sat.active && desat.active) {
      if (sat.amount >= desat.amount) {
        desat.active = false;
        desat.conflictKey = "conflict.saturationWins";
      } else {
        sat.active = false;
        sat.conflictKey = "conflict.desaturationWins";
      }
    }

    // Rule 3: vibrance + saturation overlap — reduce saturation
    var vib = byType[T.VIBRANCE];
    if (vib && sat && vib.active && sat.active) {
      sat.amount *= 0.6;
      sat.conflictKey = "conflict.vibranceOverlap";
    }

    // Rule 4: brightness(up) + shadow recovery — double-lift
    var bri = byType[T.BRIGHTNESS];
    var shad = byType[T.SHADOW_RECOVERY];
    if (bri && shad && bri.active && shad.active && bri.direction > 0) {
      shad.amount *= 0.7;
      shad.conflictKey = "conflict.brightnessOverlap";
    }

    // Rule 5: brightness(down) + highlight recovery — double-pull
    var high = byType[T.HIGHLIGHT_RECOVERY];
    if (bri && high && bri.active && high.active && bri.direction < 0) {
      high.amount *= 0.7;
      high.conflictKey = "conflict.brightnessOverlap";
    }

    // Rule 6: clarity + contrast overlap — contrast already widens midtones
    var clar = byType[T.CLARITY];
    if (clar && con && clar.active && con.active) {
      clar.amount *= 0.6;
      clar.conflictKey = "conflict.contrastOverlap";
    }
  }

  // Illustration mode conviction: how confident are we this characteristic is
  // intentional (not accidental)?  Near threshold → ambiguous → barely enhance.
  // Well above threshold → clearly intentional → enhance fully.
  // Returns 0..1: 0 at threshold, 1 at 3× threshold.
  function illustrationConviction(absValue, threshold) {
    var ratio = absValue / threshold;
    if (ratio <= 1) return 0;
    var t = Math.min(1, (ratio - 1) / 2); // 0 at 1×, 1 at 3×
    return t * t * (3 - 2 * t);            // smoothstep
  }

  function route(diagnosis, params, scenes, mode) {
    var adjustments = [];
    var lum = diagnosis.luminance;
    var sat = diagnosis.saturation;
    var isIllust = mode === MODES.ILLUSTRATION;

    // ── Brightness ──
    // Photo: correct skew toward neutral.  Illustration: enhance the mood.
    if (Math.abs(lum.skewness) > params.brightnessSkewThreshold) {
      var direction = lum.skewness > 0 ? 1 : -1;
      var conviction = 1;
      if (isIllust) {
        direction = -direction;   // flip: push the mood further
        conviction = illustrationConviction(
          Math.abs(lum.skewness), params.brightnessSkewThreshold);
      }
      var magnitude =
        (Math.abs(lum.skewness) - params.brightnessSkewThreshold) /
        (3 - params.brightnessSkewThreshold);
      adjustments.push({
        type: ADJUSTMENT_TYPES.BRIGHTNESS,
        active: true,
        direction: direction,
        amount: Math.min(1, magnitude) * params.brightnessStrength * conviction,
        reasonKey: direction > 0 ? "reason.brightnessSkewsDark" : "reason.brightnessSkewsBright",
        reasonVal: lum.skewness.toFixed(2),
      });
    } else {
      adjustments.push({
        type: ADJUSTMENT_TYPES.BRIGHTNESS,
        active: false,
        reasonKey: "reason.brightnessBalanced",
        reasonVal: lum.skewness.toFixed(2),
      });
    }

    // ── Contrast enhancement (low contrast) ──
    if (lum.dynamicRange < params.contrastMinDynamicRange) {
      var deficit =
        (params.contrastMinDynamicRange - lum.dynamicRange) /
        params.contrastMinDynamicRange;
      adjustments.push({
        type: ADJUSTMENT_TYPES.CONTRAST,
        active: true,
        amount: Math.min(1, deficit) * params.contrastStrength,
        targetRange: params.contrastTarget,
        reasonKey: "reason.lowDynamicRange",
        reasonVal: lum.dynamicRange.toFixed(0),
      });
    } else {
      adjustments.push({
        type: ADJUSTMENT_TYPES.CONTRAST,
        active: false,
        reasonKey: "reason.adequateContrast",
        reasonVal: lum.dynamicRange.toFixed(0),
      });
    }

    // ── Contrast reduction (over-contrast) ──
    if (lum.std > params.contrastMaxStd) {
      var excess = (lum.std - params.contrastMaxStd) / (128 - params.contrastMaxStd);
      adjustments.push({
        type: ADJUSTMENT_TYPES.CONTRAST_REDUCTION,
        active: true,
        amount: Math.min(1, excess) * params.contrastReductionStrength,
        reasonKey: "reason.highContrast",
        reasonVal: lum.std.toFixed(1),
      });
    } else {
      adjustments.push({
        type: ADJUSTMENT_TYPES.CONTRAST_REDUCTION,
        active: false,
        reasonKey: "reason.contrastOk",
        reasonVal: lum.std.toFixed(1),
      });
    }

    // ── Vibrance (smart saturation for moderately low saturation) ──
    if (sat.mean < params.vibranceMinMean) {
      var deficit = (params.vibranceMinMean - sat.mean) / params.vibranceMinMean;
      adjustments.push({
        type: ADJUSTMENT_TYPES.VIBRANCE,
        active: true,
        amount: Math.min(1, deficit) * params.vibranceStrength,
        reasonKey: "reason.lowVibranceSaturation",
        reasonVal: sat.mean.toFixed(3),
      });
    } else {
      adjustments.push({
        type: ADJUSTMENT_TYPES.VIBRANCE,
        active: false,
        reasonKey: "reason.adequateVibrance",
        reasonVal: sat.mean.toFixed(3),
      });
    }

    // ── Saturation boost (low saturation — more aggressive, uniform) ──
    if (sat.mean < params.saturationMinMean) {
      var deficit = (params.saturationMinMean - sat.mean) / params.saturationMinMean;
      adjustments.push({
        type: ADJUSTMENT_TYPES.SATURATION,
        active: true,
        amount: Math.min(1, deficit) * params.saturationStrength,
        target: params.saturationTarget,
        reasonKey: "reason.lowSaturation",
        reasonVal: sat.mean.toFixed(3),
      });
    } else {
      adjustments.push({
        type: ADJUSTMENT_TYPES.SATURATION,
        active: false,
        reasonKey: "reason.adequateSaturation",
        reasonVal: sat.mean.toFixed(3),
      });
    }

    // ── Desaturation (over-saturation) ──
    if (sat.mean > params.saturationMaxMean) {
      var excess = (sat.mean - params.saturationMaxMean) / (1 - params.saturationMaxMean);
      adjustments.push({
        type: ADJUSTMENT_TYPES.DESATURATION,
        active: true,
        amount: Math.min(1, excess) * params.desaturationStrength,
        reasonKey: "reason.highSaturation",
        reasonVal: sat.mean.toFixed(3),
      });
    } else {
      adjustments.push({
        type: ADJUSTMENT_TYPES.DESATURATION,
        active: false,
        reasonKey: "reason.saturationOk",
        reasonVal: sat.mean.toFixed(3),
      });
    }

    // ── White balance ──
    // Photo: neutralise the cast.  Illustration: amplify the palette.
    if (Math.abs(diagnosis.colorTempBias) > params.whiteBalanceMaxBias) {
      var direction = diagnosis.colorTempBias > 0 ? -1 : 1;
      var conviction = 1;
      if (isIllust) {
        direction = -direction;   // flip: push the palette further
        conviction = illustrationConviction(
          Math.abs(diagnosis.colorTempBias), params.whiteBalanceMaxBias);
      }
      adjustments.push({
        type: ADJUSTMENT_TYPES.WHITE_BALANCE,
        active: true,
        direction: direction,
        amount:
          Math.min(1, Math.abs(diagnosis.colorTempBias) / 0.3) *
          params.whiteBalanceStrength * conviction,
        reasonKey: direction < 0 ? "reason.warmBias" : "reason.coolBias",
        reasonVal: diagnosis.colorTempBias.toFixed(3),
      });
    } else {
      adjustments.push({
        type: ADJUSTMENT_TYPES.WHITE_BALANCE,
        active: false,
        reasonKey: "reason.balancedColorTemp",
        reasonVal: diagnosis.colorTempBias.toFixed(3),
      });
    }

    // ── Tint ──
    // Photo: neutralise the tint.  Illustration: push the tonal character.
    if (Math.abs(diagnosis.tintBias) > params.tintMaxBias) {
      var direction = diagnosis.tintBias > 0 ? -1 : 1;
      var conviction = 1;
      if (isIllust) {
        direction = -direction;   // flip: enhance the tint
        conviction = illustrationConviction(
          Math.abs(diagnosis.tintBias), params.tintMaxBias);
      }
      adjustments.push({
        type: ADJUSTMENT_TYPES.TINT_CORRECTION,
        active: true,
        direction: direction,
        amount:
          Math.min(1, Math.abs(diagnosis.tintBias) / 0.2) *
          params.tintStrength * conviction,
        reasonKey: direction < 0 ? "reason.greenTint" : "reason.magentaTint",
        reasonVal: diagnosis.tintBias.toFixed(3),
      });
    } else {
      adjustments.push({
        type: ADJUSTMENT_TYPES.TINT_CORRECTION,
        active: false,
        reasonKey: "reason.balancedTint",
        reasonVal: diagnosis.tintBias.toFixed(3),
      });
    }

    // ── Shadow recovery ──
    if (lum.p5 < params.shadowP5Threshold) {
      adjustments.push({
        type: ADJUSTMENT_TYPES.SHADOW_RECOVERY,
        active: true,
        amount:
          Math.min(1, (params.shadowP5Threshold - lum.p5) / params.shadowP5Threshold) *
          params.shadowStrength,
        threshold: params.shadowP5Threshold,
        reasonKey: "reason.crushedShadows",
        reasonVal: lum.p5.toFixed(0),
      });
    } else {
      adjustments.push({
        type: ADJUSTMENT_TYPES.SHADOW_RECOVERY,
        active: false,
        reasonKey: "reason.shadowsOk",
        reasonVal: lum.p5.toFixed(0),
      });
    }

    // ── Highlight recovery ──
    if (lum.p95 > params.highlightP95Threshold) {
      adjustments.push({
        type: ADJUSTMENT_TYPES.HIGHLIGHT_RECOVERY,
        active: true,
        amount:
          Math.min(
            1,
            (lum.p95 - params.highlightP95Threshold) /
              (255 - params.highlightP95Threshold)
          ) * params.highlightStrength,
        threshold: params.highlightP95Threshold,
        reasonKey: "reason.blownHighlights",
        reasonVal: lum.p95.toFixed(0),
      });
    } else {
      adjustments.push({
        type: ADJUSTMENT_TYPES.HIGHLIGHT_RECOVERY,
        active: false,
        reasonKey: "reason.highlightsOk",
        reasonVal: lum.p95.toFixed(0),
      });
    }

    // ── Clarity (midtone contrast) ──
    // Triggers when the interquartile range (p25-p75) is compressed,
    // meaning midtones lack tonal separation even if overall range is fine.
    if (lum.midtoneRange < params.clarityMinMidtoneRange) {
      var deficit =
        (params.clarityMinMidtoneRange - lum.midtoneRange) /
        params.clarityMinMidtoneRange;
      adjustments.push({
        type: ADJUSTMENT_TYPES.CLARITY,
        active: true,
        amount: Math.min(1, deficit) * params.clarityStrength,
        reasonKey: "reason.flatMidtones",
        reasonVal: lum.midtoneRange.toFixed(0),
      });
    } else {
      adjustments.push({
        type: ADJUSTMENT_TYPES.CLARITY,
        active: false,
        reasonKey: "reason.midtonesOk",
        reasonVal: lum.midtoneRange.toFixed(0),
      });
    }

    // Apply scene-aware modifiers
    // Photo: suppression only.  Illustration: enhancement + selective suppression.
    var modTable = isIllust ? ILLUSTRATION_SCENE_MODIFIERS : SCENE_MODIFIERS;
    var multipliers = computeSceneMultipliers(scenes, params.sceneAwareness, modTable);
    for (var i = 0; i < adjustments.length; i++) {
      if (adjustments[i].active) {
        var m = multipliers[adjustments[i].type];
        adjustments[i].sceneMultiplier = m;
        adjustments[i].amount *= m;
        adjustments[i].sceneSuppressed = m < 0.5;
        adjustments[i].sceneEnhanced = m > 1.05;
      }
    }

    // ── Harmony guard ──
    // Structured color palettes (complementary, triadic, etc.) are deliberate.
    // Attenuate uniform saturation-family adjustments to preserve hue relationships.
    if (diagnosis.colorHarmony && diagnosis.colorHarmony.score > 0.3) {
      var harmonyType = diagnosis.colorHarmony.type;
      var isStructured = harmonyType === "complementary" ||
                         harmonyType === "splitComplementary" ||
                         harmonyType === "triadic" ||
                         harmonyType === "tetradic";
      if (isStructured) {
        var guard = 1 - diagnosis.colorHarmony.score * 0.4;
        for (var i = 0; i < adjustments.length; i++) {
          var aType = adjustments[i].type;
          if (adjustments[i].active &&
              (aType === ADJUSTMENT_TYPES.SATURATION || aType === ADJUSTMENT_TYPES.DESATURATION || aType === ADJUSTMENT_TYPES.VIBRANCE)) {
            adjustments[i].amount *= guard;
            adjustments[i].harmonyGuardKey = "conflict.harmonyGuard";
          }
        }
      }
    }

    // ── Conflict resolution ──
    resolveConflicts(adjustments);

    // Apply global strength
    for (var i = 0; i < adjustments.length; i++) {
      if (adjustments[i].active) {
        adjustments[i].amount *= params.globalStrength;
      }
    }

    return adjustments;
  }

  return {
    ADJUSTMENT_TYPES: ADJUSTMENT_TYPES,
    SCENE_MODIFIERS: SCENE_MODIFIERS,
    MODES: MODES,
    defaultParams: defaultParams,
    route: route,
  };
})();
