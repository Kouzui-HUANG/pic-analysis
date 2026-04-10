// transfer.js — Reference-image color matching engine
// Exposes: PicAnalysis.Transfer
//
// Three-layer architecture:
//   1. LAB statistical transfer (Reinhard et al.) — matches L/a/b mean & std
//      to align luminance, contrast and overall color cast.
//   2. Histogram matching on the L channel — fine-tunes shadow/midtone/
//      highlight distribution shape.
//   3. Hue alignment — RGB-axis hue rotation that maps the target image's
//      dominant hues toward the reference image's dominant hues, with skin
//      protection (reuses Recolor.skinScore).
//
// Each layer has an independent strength slider (0–1). The final result can
// be blended back with the original via `detailRetain` for safety.

var PicAnalysis = PicAnalysis || {};

PicAnalysis.Transfer = (function () {
  var Color = PicAnalysis.Color;
  var Recolor = PicAnalysis.Recolor;

  var SQRT_ONE_THIRD = Math.sqrt(1 / 3);
  var HIST_BINS = 256;

  // ─────────────────────────────────────────────
  // Profile builder
  // ─────────────────────────────────────────────
  // Compute everything we need from the reference image, once. The result is
  // small (a few hundred numbers) so it can be cached cheaply.

  function buildProfile(refImageData) {
    var data = refImageData.data;
    var w = refImageData.width;
    var h = refImageData.height;
    var pixelCount = w * h;

    // Subsample for stats: cap at ~200k samples for speed.
    var maxSamples = 200000;
    var step = Math.max(1, Math.floor(pixelCount / maxSamples));

    var Lsum = 0, Asum = 0, Bsum = 0;
    var Lsq = 0, Asq = 0, Bsq = 0;
    var n = 0;
    var lumHist = new Float64Array(HIST_BINS);

    for (var i = 0; i < pixelCount; i += step) {
      var off = i * 4;
      var lab = Color.rgbToLab(data[off], data[off + 1], data[off + 2]);
      var L = lab[0], A = lab[1], B = lab[2];
      Lsum += L; Asum += A; Bsum += B;
      Lsq += L * L; Asq += A * A; Bsq += B * B;
      n++;

      // Luminance histogram on perceptual L (0..100), bucketed to 256
      var bin = Math.floor(L * 2.55);
      if (bin < 0) bin = 0;
      if (bin > 255) bin = 255;
      lumHist[bin]++;
    }

    var Lmean = Lsum / n, Amean = Asum / n, Bmean = Bsum / n;
    var Lstd = Math.sqrt(Math.max(0, Lsq / n - Lmean * Lmean));
    var Astd = Math.sqrt(Math.max(0, Asq / n - Amean * Amean));
    var Bstd = Math.sqrt(Math.max(0, Bsq / n - Bmean * Bmean));

    // Normalize histogram → CDF
    var cdf = new Float64Array(HIST_BINS);
    var cum = 0;
    for (var i = 0; i < HIST_BINS; i++) {
      cum += lumHist[i];
      cdf[i] = cum / n;
    }

    // Palette + dominant hues from Recolor module
    var palette = Recolor.extractPalette(refImageData, 6);
    var dominantHues = [];
    for (var i = 0; i < palette.length; i++) {
      if (palette[i].hsl[1] >= 0.10) {
        dominantHues.push({
          hue: palette[i].hsl[0],
          weight: palette[i].count * palette[i].hsl[1]
        });
      }
    }

    return {
      labStats: {
        L: { mean: Lmean, std: Math.max(Lstd, 0.5) },
        a: { mean: Amean, std: Math.max(Astd, 0.5) },
        b: { mean: Bmean, std: Math.max(Bstd, 0.5) }
      },
      lumCDF: cdf,
      palette: palette,
      dominantHues: dominantHues
    };
  }

  // ─────────────────────────────────────────────
  // Source stats — quick LAB stats from target image
  // ─────────────────────────────────────────────

  function buildSourceStats(targetImageData) {
    var data = targetImageData.data;
    var w = targetImageData.width;
    var h = targetImageData.height;
    var pixelCount = w * h;
    var maxSamples = 200000;
    var step = Math.max(1, Math.floor(pixelCount / maxSamples));

    var Lsum = 0, Asum = 0, Bsum = 0;
    var Lsq = 0, Asq = 0, Bsq = 0;
    var n = 0;
    var lumHist = new Float64Array(HIST_BINS);

    for (var i = 0; i < pixelCount; i += step) {
      var off = i * 4;
      var lab = Color.rgbToLab(data[off], data[off + 1], data[off + 2]);
      var L = lab[0], A = lab[1], B = lab[2];
      Lsum += L; Asum += A; Bsum += B;
      Lsq += L * L; Asq += A * A; Bsq += B * B;
      n++;
      var bin = Math.floor(L * 2.55);
      if (bin < 0) bin = 0;
      if (bin > 255) bin = 255;
      lumHist[bin]++;
    }
    var Lmean = Lsum / n, Amean = Asum / n, Bmean = Bsum / n;
    var Lstd = Math.sqrt(Math.max(0, Lsq / n - Lmean * Lmean));
    var Astd = Math.sqrt(Math.max(0, Asq / n - Amean * Amean));
    var Bstd = Math.sqrt(Math.max(0, Bsq / n - Bmean * Bmean));

    var cdf = new Float64Array(HIST_BINS);
    var cum = 0;
    for (var i = 0; i < HIST_BINS; i++) {
      cum += lumHist[i];
      cdf[i] = cum / n;
    }

    // Dominant hues from target palette
    var palette = Recolor.extractPalette(targetImageData, 6);
    var dominantHues = [];
    for (var i = 0; i < palette.length; i++) {
      if (palette[i].hsl[1] >= 0.10) {
        dominantHues.push({
          hue: palette[i].hsl[0],
          weight: palette[i].count * palette[i].hsl[1]
        });
      }
    }

    return {
      labStats: {
        L: { mean: Lmean, std: Math.max(Lstd, 0.5) },
        a: { mean: Amean, std: Math.max(Astd, 0.5) },
        b: { mean: Bmean, std: Math.max(Bstd, 0.5) }
      },
      lumCDF: cdf,
      palette: palette,
      dominantHues: dominantHues
    };
  }

  // ─────────────────────────────────────────────
  // Histogram matching lookup table
  // ─────────────────────────────────────────────
  // For each source bin, find target bin whose CDF best matches.

  function buildHistMatchLUT(srcCDF, tgtCDF) {
    var lut = new Uint8Array(HIST_BINS);
    var j = 0;
    for (var i = 0; i < HIST_BINS; i++) {
      var s = srcCDF[i];
      while (j < HIST_BINS - 1 && tgtCDF[j] < s) j++;
      lut[i] = j;
    }
    return lut;
  }

  // ─────────────────────────────────────────────
  // Hue mapping from source dominants to target dominants
  // ─────────────────────────────────────────────

  function hueDist(a, b) {
    var d = b - a;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    return d; // signed shortest distance
  }

  // For each source dominant hue, find the nearest target dominant hue
  // (by absolute distance) and record the signed shift.
  function buildHueMap(sourceDoms, targetDoms) {
    if (!sourceDoms.length || !targetDoms.length) return [];
    var map = [];
    for (var i = 0; i < sourceDoms.length; i++) {
      var sh = sourceDoms[i].hue;
      var bestIdx = 0, bestAbs = 1;
      for (var j = 0; j < targetDoms.length; j++) {
        var d = Math.abs(hueDist(sh, targetDoms[j].hue));
        if (d < bestAbs) { bestAbs = d; bestIdx = j; }
      }
      map.push({
        sourceHue: sh,
        shift: hueDist(sh, targetDoms[bestIdx].hue),
        weight: sourceDoms[i].weight
      });
    }
    return map;
  }

  // For a given pixel hue, blend the per-anchor shifts weighted by
  // proximity (Gaussian falloff). Pixels far from any anchor get a small
  // shift; pixels near an anchor get the full shift to that anchor.
  function pixelHueShift(h, hueMap) {
    if (!hueMap.length) return 0;
    var totalW = 0, totalShift = 0;
    var sigma = 0.10; // 36° falloff
    var twoSigSq = 2 * sigma * sigma;
    for (var i = 0; i < hueMap.length; i++) {
      var d = hueDist(hueMap[i].sourceHue, h);
      var w = hueMap[i].weight * Math.exp(-(d * d) / twoSigSq);
      totalW += w;
      totalShift += hueMap[i].shift * w;
    }
    return totalW > 1e-9 ? totalShift / totalW : 0;
  }

  // ─────────────────────────────────────────────
  // Main entry — apply all three layers
  // ─────────────────────────────────────────────

  function match(targetImageData, profile, options) {
    options = options || {};
    var lumStrength = clamp01(options.lumStrength != null ? options.lumStrength : 0.8);
    var colorStrength = clamp01(options.colorStrength != null ? options.colorStrength : 0.8);
    var hueStrength = clamp01(options.hueStrength != null ? options.hueStrength : 0.6);
    var histShape = clamp01(options.histogramShape != null ? options.histogramShape : 0.3);
    var skinProtect = clamp01(options.skinProtect != null ? options.skinProtect : 0.5);
    var detailRetain = clamp01(options.detailRetain != null ? options.detailRetain : 0);
    var overall = clamp01(options.overallStrength != null ? options.overallStrength : 1);

    // Source stats are needed for both layer 1 and layer 2.
    var src = buildSourceStats(targetImageData);

    // Layer 2 LUT (we apply it inline with layer 1 for one-pass speed).
    var histLUT = histShape > 0
      ? buildHistMatchLUT(src.lumCDF, profile.lumCDF)
      : null;

    // Layer 3 hue map
    var hueMap = (hueStrength > 0)
      ? buildHueMap(src.dominantHues, profile.dominantHues)
      : [];

    var data = targetImageData.data;
    var w = targetImageData.width;
    var h = targetImageData.height;
    var out = new ImageData(w, h);
    var outData = out.data;
    var pixels = w * h;

    var sL = src.labStats, tL = profile.labStats;
    // Pre-compute per-channel scale factors
    var Lscale = tL.L.std / sL.L.std;
    var Ascale = tL.a.std / sL.a.std;
    var Bscale = tL.b.std / sL.b.std;
    var Lmean_s = sL.L.mean, Lmean_t = tL.L.mean;
    var Amean_s = sL.a.mean, Amean_t = tL.a.mean;
    var Bmean_s = sL.b.mean, Bmean_t = tL.b.mean;

    for (var p = 0; p < pixels; p++) {
      var idx = p * 4;
      var R0 = data[idx], G0 = data[idx + 1], B0 = data[idx + 2], A0 = data[idx + 3];

      // ── Layer 3: hue alignment (in HSL) ──
      var R = R0, G = G0, B = B0;
      var skinW = 0;
      if (hueStrength > 0 && hueMap.length) {
        var hsl = Color.rgbToHsl(R0, G0, B0);
        if (hsl[1] > 0.05) {
          var rawShift = pixelHueShift(hsl[0], hueMap);
          var effShift = rawShift * hueStrength;

          // Skin protection
          if (skinProtect > 0) {
            skinW = Recolor.skinScore(hsl[0], hsl[1], hsl[2]);
            if (skinW > 0) effShift *= (1 - skinProtect * skinW);
          }

          if (Math.abs(effShift) > 1e-6) {
            // RGB-axis hue rotation (matches Recolor.applyScheme math)
            var theta = effShift * 2 * Math.PI;
            var cosT = Math.cos(theta);
            var sinT = Math.sin(theta);
            var omc3 = (1 - cosT) / 3;
            var s3 = SQRT_ONE_THIRD * sinT;
            var rN = R0 / 255, gN = G0 / 255, bN = B0 / 255;
            var nR = (cosT + omc3) * rN + (omc3 - s3) * gN + (omc3 + s3) * bN;
            var nG = (omc3 + s3) * rN + (cosT + omc3) * gN + (omc3 - s3) * bN;
            var nB = (omc3 - s3) * rN + (omc3 + s3) * gN + (cosT + omc3) * bN;
            R = clamp255(nR * 255);
            G = clamp255(nG * 255);
            B = clamp255(nB * 255);
          }
        }
      }

      // ── Layer 1: LAB statistical transfer ──
      var lab = Color.rgbToLab(R, G, B);
      var L = lab[0], a = lab[1], b = lab[2];

      // Reinhard mapping with per-channel strength
      var Lnew = lerp(L, (L - Lmean_s) * Lscale + Lmean_t, lumStrength);
      var Anew = lerp(a, (a - Amean_s) * Ascale + Amean_t, colorStrength);
      var Bnew = lerp(b, (b - Bmean_s) * Bscale + Bmean_t, colorStrength);

      // ── Layer 2: histogram shaping on L (blend with current Lnew) ──
      if (histLUT) {
        var srcBin = Math.floor(L * 2.55);
        if (srcBin < 0) srcBin = 0;
        if (srcBin > 255) srcBin = 255;
        var matchedL = histLUT[srcBin] / 2.55;
        Lnew = lerp(Lnew, matchedL, histShape);
      }

      // Skin protection on stat transfer too — keeps faces stable
      if (skinW > 0 && skinProtect > 0) {
        var keep = skinProtect * skinW;
        Lnew = lerp(Lnew, L, keep);
        Anew = lerp(Anew, a, keep);
        Bnew = lerp(Bnew, b, keep);
      }

      var rgb = Color.labToRgb(Lnew, Anew, Bnew);

      // Overall + detail-retain blend with the ORIGINAL untouched pixel
      var blendOut = overall * (1 - detailRetain);
      var blendOrig = 1 - blendOut;
      outData[idx]     = clamp255(rgb[0] * blendOut + R0 * blendOrig);
      outData[idx + 1] = clamp255(rgb[1] * blendOut + G0 * blendOrig);
      outData[idx + 2] = clamp255(rgb[2] * blendOut + B0 * blendOrig);
      outData[idx + 3] = A0;
    }

    return out;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function clamp255(v) {
    v = Math.round(v);
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  return {
    buildProfile: buildProfile,
    buildSourceStats: buildSourceStats,
    match: match
  };
})();
