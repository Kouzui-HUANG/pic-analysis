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
    var sampleCount = Math.min(totalPixels, maxSamples);
    var step = totalPixels / sampleCount;

    // Jittered sampling: resist spatial patterns better than uniform step
    var labPoints = [];
    for (var i = 0; i < sampleCount; i++) {
      var base = Math.floor(i * step);
      var jitter = Math.floor(Math.random() * Math.min(step, totalPixels - base));
      var pixIdx = Math.min(base + jitter, totalPixels - 1);
      var idx = pixIdx * 4;
      var lab = Color.rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
      labPoints.push([lab[0], lab[1], lab[2]]);
    }

    // Cluster in perceptually uniform LAB space
    var clusters = Stats.kMeans(labPoints, k, 20);
    clusters.sort(function (a, b) { return b.count - a.count; });

    var palette = [];
    for (var i = 0; i < clusters.length; i++) {
      var c = clusters[i];
      var rgb = Color.labToRgb(c.center[0], c.center[1], c.center[2]);
      var hsl = Color.rgbToHsl(rgb[0], rgb[1], rgb[2]);
      palette.push({ rgb: rgb, hsl: hsl, count: c.count });
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
    // satMult 1.40: RGB-axis hue rotation collapses saturated pixels toward
    // the gray axis (the larger the rotation, the more chroma loss). For
    // mono-schemes, pixels whose source hue is far from baseHue undergo
    // near-180° rotations and lose most of their chroma. 1.40 compensates
    // that loss so post-rotation pixels still read as "this colour" rather
    // than "grey with a faint tint". Higher values risk oversaturation on
    // pixels already near baseHue (small rotation, minimal loss).
    return makeScheme(function () { return baseHue; }, 1.40);
  }

  function schemeAnalogous(palette, overrideHue) {
    var dominantHue = findDominantHue(palette);
    var spread = findHueSpread(palette);
    // Target fan 45° (1/8). 60° still left too much freedom for common
    // blue/warm-dominant inputs whose natural spread is ~90°-110°, producing
    // visually timid compression. 45° guarantees a clearly "tight" palette.
    var targetSpread = 1 / 8;
    // When no override, shift baseHue slightly off the dominant so that
    // already-narrow sources still exhibit a readable recolor. A fixed
    // +20° anchor shift (faded by source spread so very wide sources aren't
    // needlessly disturbed) turns analogous from a near-no-op into a
    // consistent "tighten + lean" recolor on any input.
    var anchorShift = 0;
    if (overrideHue == null) {
      var spreadFade = Math.max(0, 1 - spread / 0.35); // 1 at spread 0 → 0 at spread 0.35+
      anchorShift = (20 / 360) * spreadFade;
    }
    var baseHue = overrideHue != null
      ? overrideHue
      : ((dominantHue + anchorShift) % 1 + 1) % 1;
    // Normalize source spread onto target. Floor 0.3 allows meaningful
    // compression on wide inputs; ceiling 3.5 prevents near-mono inputs from
    // fanning out wildly.
    var ratio = targetSpread / Math.max(spread, 0.04);
    if (ratio < 0.3) ratio = 0.3;
    if (ratio > 3.5) ratio = 3.5;
    return makeScheme(function (h) {
      // Measure distance from original dominant hue, then re-center around baseHue
      var d = hueDist(dominantHue, h);
      var remapped = d * ratio;
      // Clamp remapped distance so expansion doesn't overshoot into the opposite side
      if (remapped > targetSpread) remapped = targetSpread;
      if (remapped < -targetSpread) remapped = -targetSpread;
      return ((baseHue + remapped) % 1 + 1) % 1;
    }, 1.15);
  }

  function schemeComplementary(palette, overrideHue, medianL) {
    var baseHue = overrideHue != null ? overrideHue : findDominantHue(palette);
    var complement = (baseHue + 0.5) % 1;
    // Clamp tightened vs original [0.2, 0.8]: a dark image previously got
    // mid=0.2 which collapsed almost all pixels into one pole. [0.30, 0.70]
    // keeps the split meaningful while ensuring medianL tracking.
    // IMPORTANT: transition width must stay narrow because interpolating
    // between two 180°-apart hues (base↔complement) passes through the
    // ambiguous green/magenta midpoint at keep=0.5 — every pixel in the
    // transition zone hits that artifact. halfBand 0.05 (was 0.08) shrinks
    // the artifact population ~40% on mid-luminance-dense images while still
    // giving enough width (0.10 total) for smooth AA at the boundary.
    var mid = Math.max(0.30, Math.min(0.70, medianL || 0.5));
    var halfBand = 0.05;
    return makeScheme(function (h, s, l) {
      var keep = smoothstep((l - (mid - halfBand)) / (halfBand * 2));
      return circularLerp(complement, baseHue, keep);
    }, 1.18);
  }

  // Three-pole lum-split remap used by split-complementary and triadic.
  // Previous formula used `smoothstep(l/mid)` for the dark half, which
  // saturates (→1) so aggressively that pixels at 70-90% of mid were already
  // 95%+ of the way back to baseHue — making pole2 effectively invisible for
  // night scenes. The fix: use a symmetric narrow transition band centered on
  // mid so dark pixels genuinely reach pole2 and bright pixels genuinely
  // reach pole1, with only a small neighborhood of mid as the transition.
  function makeThreePoleRemap(baseHue, pole1, pole2, mid, halfBand) {
    return function (h, s, l) {
      // Transition band: [mid - halfBand, mid + halfBand]
      // Below band → full pole2 (dark pole)
      // Above band → full pole1 (bright pole)
      // In band → ramp through baseHue at l=mid
      if (l <= mid - halfBand) return pole2;
      if (l >= mid + halfBand) return pole1;
      // Inside the band: split at the midpoint, lerp each half toward baseHue
      if (l < mid) {
        var blend = smoothstep((l - (mid - halfBand)) / halfBand);
        return circularLerp(pole2, baseHue, blend);
      }
      var blend2 = smoothstep((l - mid) / halfBand);
      return circularLerp(baseHue, pole1, blend2);
    };
  }

  function schemeSplitComplementary(palette, overrideHue, medianL) {
    var baseHue = overrideHue != null ? overrideHue : findDominantHue(palette);
    var pole1 = (baseHue + 150 / 360) % 1;
    var pole2 = (baseHue + 210 / 360) % 1;
    // Clamp tightened so dark/bright images still have meaningful splits.
    // halfBand 0.16 (up from 0.14): split-comp is the "soft multi-pole"
    // scheme — wider band gives a gradient-rainbow feel across midtones.
    // satMult 1.20: compensate for the two-pole 150°/210° rotation chroma loss
    // (worse than triadic's 120° rotations).
    var mid = Math.max(0.38, Math.min(0.62, medianL || 0.5));
    return makeScheme(makeThreePoleRemap(baseHue, pole1, pole2, mid, 0.16), 1.20);
  }

  function schemeTriadic(palette, overrideHue, medianL) {
    var baseHue = overrideHue != null ? overrideHue : findDominantHue(palette);
    var pole1 = (baseHue + 1 / 3) % 1;
    var pole2 = (baseHue + 2 / 3) % 1;
    // halfBand 0.09 (down from 0.14): triadic is the "crisp 3-way split"
    // scheme — narrow band creates cleaner three-zone segmentation without
    // muddy blends, differentiating it from split-complementary visually.
    // satMult 1.22: 120° rotations keep more chroma than split-comp's
    // 150°/210°, but narrow-band hard splits need extra vividness to read
    // as "triadic".
    var mid = Math.max(0.38, Math.min(0.62, medianL || 0.5));
    return makeScheme(makeThreePoleRemap(baseHue, pole1, pole2, mid, 0.09), 1.22);
  }

  // Adaptive temperature shift: pixels far from target get pushed harder
  // to avoid landing in undesirable intermediate hue zones (e.g. green).
  // Near pixels get a gentle nudge; opposite-side pixels get nearly full pull.
  //
  // minShift: when the source hue is already near the target, temperatureShift
  // would otherwise be a near no-op. We add a small forced rotation (scaled by
  // saturation) so warmShift/coolShift always produce a visible lean even on
  // already-warm / already-cool images.
  function temperatureShift(h, s, target, minShift) {
    var dist = hueDist(h, target);          // signed distance toward target
    var absDist = Math.abs(dist);
    // Adaptive strength: close hues get gentle nudge, far hues get strong push
    // Range 0.55→0.88 — higher floor than before so near-target pixels still
    // shift, and the ceiling clears intermediate zones (green) when crossing
    // 180° spans.
    var t = smoothstep(absDist / 0.42);
    var strength = 0.55 + 0.33 * t;
    // Only dampen near-achromatic pixels (s < ~0.20); chromatic pixels get full shift
    var satWeight = Math.min(1, smoothstep(s / 0.22));
    var shifted = h + dist * strength * satWeight;
    // Floor: for already-near-target pixels (absDist small), dist*strength is tiny.
    // Add a fixed perpendicular-style push (+minShift in the target direction)
    // so warmShift on warm images and coolShift on cool images still visibly
    // lean. Scaled by satWeight so greys stay grey.
    if (minShift && absDist < 0.20) {
      var floorFade = 1 - smoothstep(absDist / 0.20); // 1 at center, 0 at 0.20
      // Direction: toward target when at target, otherwise sign of existing dist.
      // When absDist≈0, use +minShift (forward on hue wheel).
      var dir = dist >= 0 ? 1 : -1;
      if (absDist < 0.01) dir = 1;
      shifted += dir * minShift * floorFade * satWeight;
    }
    return ((shifted) % 1 + 1) % 1;
  }

  function schemeWarmShift(palette, overrideHue) {
    var warmTarget = 30 / 360;
    // Floor 0.06 (~22°) keeps already-warm images visibly moving.
    // satMult 1.30 compensates for RGB-axis rotation chroma loss.
    return makeScheme(function (h, s) {
      return temperatureShift(h, s, warmTarget, 0.06);
    }, 1.30);
  }

  function schemeCoolShift(palette, overrideHue) {
    var coolTarget = 210 / 360;
    // Negative minShift pushes toward cooler (lower hue values when already blue).
    return makeScheme(function (h, s) {
      return temperatureShift(h, s, coolTarget, -0.06);
    }, 1.30);
  }

  function schemeHueRotate(palette, overrideHue) {
    // 180° rotation passes pixels through the achromatic gray plane along the
    // RGB (1,1,1) axis, causing severe chroma loss. satMult 1.35 (down from
    // 1.45): previous value pushed already-saturated pixels into fluorescent
    // territory (e.g. skin hues on a pink→green flip became neon-sickly).
    // 1.35 still compensates most of the chroma loss without neon-ifying
    // already-vivid sources.
    return makeScheme(function (h) {
      return (h + 0.5) % 1;
    }, 1.35);
  }

  // Identity scheme: no hue remapping — just passes through auto-correction
  function schemeNoRecolor() {
    return makeScheme(function (h) { return h; });
  }

  var SCHEMES = [
    { key: "noRecolor", fn: schemeNoRecolor },
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

  // Remap palette using the EXACT same math as applyScheme so that the
  // displayed swatches honestly preview the rendered result. Previously this
  // used LCH-based hue rotation while applyScheme used HSL-driven RGB-axis
  // rotation, causing the swatches to show e.g. "blue" while the actual image
  // came out purple/pink for the same target hue label.
  function remapPalette(palette, scheme) {
    var remap = scheme.remap;
    var satMult = scheme.satMult;
    var lumShift = scheme.lumShift;
    var result = [];
    for (var i = 0; i < palette.length; i++) {
      var p = palette[i];
      var R = p.rgb[0], G = p.rgb[1], B = p.rgb[2];
      var targetH = remap(p.hsl[0], p.hsl[1], p.hsl[2]);
      var dh = hueDist(p.hsl[0], targetH);
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
        var luma = 0.299 * newR + 0.587 * newG + 0.114 * newB;
        newR = luma + (newR - luma) * satMult;
        newG = luma + (newG - luma) * satMult;
        newB = luma + (newB - luma) * satMult;
      }
      if (lumShift !== 0) {
        newR += lumShift; newG += lumShift; newB += lumShift;
      }

      var outR = Math.max(0, Math.min(255, Math.round(newR * 255)));
      var outG = Math.max(0, Math.min(255, Math.round(newG * 255)));
      var outB = Math.max(0, Math.min(255, Math.round(newB * 255)));
      var rgb = [outR, outG, outB];
      var hsl = Color.rgbToHsl(outR, outG, outB);
      result.push({ rgb: rgb, hsl: hsl, count: p.count });
    }
    return result;
  }

  // --- Public API ---

  // Weighted median lightness from palette (for adaptive split points)
  function paletteMedianL(palette) {
    var items = [];
    var total = 0;
    for (var i = 0; i < palette.length; i++) {
      items.push({ l: palette[i].hsl[2], count: palette[i].count });
      total += palette[i].count;
    }
    items.sort(function (a, b) { return a.l - b.l; });
    var half = total / 2;
    var cum = 0;
    for (var i = 0; i < items.length; i++) {
      cum += items[i].count;
      if (cum >= half) return items[i].l;
    }
    return 0.5;
  }

  // overrideHue: null = auto-detect, 0-1 = specific hue (hue wheel fraction)
  function generateSchemes(imageData, overrideHue) {
    var palette = extractPalette(imageData);
    var hueArg = overrideHue != null ? overrideHue : null;
    var medianL = paletteMedianL(palette);
    var results = [];
    for (var i = 0; i < SCHEMES.length; i++) {
      var schemeDef = SCHEMES[i];
      var scheme = schemeDef.fn(palette, hueArg, medianL);
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

  // --- Generate hue variants for a scheme ---
  // Returns 2 variants of the same scheme logic at different base hues, or
  // null if the scheme doesn't support hue variants.
  //
  // Strategy: probe 6 evenly-spaced anchor hues (0/60/120/180/240/300 — red,
  // yellow, green, cyan, blue, magenta), compute what each one ACTUALLY
  // renders to (via the same RGB-axis rotation used for the image), then pick
  // the two whose rendered dominants are most distant from the current
  // rendered colour and from each other. The reported `hue` is the rendered
  // dominant hue, not the input target — so the °-label the UI shows always
  // matches the colour the user will actually get.
  //
  // Without this, +120°/+240° offsets on a yellow (37°) source produced
  // labels "157°/277°" but the RGB-axis rotation through highly-saturated
  // pixels collapses the result into purple/magenta, never reaching blue.

  var NO_VARIANTS = { noRecolor: 1, warmShift: 1, coolShift: 1, hueRotate: 1 };

  function paletteDominantRgb(palette) {
    // Weighted average RGB of the most populous chromatic clusters
    var sr = 0, sg = 0, sb = 0, tw = 0;
    for (var i = 0; i < palette.length; i++) {
      var p = palette[i];
      var w = p.count * Math.max(p.hsl[1], 0.05);
      sr += p.rgb[0] * w; sg += p.rgb[1] * w; sb += p.rgb[2] * w; tw += w;
    }
    if (tw < 1e-6) return [128, 128, 128];
    return [sr / tw, sg / tw, sb / tw];
  }

  function paletteDominantHue(palette) {
    var rgb = paletteDominantRgb(palette);
    var hsl = Color.rgbToHsl(rgb[0], rgb[1], rgb[2]);
    return hsl[0];
  }

  function hueAbsDist(a, b) {
    var d = Math.abs(a - b);
    return d > 0.5 ? 1 - d : d;
  }

  function generateVariants(schemeKey, originalPalette, currentHue, medianL) {
    if (NO_VARIANTS[schemeKey]) return null;

    var schemeDef = null;
    for (var i = 0; i < SCHEMES.length; i++) {
      if (SCHEMES[i].key === schemeKey) { schemeDef = SCHEMES[i]; break; }
    }
    if (!schemeDef) return null;

    // Reference hue = what the CURRENT scheme actually renders to
    var currentScheme = schemeDef.fn(originalPalette, currentHue, medianL);
    var currentPalette = remapPalette(originalPalette, currentScheme);
    var currentRenderedHue = paletteDominantHue(currentPalette);

    // 6 anchor targets — red, yellow, green, cyan, blue, magenta
    var anchors = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];
    var candidates = [];
    for (var ai = 0; ai < anchors.length; ai++) {
      var sc = schemeDef.fn(originalPalette, anchors[ai], medianL);
      var pal = remapPalette(originalPalette, sc);
      var renderedHue = paletteDominantHue(pal);
      candidates.push({
        scheme: sc,
        newPalette: pal,
        hue: renderedHue,           // labelled by actual output
        targetHue: anchors[ai],
        distFromCurrent: hueAbsDist(renderedHue, currentRenderedHue)
      });
    }

    // Sort by distance from current rendered hue (most different first)
    candidates.sort(function (a, b) { return b.distFromCurrent - a.distFromCurrent; });

    // Pick the most distant, then the next most distant that is also far
    // from the first pick (so the two alternatives don't look alike).
    var first = candidates[0];
    var second = null;
    var bestSpread = -1;
    for (var ci = 1; ci < candidates.length; ci++) {
      var c = candidates[ci];
      var spread = Math.min(c.distFromCurrent, hueAbsDist(c.hue, first.hue));
      if (spread > bestSpread) { bestSpread = spread; second = c; }
    }
    if (!second) second = candidates[1];

    return [
      { scheme: first.scheme,  newPalette: first.newPalette,  hue: first.hue },
      { scheme: second.scheme, newPalette: second.newPalette, hue: second.hue }
    ];
  }

  return {
    extractPalette: extractPalette,
    generateSchemes: generateSchemes,
    applyScheme: applyScheme,
    blendWithOriginal: blendWithOriginal,
    getAutoHue: getAutoHue,
    skinScore: skinScore,
    paletteMedianL: paletteMedianL,
    generateVariants: generateVariants,
    SCHEMES: SCHEMES
  };
})();
