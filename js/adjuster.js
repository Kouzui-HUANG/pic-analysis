// adjuster.js — Stage 3: Adjustment Pipeline
// Applies a list of adjustments to image pixel data.
// Exposes: PicAnalysis.Adjuster

var PicAnalysis = PicAnalysis || {};

PicAnalysis.Adjuster = (function () {
  var Color = PicAnalysis.Color;
  var TYPES = PicAnalysis.Strategy.ADJUSTMENT_TYPES;

  // ── Per-adjustment protection profiles ──
  // Each value (0-1) controls how strongly that protection dimension applies.
  // 0 = no protection (full adjustment), 1 = original cubic/quadratic curve.
  //
  // Design rationale for each type:
  //   brightness       — protect extremes from being pushed further; grays are fine
  //   contrast         — needs range at both ends to stretch tones apart
  //   contrastReduc.   — compressing is gentler, moderate protection
  //   saturation       — must protect achromatic pixels (adding color to grays = noise)
  //   desaturation     — reducing saturation is inherently safe
  //   whiteBalance     — MUST affect neutral grays (that's where casts show most)
  //   tintCorrection   — same reasoning as white balance
  //   shadowRecovery   — MUST affect dark pixels (that's its job)
  //   highlightRecov.  — MUST affect bright pixels (that's its job)
  var PROTECTION_PROFILES = {};
  PROTECTION_PROFILES[TYPES.BRIGHTNESS]        = { highlight: 1.0, shadow: 1.0, achromatic: 0.3 };
  PROTECTION_PROFILES[TYPES.CONTRAST]          = { highlight: 0.6, shadow: 0.6, achromatic: 0.3 };
  PROTECTION_PROFILES[TYPES.CONTRAST_REDUCTION]= { highlight: 0.7, shadow: 0.7, achromatic: 0.2 };
  PROTECTION_PROFILES[TYPES.SATURATION]        = { highlight: 0.8, shadow: 0.8, achromatic: 1.0 };
  PROTECTION_PROFILES[TYPES.DESATURATION]      = { highlight: 0.2, shadow: 0.2, achromatic: 0.0 };
  PROTECTION_PROFILES[TYPES.WHITE_BALANCE]     = { highlight: 0.7, shadow: 0.4, achromatic: 0.0 };
  PROTECTION_PROFILES[TYPES.TINT_CORRECTION]   = { highlight: 0.7, shadow: 0.4, achromatic: 0.0 };
  PROTECTION_PROFILES[TYPES.SHADOW_RECOVERY]   = { highlight: 0.0, shadow: 0.0, achromatic: 0.4 };
  PROTECTION_PROFILES[TYPES.HIGHLIGHT_RECOVERY]= { highlight: 0.0, shadow: 0.0, achromatic: 0.3 };
  PROTECTION_PROFILES[TYPES.VIBRANCE]          = { highlight: 0.7, shadow: 0.7, achromatic: 0.4 };
  PROTECTION_PROFILES[TYPES.CLARITY]           = { highlight: 0.0, shadow: 0.0, achromatic: 0.2 };

  // Default profile for unknown types (matches original behavior)
  var DEFAULT_PROFILE = { highlight: 1.0, shadow: 1.0, achromatic: 1.0 };

  // Protection factor for extreme-luminance and low-chroma pixels.
  // Returns 0-1: 0 = fully protected (skip adjustment), 1 = full adjustment.
  // `profile` controls per-dimension strength (0 = no protection, 1 = full curve).
  function edgeProtection(r, g, b, profile) {
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    var maxC = Math.max(r, g, b);
    var minC = Math.min(r, g, b);
    var chroma = (maxC - minC) / 255;

    var factor = 1;

    // Protect highlights: cubic falloff from lum=0.8 to lum=1.0
    if (profile.highlight > 0 && lum > 0.8) {
      var t = (lum - 0.8) / 0.2;
      var inv = 1 - t;
      var raw = inv * inv * inv;            // 1 at 0.8, 0 at 1.0
      factor *= 1 - profile.highlight * (1 - raw);
    }

    // Protect shadows: cubic ramp from lum=0 to lum=0.1
    if (profile.shadow > 0 && lum < 0.1) {
      var t = lum / 0.1;
      var raw = t * t * t;                  // 0 at 0, 1 at 0.1
      factor *= 1 - profile.shadow * (1 - raw);
    }

    // Protect achromatic pixels: if R≈G≈B, color adjustments create noise
    if (profile.achromatic > 0 && chroma < 0.1) {
      var t = chroma / 0.1;
      var raw = t * t;                      // 0 at 0, 1 at 0.1
      factor *= 1 - profile.achromatic * (1 - raw);
    }

    return factor;
  }

  function adjust(sourceImageData, adjustments) {
    var result = new ImageData(
      new Uint8ClampedArray(sourceImageData.data),
      sourceImageData.width,
      sourceImageData.height
    );

    for (var i = 0; i < adjustments.length; i++) {
      var adj = adjustments[i];
      if (!adj.active) continue;
      var fn = APPLY_FNS[adj.type];
      if (fn) fn(result.data, adj);
    }

    return result;
  }

  // --- Individual adjustment functions ---

  // Brightness, contrast, and contrast reduction operate in LAB L* space.
  // LAB L* is perceptually uniform: equal ΔL* = equal perceived change.
  // This avoids the hue shifts that HSL lightness adjustments can cause
  // (e.g. saturated blues shifting toward cyan when brightened in HSL).
  // L* range is 0-100; we normalise to 0-1 for curve math, then scale back.

  function applyBrightness(data, adj) {
    var profile = PROTECTION_PROFILES[TYPES.BRIGHTNESS];
    var shift = adj.direction * adj.amount * 30; // L* scale (0-100)
    for (var i = 0; i < data.length; i += 4) {
      var prot = edgeProtection(data[i], data[i + 1], data[i + 2], profile);
      if (prot < 0.001) continue;
      var lab = Color.rgbToLab(data[i], data[i + 1], data[i + 2]);
      lab[0] = Color.clamp(lab[0] + shift * prot, 0, 100);
      var rgb = Color.labToRgb(lab[0], lab[1], lab[2]);
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    }
  }

  function applyContrast(data, adj) {
    var profile = PROTECTION_PROFILES[TYPES.CONTRAST];
    var factor = 1 + adj.amount * 2;
    for (var i = 0; i < data.length; i += 4) {
      var prot = edgeProtection(data[i], data[i + 1], data[i + 2], profile);
      if (prot < 0.001) continue;
      var lab = Color.rgbToLab(data[i], data[i + 1], data[i + 2]);
      var normL = lab[0] / 100;  // normalise to 0-1 for curve
      var centered = normL - 0.5;
      var curved =
        0.5 + centered * factor * (1 / (1 + Math.abs(centered * factor)));
      var newNormL = Color.clamp(normL + (curved - normL) * prot, 0, 1);
      lab[0] = newNormL * 100;
      var rgb = Color.labToRgb(lab[0], lab[1], lab[2]);
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    }
  }

  function applyContrastReduction(data, adj) {
    var profile = PROTECTION_PROFILES[TYPES.CONTRAST_REDUCTION];
    // Inverse of contrast enhancement: compress tonal range toward midtones
    var factor = 1 / (1 + adj.amount * 1.5);
    for (var i = 0; i < data.length; i += 4) {
      var prot = edgeProtection(data[i], data[i + 1], data[i + 2], profile);
      if (prot < 0.001) continue;
      var lab = Color.rgbToLab(data[i], data[i + 1], data[i + 2]);
      var normL = lab[0] / 100;
      var centered = normL - 0.5;
      var compressed = 0.5 + centered * factor;
      var newNormL = Color.clamp(normL + (compressed - normL) * prot, 0, 1);
      lab[0] = newNormL * 100;
      var rgb = Color.labToRgb(lab[0], lab[1], lab[2]);
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    }
  }

  function applySaturation(data, adj) {
    var profile = PROTECTION_PROFILES[TYPES.SATURATION];
    var boost = 1 + adj.amount * 1.5;
    for (var i = 0; i < data.length; i += 4) {
      var prot = edgeProtection(data[i], data[i + 1], data[i + 2], profile);
      if (prot < 0.001) continue;
      var hsl = Color.rgbToHsl(data[i], data[i + 1], data[i + 2]);
      var targetS = Color.clamp(hsl[1] * boost, 0, 1);
      var newS = hsl[1] + (targetS - hsl[1]) * prot;
      var rgb = Color.hslToRgb(hsl[0], newS, hsl[2]);
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    }
  }

  function applyDesaturation(data, adj) {
    var profile = PROTECTION_PROFILES[TYPES.DESATURATION];
    // Reduce saturation toward neutral
    var reduce = 1 / (1 + adj.amount * 1.5);
    for (var i = 0; i < data.length; i += 4) {
      var prot = edgeProtection(data[i], data[i + 1], data[i + 2], profile);
      if (prot < 0.001) continue;
      var hsl = Color.rgbToHsl(data[i], data[i + 1], data[i + 2]);
      var targetS = hsl[1] * reduce;
      var newS = hsl[1] + (targetS - hsl[1]) * prot;
      var rgb = Color.hslToRgb(hsl[0], newS, hsl[2]);
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    }
  }

  function applyWhiteBalance(data, adj) {
    var profile = PROTECTION_PROFILES[TYPES.WHITE_BALANCE];
    // LAB b* axis: negative = blue, positive = yellow
    // direction: -1 = cool (shift b* negative), +1 = warm (shift b* positive)
    var labShift = adj.direction * adj.amount * 25;
    for (var i = 0; i < data.length; i += 4) {
      var prot = edgeProtection(data[i], data[i + 1], data[i + 2], profile);
      if (prot < 0.001) continue;
      var lab = Color.rgbToLab(data[i], data[i + 1], data[i + 2]);
      lab[2] += labShift * prot;      // shift b* (blue-yellow axis)
      lab[1] += labShift * prot * 0.2; // slight a* nudge for natural look
      var rgb = Color.labToRgb(lab[0], lab[1], lab[2]);
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    }
  }

  function applyTintCorrection(data, adj) {
    var profile = PROTECTION_PROFILES[TYPES.TINT_CORRECTION];
    // LAB a* axis: negative = green, positive = magenta
    // direction from strategy: -1 = fix green tint (push a* positive, toward magenta)
    //                          +1 = fix magenta tint (push a* negative, toward green)
    // Negate because strategy direction is "reduce this tint" but LAB a* is inverted
    var labShift = -adj.direction * adj.amount * 18;
    for (var i = 0; i < data.length; i += 4) {
      var prot = edgeProtection(data[i], data[i + 1], data[i + 2], profile);
      if (prot < 0.001) continue;
      var lab = Color.rgbToLab(data[i], data[i + 1], data[i + 2]);
      lab[1] += labShift * prot;      // shift a* (green-magenta axis)
      var rgb = Color.labToRgb(lab[0], lab[1], lab[2]);
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    }
  }

  function applyShadowRecovery(data, adj) {
    var profile = PROTECTION_PROFILES[TYPES.SHADOW_RECOVERY];
    var lift = adj.amount * 50;
    var threshold = adj.threshold || 60;
    for (var i = 0; i < data.length; i += 4) {
      var hsl = Color.rgbToHsl(data[i], data[i + 1], data[i + 2]);
      var lumVal = hsl[2] * 255;
      if (lumVal < threshold) {
        var prot = edgeProtection(data[i], data[i + 1], data[i + 2], profile);
        if (prot < 0.001) continue;
        var t = 1 - lumVal / threshold;
        var liftAmount = (lift / 255) * t * t * prot;
        var newL = Color.clamp(hsl[2] + liftAmount, 0, 1);
        var rgb = Color.hslToRgb(hsl[0], hsl[1], newL);
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
      }
    }
  }

  function applyHighlightRecovery(data, adj) {
    var profile = PROTECTION_PROFILES[TYPES.HIGHLIGHT_RECOVERY];
    var pull = adj.amount * 40;
    var threshold = adj.threshold || 220;
    for (var i = 0; i < data.length; i += 4) {
      var hsl = Color.rgbToHsl(data[i], data[i + 1], data[i + 2]);
      var lumVal = hsl[2] * 255;
      if (lumVal > threshold) {
        var prot = edgeProtection(data[i], data[i + 1], data[i + 2], profile);
        if (prot < 0.001) continue;
        var t = (lumVal - threshold) / (255 - threshold);
        var pullAmount = (pull / 255) * t * t * prot;
        if (pullAmount < 0.001) continue;
        var newL = Color.clamp(hsl[2] - pullAmount, 0, 1);
        var rgb = Color.hslToRgb(hsl[0], hsl[1], newL);
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
      }
    }
  }

  function applyVibrance(data, adj) {
    var profile = PROTECTION_PROFILES[TYPES.VIBRANCE];
    var strength = adj.amount * 0.8;
    for (var i = 0; i < data.length; i += 4) {
      // Skip truly achromatic pixels — hue is meaningless, boosting creates color artifacts
      var maxC = Math.max(data[i], data[i + 1], data[i + 2]);
      var minC = Math.min(data[i], data[i + 1], data[i + 2]);
      var chroma = (maxC - minC) / 255;
      if (chroma < 0.02) continue;

      var prot = edgeProtection(data[i], data[i + 1], data[i + 2], profile);
      if (prot < 0.001) continue;
      var hsl = Color.rgbToHsl(data[i], data[i + 1], data[i + 2]);

      // 1. Inverse saturation weighting: boost low-sat pixels more, leave saturated ones alone
      var satWeight = 1 - hsl[1];

      // 2. Skin tone protection: hue ~15°-50° with moderate saturation
      var hueDeg = hsl[0] * 360;
      var skinFactor = 1;
      if (hueDeg >= 10 && hueDeg <= 55 && hsl[1] > 0.15 && hsl[1] < 0.7) {
        // Smooth proximity to skin-tone center (~30°)
        var skinCenter = 30;
        var skinDist = Math.abs(hueDeg - skinCenter) / 25;
        var skinProx = Math.max(0, 1 - skinDist);
        skinFactor = 1 - skinProx * 0.65;
      }

      // 3. Over-saturation guard: extra dampening as saturation approaches 0.8+
      var ceilingGuard = hsl[1] > 0.7 ? 1 - ((hsl[1] - 0.7) / 0.3) : 1;

      // 4. Low-chroma fade-in: smooth ramp from chroma 0.02 to 0.08
      var chromaRamp = chroma < 0.08 ? (chroma - 0.02) / 0.06 : 1;

      var boost = strength * satWeight * skinFactor * ceilingGuard * chromaRamp * prot;
      var newS = Color.clamp(hsl[1] + boost, 0, 1);
      var rgb = Color.hslToRgb(hsl[0], newS, hsl[2]);
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    }
  }

  // Clarity: midtone contrast enhancement in LAB L* space.
  // Uses a bell-shaped weight centred on L*=50 that fades to 0 at the
  // shadow (L*<20) and highlight (L*>80) boundaries, so only the
  // midtone range gets the contrast S-curve.  Shadows and highlights
  // are left untouched — this is the key difference from global contrast.
  function applyClarity(data, adj) {
    var profile = PROTECTION_PROFILES[TYPES.CLARITY];
    var factor = 1 + adj.amount * 1.8;
    for (var i = 0; i < data.length; i += 4) {
      var prot = edgeProtection(data[i], data[i + 1], data[i + 2], profile);
      if (prot < 0.001) continue;
      var lab = Color.rgbToLab(data[i], data[i + 1], data[i + 2]);
      var normL = lab[0] / 100;

      // Bell-shaped midtone weight: peaks at 0.5, fades at <0.2 and >0.8
      var midWeight;
      if (normL < 0.2 || normL > 0.8) {
        midWeight = 0;
      } else if (normL < 0.35) {
        var t = (normL - 0.2) / 0.15;
        midWeight = t * t;          // smooth ramp up
      } else if (normL > 0.65) {
        var t = (0.8 - normL) / 0.15;
        midWeight = t * t;          // smooth ramp down
      } else {
        midWeight = 1;              // full effect in 0.35-0.65
      }

      if (midWeight < 0.001) continue;

      // Apply S-curve only to midtone portion
      var centered = normL - 0.5;
      var curved = 0.5 + centered * factor * (1 / (1 + Math.abs(centered * factor)));
      var delta = (curved - normL) * midWeight * prot;
      lab[0] = Color.clamp((normL + delta) * 100, 0, 100);
      var rgb = Color.labToRgb(lab[0], lab[1], lab[2]);
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    }
  }

  var APPLY_FNS = {};
  APPLY_FNS[TYPES.BRIGHTNESS] = applyBrightness;
  APPLY_FNS[TYPES.CONTRAST] = applyContrast;
  APPLY_FNS[TYPES.CONTRAST_REDUCTION] = applyContrastReduction;
  APPLY_FNS[TYPES.SATURATION] = applySaturation;
  APPLY_FNS[TYPES.DESATURATION] = applyDesaturation;
  APPLY_FNS[TYPES.WHITE_BALANCE] = applyWhiteBalance;
  APPLY_FNS[TYPES.TINT_CORRECTION] = applyTintCorrection;
  APPLY_FNS[TYPES.SHADOW_RECOVERY] = applyShadowRecovery;
  APPLY_FNS[TYPES.HIGHLIGHT_RECOVERY] = applyHighlightRecovery;
  APPLY_FNS[TYPES.VIBRANCE] = applyVibrance;
  APPLY_FNS[TYPES.CLARITY] = applyClarity;

  return {
    PROTECTION_PROFILES: PROTECTION_PROFILES,
    adjust: adjust,
  };
})();
