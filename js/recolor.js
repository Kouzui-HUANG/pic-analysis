// recolor.js — Automated recoloring engine
// Exposes: PicAnalysis.Recolor
//
// Architecture:
// - Each scheme defines a remap(h, s, l) function returning a target hue.
// - Multi-pole schemes (complementary, split-comp, triadic) use LUMINANCE
//   to decide which pole a pixel belongs to, avoiding hue-noise artifacts.
// - Hue shifts are applied as RGB-space rotations around the gray axis (1,1,1),
//   which naturally preserves achromatic pixels without any gating.

var PicAnalysis = PicAnalysis || {};

PicAnalysis.Recolor = (function () {
  var Color = PicAnalysis.Color;
  var Stats = PicAnalysis.Stats;

  // --- Palette extraction (for display only) ---

  function extractPalette(imageData, k) {
    k = k || 6;
    var data = imageData.data;
    var w = imageData.width;
    var h = imageData.height;

    var maxSamples = 3000;
    var totalPixels = w * h;
    var step = Math.max(1, Math.floor(totalPixels / maxSamples));
    var points = [];

    for (var i = 0; i < totalPixels; i += step) {
      var idx = i * 4;
      points.push([data[idx], data[idx + 1], data[idx + 2]]);
    }

    var clusters = Stats.kMeans(points, k, 20);
    clusters.sort(function (a, b) { return b.count - a.count; });

    var palette = [];
    for (var i = 0; i < clusters.length; i++) {
      var c = clusters[i];
      var r = Math.round(c.center[0]);
      var g = Math.round(c.center[1]);
      var b = Math.round(c.center[2]);
      var hsl = Color.rgbToHsl(r, g, b);
      palette.push({ rgb: [r, g, b], hsl: hsl, count: c.count });
    }
    return palette;
  }

  // --- Hue math ---

  function hueDist(a, b) {
    var d = b - a;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    return d;
  }

  function findDominantHue(palette) {
    var sx = 0, sy = 0, tw = 0;
    for (var i = 0; i < palette.length; i++) {
      if (palette[i].hsl[1] < 0.08) continue;
      var w = palette[i].count * palette[i].hsl[1];
      var angle = palette[i].hsl[0] * Math.PI * 2;
      sx += Math.cos(angle) * w;
      sy += Math.sin(angle) * w;
      tw += w;
    }
    if (tw < 1e-6) return 0;
    var h = Math.atan2(sy, sx) / (Math.PI * 2);
    return ((h % 1) + 1) % 1;
  }

  function findHueSpread(palette) {
    var hues = [];
    for (var i = 0; i < palette.length; i++) {
      if (palette[i].hsl[1] >= 0.08) hues.push(palette[i].hsl[0]);
    }
    if (hues.length < 2) return 0;
    hues.sort(function (a, b) { return a - b; });
    var maxGap = 0;
    for (var i = 1; i < hues.length; i++) {
      var gap = hues[i] - hues[i - 1];
      if (gap > maxGap) maxGap = gap;
    }
    var wrapGap = 1 - hues[hues.length - 1] + hues[0];
    if (wrapGap > maxGap) maxGap = wrapGap;
    return 1 - maxGap;
  }

  // Circular lerp: interpolate from hue `from` to hue `to` by factor t
  function circularLerp(from, to, t) {
    var d = hueDist(from, to);
    return ((from + d * t) % 1 + 1) % 1;
  }

  function smoothstep(t) {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
  }

  // --- Scheme definitions ---
  // remap(h, s, l) → target hue.
  // Hue-only schemes ignore s/l. Multi-pole schemes use luminance for
  // smooth, noise-free splitting.

  function makeScheme(remap, satMult, lumShift) {
    return { remap: remap, satMult: satMult || 1, lumShift: lumShift || 0 };
  }

  function schemeMonochromatic(palette, overrideHue) {
    var baseHue = overrideHue != null ? overrideHue : findDominantHue(palette);
    return makeScheme(function () { return baseHue; });
  }

  function schemeAnalogous(palette, overrideHue) {
    var baseHue = overrideHue != null ? overrideHue : findDominantHue(palette);
    var spread = Math.max(findHueSpread(palette), 0.05);
    var targetSpread = 1 / 6;
    return makeScheme(function (h) {
      var d = hueDist(baseHue, h);
      var compressed = d * (targetSpread / Math.max(spread, targetSpread));
      return ((baseHue + compressed) % 1 + 1) % 1;
    });
  }

  function schemeComplementary(palette, overrideHue) {
    var baseHue = overrideHue != null ? overrideHue : findDominantHue(palette);
    var complement = (baseHue + 0.5) % 1;
    return makeScheme(function (h, s, l) {
      var keep = smoothstep((l - 0.35) / 0.30);
      return circularLerp(complement, baseHue, keep);
    });
  }

  function schemeSplitComplementary(palette, overrideHue) {
    var baseHue = overrideHue != null ? overrideHue : findDominantHue(palette);
    var pole1 = (baseHue + 150 / 360) % 1;
    var pole2 = (baseHue + 210 / 360) % 1;
    return makeScheme(function (h, s, l) {
      if (l < 0.45) {
        var blend = smoothstep(l / 0.45);
        return circularLerp(pole2, baseHue, blend);
      }
      var blend = smoothstep((l - 0.45) / 0.45);
      return circularLerp(baseHue, pole1, blend);
    });
  }

  function schemeTriadic(palette, overrideHue) {
    var baseHue = overrideHue != null ? overrideHue : findDominantHue(palette);
    var pole1 = (baseHue + 1 / 3) % 1;
    var pole2 = (baseHue + 2 / 3) % 1;
    return makeScheme(function (h, s, l) {
      if (l < 0.45) {
        var blend = smoothstep(l / 0.45);
        return circularLerp(pole2, baseHue, blend);
      }
      var blend = smoothstep((l - 0.45) / 0.45);
      return circularLerp(baseHue, pole1, blend);
    });
  }

  function schemeWarmShift(palette, overrideHue) {
    var baseHue = overrideHue != null ? overrideHue : findDominantHue(palette);
    var warmTarget = 30 / 360;
    var rotation = hueDist(baseHue, warmTarget) * 0.55;
    return makeScheme(function (h) {
      return ((h + rotation) % 1 + 1) % 1;
    }, 1.08);
  }

  function schemeCoolShift(palette, overrideHue) {
    var baseHue = overrideHue != null ? overrideHue : findDominantHue(palette);
    var coolTarget = 210 / 360;
    var rotation = hueDist(baseHue, coolTarget) * 0.55;
    return makeScheme(function (h) {
      return ((h + rotation) % 1 + 1) % 1;
    }, 1.08);
  }

  function schemeHueRotate(palette, overrideHue) {
    return makeScheme(function (h) {
      return (h + 0.5) % 1;
    });
  }

  var SCHEMES = [
    { key: "monochromatic", fn: schemeMonochromatic },
    { key: "analogous", fn: schemeAnalogous },
    { key: "complementary", fn: schemeComplementary },
    { key: "splitComplementary", fn: schemeSplitComplementary },
    { key: "triadic", fn: schemeTriadic },
    { key: "warmShift", fn: schemeWarmShift },
    { key: "coolShift", fn: schemeCoolShift },
    { key: "hueRotate", fn: schemeHueRotate }
  ];

  // --- Skin tone detection ---
  // Returns 0-1 confidence that a pixel is skin-toned.
  // Uses smooth transitions (smoothstep) at boundaries for natural blending.
  // Hue range: 10°-50° (warm peach/brown), Sat: 0.15-0.65, Lum: 0.2-0.85

  var SKIN_HUE_LO = 10 / 360;   // ~0.028
  var SKIN_HUE_HI = 50 / 360;   // ~0.139
  var SKIN_HUE_PAD = 8 / 360;   // soft edge padding (~0.022)

  function skinScore(h, s, l) {
    // Hue: ramp up at lo edge, ramp down at hi edge
    var hScore = smoothstep((h - (SKIN_HUE_LO - SKIN_HUE_PAD)) / SKIN_HUE_PAD)
               * (1 - smoothstep((h - SKIN_HUE_HI) / SKIN_HUE_PAD));

    // Saturation: sweet spot 0.15-0.65 with soft edges
    var sScore = smoothstep((s - 0.08) / 0.10)
               * (1 - smoothstep((s - 0.55) / 0.15));

    // Luminance: sweet spot 0.2-0.85 with soft edges
    var lScore = smoothstep((l - 0.12) / 0.12)
               * (1 - smoothstep((l - 0.78) / 0.12));

    return hScore * sScore * lScore;
  }

  // --- Apply scheme via RGB-space hue rotation ---

  var SQRT_ONE_THIRD = Math.sqrt(1 / 3);

  // skinProtect: 0 = no protection, 1 = full protection (skin pixels keep original hue)
  // vibrance: -1 to +1, smart saturation — boosts low-sat pixels more, high-sat pixels less
  function applyScheme(imageData, scheme, skinProtect, vibrance) {
    var data = imageData.data;
    var w = imageData.width;
    var h = imageData.height;
    var out = new ImageData(w, h);
    var outData = out.data;
    var remap = scheme.remap;
    var satMult = scheme.satMult;
    var lumShift = scheme.lumShift;
    var useSkinProtect = skinProtect > 0;
    var useVibrance = vibrance != null && vibrance !== 0;

    var totalPixels = w * h;
    for (var p = 0; p < totalPixels; p++) {
      var idx = p * 4;
      var R = data[idx];
      var G = data[idx + 1];
      var B = data[idx + 2];
      var a = data[idx + 3];

      var hsl = Color.rgbToHsl(R, G, B);
      var targetH = remap(hsl[0], hsl[1], hsl[2]);
      var dh = hueDist(hsl[0], targetH);

      // Skin tone protection: reduce hue shift for skin-like pixels
      var sk = 0;
      if (useSkinProtect) {
        sk = skinScore(hsl[0], hsl[1], hsl[2]);
        if (sk > 0) {
          dh *= (1 - skinProtect * sk);
        }
      }

      var theta = dh * 2 * Math.PI;

      var cosT = Math.cos(theta);
      var sinT = Math.sin(theta);
      var omc3 = (1 - cosT) / 3;
      var s3 = SQRT_ONE_THIRD * sinT;

      var r = R / 255, g = G / 255, b = B / 255;
      var newR = (cosT + omc3) * r + (omc3 - s3) * g + (omc3 + s3) * b;
      var newG = (omc3 + s3) * r + (cosT + omc3) * g + (omc3 - s3) * b;
      var newB = (omc3 - s3) * r + (omc3 + s3) * g + (cosT + omc3) * b;

      if (satMult !== 1) {
        // Skin protection also reduces saturation change
        var effectiveSatMult = satMult;
        if (useSkinProtect && sk > 0) {
          effectiveSatMult = 1 + (satMult - 1) * (1 - skinProtect * sk);
        }
        var luma = 0.299 * newR + 0.587 * newG + 0.114 * newB;
        newR = luma + (newR - luma) * effectiveSatMult;
        newG = luma + (newG - luma) * effectiveSatMult;
        newB = luma + (newB - luma) * effectiveSatMult;
      }

      // Vibrance: smart saturation — low-sat pixels get more boost, high-sat pixels less
      if (useVibrance) {
        var vLuma = 0.299 * newR + 0.587 * newG + 0.114 * newB;
        var maxC = Math.max(newR, newG, newB);
        var minC = Math.min(newR, newG, newB);
        // Normalized chroma: 0 = achromatic, 1 = fully saturated
        var chroma = (maxC - minC);
        // Weight: low chroma → high weight (more boost), high chroma → low weight (less boost)
        var weight = 1 - chroma;
        // Skin protection: reduce vibrance effect on skin-toned pixels
        var effectiveVib = vibrance;
        if (useSkinProtect && sk > 0) {
          effectiveVib *= (1 - skinProtect * sk);
        }
        var boost = 1 + effectiveVib * weight;
        newR = vLuma + (newR - vLuma) * boost;
        newG = vLuma + (newG - vLuma) * boost;
        newB = vLuma + (newB - vLuma) * boost;
      }

      if (lumShift !== 0) {
        newR += lumShift;
        newG += lumShift;
        newB += lumShift;
      }

      outData[idx] = Math.max(0, Math.min(255, Math.round(newR * 255)));
      outData[idx + 1] = Math.max(0, Math.min(255, Math.round(newG * 255)));
      outData[idx + 2] = Math.max(0, Math.min(255, Math.round(newB * 255)));
      outData[idx + 3] = a;
    }
    return out;
  }

  // --- Build display palette from scheme ---

  function remapPalette(palette, scheme) {
    var remap = scheme.remap;
    var satMult = scheme.satMult;
    var result = [];
    for (var i = 0; i < palette.length; i++) {
      var p = palette[i];
      var newH = remap(p.hsl[0], p.hsl[1], p.hsl[2]);
      var newS = Color.clamp(p.hsl[1] * satMult, 0, 1);
      var newL = Color.clamp(p.hsl[2] + scheme.lumShift, 0, 1);
      var rgb = Color.hslToRgb(newH, newS, newL);
      result.push({ rgb: rgb, hsl: [newH, newS, newL], count: p.count });
    }
    return result;
  }

  // --- Public API ---

  // overrideHue: null = auto-detect, 0-1 = specific hue (hue wheel fraction)
  function generateSchemes(imageData, overrideHue) {
    var palette = extractPalette(imageData);
    var hueArg = overrideHue != null ? overrideHue : null;
    var results = [];
    for (var i = 0; i < SCHEMES.length; i++) {
      var schemeDef = SCHEMES[i];
      var scheme = schemeDef.fn(palette, hueArg);
      var newPalette = remapPalette(palette, scheme);
      results.push({
        key: schemeDef.key,
        originalPalette: palette,
        newPalette: newPalette,
        scheme: scheme
      });
    }
    return results;
  }

  // Blend recolored ImageData with original by strength (0=original, 1=full recolor)
  function blendWithOriginal(originalData, recoloredData, strength) {
    if (strength >= 1) return recoloredData;
    var w = originalData.width;
    var h = originalData.height;
    var out = new ImageData(w, h);
    var src = originalData.data;
    var rec = recoloredData.data;
    var dst = out.data;
    var s = strength;
    var inv = 1 - s;
    var len = src.length;
    for (var i = 0; i < len; i += 4) {
      dst[i]     = Math.round(src[i]     * inv + rec[i]     * s);
      dst[i + 1] = Math.round(src[i + 1] * inv + rec[i + 1] * s);
      dst[i + 2] = Math.round(src[i + 2] * inv + rec[i + 2] * s);
      dst[i + 3] = src[i + 3]; // preserve alpha
    }
    return out;
  }

  // Get the auto-detected dominant hue from image data (exposed for UI display)
  function getAutoHue(imageData) {
    var palette = extractPalette(imageData);
    return findDominantHue(palette);
  }

  return {
    extractPalette: extractPalette,
    generateSchemes: generateSchemes,
    applyScheme: applyScheme,
    blendWithOriginal: blendWithOriginal,
    getAutoHue: getAutoHue,
    SCHEMES: SCHEMES
  };
})();
