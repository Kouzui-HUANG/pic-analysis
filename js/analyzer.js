// analyzer.js — Stage 1: Image Analysis
// Extracts statistical diagnosis from raw pixel data.
// Exposes: PicAnalysis.Analyzer

var PicAnalysis = PicAnalysis || {};

PicAnalysis.Analyzer = (function () {
  var Color = PicAnalysis.Color;
  var Stats = PicAnalysis.Stats;

  var HISTOGRAM_BINS = 256;
  var KMEANS_SAMPLE = 2000;
  var KMEANS_K = 6;
  var REGION_GRID = 3;

  function analyze(imageData) {
    var data = imageData.data;
    var width = imageData.width;
    var height = imageData.height;
    var pixelCount = width * height;

    var lumValues = new Float32Array(pixelCount);
    var satValues = new Float32Array(pixelCount);

    var rSum = 0, gSum = 0, bSum = 0;

    for (var i = 0; i < pixelCount; i++) {
      var off = i * 4;
      var r = data[off];
      var g = data[off + 1];
      var b = data[off + 2];

      lumValues[i] = Color.luminance(r, g, b);

      var hsl = Color.rgbToHsl(r, g, b);
      satValues[i] = hsl[1];

      rSum += r;
      gSum += g;
      bSum += b;
    }

    // Luminance statistics
    var lumMean = Stats.mean(lumValues);
    var lumStd = Stats.std(lumValues, lumMean);
    var lumSkew = Stats.skewness(lumValues, lumMean, lumStd);
    var lumSorted = Float32Array.from(lumValues).sort();
    var lumP5 = Stats.percentile(lumSorted, 5);
    var lumP25 = Stats.percentile(lumSorted, 25);
    var lumP75 = Stats.percentile(lumSorted, 75);
    var lumP95 = Stats.percentile(lumSorted, 95);
    var dynamicRange = lumP95 - lumP5;
    var midtoneRange = lumP75 - lumP25;
    var lumHistogram = Stats.histogram(lumValues, HISTOGRAM_BINS, 0, 255);

    // Saturation statistics
    var satMean = Stats.mean(satValues);
    var satStd = Stats.std(satValues, satMean);

    // Color temperature bias (warm/cool: red vs blue)
    var rMean = rSum / pixelCount;
    var bMean = bSum / pixelCount;
    var gMean = gSum / pixelCount;
    var colorTempBias = (rMean - bMean) / 255;

    // Tint bias (green/magenta axis)
    // Positive = green tint, Negative = magenta tint
    var tintBias = (gMean - (rMean + bMean) / 2) / 255;

    // Dominant colors via K-means (subsample for performance)
    var sampleStep = Math.max(1, Math.floor(pixelCount / KMEANS_SAMPLE));
    var colorSamples = [];
    for (var i = 0; i < pixelCount; i += sampleStep) {
      var off = i * 4;
      colorSamples.push([data[off], data[off + 1], data[off + 2]]);
    }
    var dominantColors = Stats.kMeans(colorSamples, KMEANS_K);

    // Regional analysis (3x3 grid)
    var regions = buildRegionStats(data, width, height, REGION_GRID);
    var regionSummary = buildRegionSummary(regions);

    // Color harmony analysis
    var colorHarmony = analyzeColorHarmony(dominantColors);

    // Channel histograms for display
    var rValues = new Float32Array(pixelCount);
    var gValues = new Float32Array(pixelCount);
    var bValues = new Float32Array(pixelCount);
    for (var i = 0; i < pixelCount; i++) {
      var off = i * 4;
      rValues[i] = data[off];
      gValues[i] = data[off + 1];
      bValues[i] = data[off + 2];
    }

    return {
      width: width,
      height: height,
      pixelCount: pixelCount,
      luminance: {
        mean: lumMean,
        std: lumStd,
        skewness: lumSkew,
        p5: lumP5,
        p25: lumP25,
        p75: lumP75,
        p95: lumP95,
        dynamicRange: dynamicRange,
        midtoneRange: midtoneRange,
        histogram: lumHistogram,
      },
      saturation: {
        mean: satMean,
        std: satStd,
      },
      colorTempBias: colorTempBias,
      tintBias: tintBias,
      channels: {
        rMean: rMean,
        gMean: gMean,
        bMean: bMean,
        rHistogram: Stats.histogram(rValues, HISTOGRAM_BINS, 0, 255),
        gHistogram: Stats.histogram(gValues, HISTOGRAM_BINS, 0, 255),
        bHistogram: Stats.histogram(bValues, HISTOGRAM_BINS, 0, 255),
      },
      dominantColors: dominantColors,
      regions: regions,
      regionSummary: regionSummary,
      colorHarmony: colorHarmony,
    };
  }

  function buildRegionStats(data, width, height, gridSize) {
    var regions = [];
    var cellW = Math.floor(width / gridSize);
    var cellH = Math.floor(height / gridSize);

    for (var gy = 0; gy < gridSize; gy++) {
      for (var gx = 0; gx < gridSize; gx++) {
        var startX = gx * cellW;
        var startY = gy * cellH;
        var endX = gx === gridSize - 1 ? width : startX + cellW;
        var endY = gy === gridSize - 1 ? height : startY + cellH;

        var lumSum = 0, satSum = 0, count = 0;

        for (var y = startY; y < endY; y++) {
          for (var x = startX; x < endX; x++) {
            var off = (y * width + x) * 4;
            lumSum += Color.luminance(data[off], data[off + 1], data[off + 2]);
            var hsl = Color.rgbToHsl(data[off], data[off + 1], data[off + 2]);
            satSum += hsl[1];
            count++;
          }
        }

        regions.push({
          gx: gx,
          gy: gy,
          lumMean: lumSum / count,
          satMean: satSum / count,
        });
      }
    }
    return regions;
  }

  // Summarize regional data for strategy and display
  function buildRegionSummary(regions) {
    var lumValues = [];
    var satValues = [];
    var darkest = { idx: 0, lum: 999 };
    var brightest = { idx: 0, lum: -1 };

    for (var i = 0; i < regions.length; i++) {
      lumValues.push(regions[i].lumMean);
      satValues.push(regions[i].satMean);
      if (regions[i].lumMean < darkest.lum) {
        darkest = { idx: i, lum: regions[i].lumMean, gx: regions[i].gx, gy: regions[i].gy };
      }
      if (regions[i].lumMean > brightest.lum) {
        brightest = { idx: i, lum: regions[i].lumMean, gx: regions[i].gx, gy: regions[i].gy };
      }
    }

    var lumMin = darkest.lum;
    var lumMax = brightest.lum;
    var regionContrast = lumMax - lumMin;

    // Center region (index 4 in 3x3 grid)
    var centerLum = regions[4] ? regions[4].lumMean : 0;
    // Average of edge regions
    var edgeIndices = [0, 1, 2, 3, 5, 6, 7, 8];
    var edgeLumSum = 0;
    for (var i = 0; i < edgeIndices.length; i++) {
      edgeLumSum += regions[edgeIndices[i]].lumMean;
    }
    var edgeLumMean = edgeLumSum / edgeIndices.length;
    // Positive = center brighter than edges (spotlight/vignette-in)
    // Negative = center darker than edges (backlit/vignette-out)
    var centerEdgeDiff = centerLum - edgeLumMean;

    // Region position labels (for UI)
    var posLabels = ["TL", "TC", "TR", "ML", "MC", "MR", "BL", "BC", "BR"];

    return {
      regionContrast: regionContrast,
      darkest: darkest,
      brightest: brightest,
      centerLum: centerLum,
      edgeLumMean: edgeLumMean,
      centerEdgeDiff: centerEdgeDiff,
      darkestPos: posLabels[darkest.idx],
      brightestPos: posLabels[brightest.idx],
    };
  }

  // ═══════════════════════════════════════════
  // Color Harmony Analysis
  // ═══════════════════════════════════════════

  function analyzeColorHarmony(dominantColors) {
    if (!dominantColors || dominantColors.length === 0) {
      return { type: "neutral", score: 0, hues: [], description: "" };
    }

    // Extract hues from dominant colors (only chromatic ones)
    var hueData = [];
    var totalCount = 0;
    for (var i = 0; i < dominantColors.length; i++) {
      totalCount += dominantColors[i].count;
    }

    for (var i = 0; i < dominantColors.length; i++) {
      var c = dominantColors[i];
      var hsl = Color.rgbToHsl(c.center[0], c.center[1], c.center[2]);
      var weight = c.count / totalCount;
      // Only consider colors with meaningful saturation
      if (hsl[1] > 0.08 && weight > 0.03) {
        hueData.push({
          hue: hsl[0] * 360, // degrees
          sat: hsl[1],
          lum: hsl[2],
          weight: weight,
        });
      }
    }

    // If mostly achromatic
    if (hueData.length === 0) {
      return { type: "neutral", score: 1.0, hues: [], typeKey: "harmony.neutral" };
    }
    if (hueData.length === 1) {
      return { type: "monochromatic", score: 1.0, hues: [hueData[0].hue], typeKey: "harmony.monochromatic" };
    }

    // Cluster hues into groups (merge hues within 25°)
    var hueClusters = clusterHues(hueData, 25);

    if (hueClusters.length === 1) {
      return { type: "monochromatic", score: 1.0, hues: [hueClusters[0].hue], typeKey: "harmony.monochromatic" };
    }

    // Test each harmony pattern and find best match
    var bestMatch = { type: "diverse", score: 0, typeKey: "harmony.diverse" };
    var clusterHueValues = hueClusters.map(function (c) { return c.hue; });

    // Analogous: all hues within ~60°
    var hueSpread = maxHueSpread(clusterHueValues);
    if (hueSpread <= 60) {
      var score = 1 - (hueSpread / 60);
      if (score > bestMatch.score) {
        bestMatch = { type: "analogous", score: score, typeKey: "harmony.analogous" };
      }
    }

    if (hueClusters.length >= 2) {
      // Complementary: two hue groups ~180° apart
      var compScore = testComplementary(clusterHueValues);
      if (compScore > bestMatch.score) {
        bestMatch = { type: "complementary", score: compScore, typeKey: "harmony.complementary" };
      }

      // Split-complementary: one hue + two hues ~150° away on each side
      var splitScore = testSplitComplementary(clusterHueValues);
      if (splitScore > bestMatch.score) {
        bestMatch = { type: "splitComplementary", score: splitScore, typeKey: "harmony.splitComplementary" };
      }
    }

    if (hueClusters.length >= 3) {
      // Triadic: three hues ~120° apart
      var triadScore = testTriadic(clusterHueValues);
      if (triadScore > bestMatch.score) {
        bestMatch = { type: "triadic", score: triadScore, typeKey: "harmony.triadic" };
      }
    }

    if (hueClusters.length >= 4) {
      // Tetradic: four hues ~90° apart
      var tetScore = testTetradic(clusterHueValues);
      if (tetScore > bestMatch.score) {
        bestMatch = { type: "tetradic", score: tetScore, typeKey: "harmony.tetradic" };
      }
    }

    bestMatch.hues = clusterHueValues;
    return bestMatch;
  }

  // Cluster hues that are within `threshold` degrees of each other
  function clusterHues(hueData, threshold) {
    // Sort by weight descending
    var sorted = hueData.slice().sort(function (a, b) { return b.weight - a.weight; });
    var clusters = [];

    for (var i = 0; i < sorted.length; i++) {
      var merged = false;
      for (var j = 0; j < clusters.length; j++) {
        if (hueDist(sorted[i].hue, clusters[j].hue) < threshold) {
          // Weighted average merge
          var totalW = clusters[j].weight + sorted[i].weight;
          clusters[j].hue = weightedHueAvg(clusters[j].hue, clusters[j].weight,
                                             sorted[i].hue, sorted[i].weight);
          clusters[j].weight = totalW;
          merged = true;
          break;
        }
      }
      if (!merged) {
        clusters.push({ hue: sorted[i].hue, weight: sorted[i].weight });
      }
    }
    return clusters;
  }

  function hueDist(a, b) {
    var d = Math.abs(a - b);
    return d > 180 ? 360 - d : d;
  }

  function weightedHueAvg(h1, w1, h2, w2) {
    // Handle wrapping around 360°
    if (Math.abs(h1 - h2) > 180) {
      if (h1 < h2) h1 += 360;
      else h2 += 360;
    }
    var avg = (h1 * w1 + h2 * w2) / (w1 + w2);
    return ((avg % 360) + 360) % 360;
  }

  function maxHueSpread(hues) {
    if (hues.length <= 1) return 0;
    var minSpread = 360;
    // Try each hue as the "start" and measure the arc that contains all hues
    for (var i = 0; i < hues.length; i++) {
      var offsets = [];
      for (var j = 0; j < hues.length; j++) {
        var d = ((hues[j] - hues[i]) % 360 + 360) % 360;
        offsets.push(d);
      }
      offsets.sort(function (a, b) { return a - b; });
      var spread = offsets[offsets.length - 1] - offsets[0];
      if (spread < minSpread) minSpread = spread;
    }
    return minSpread;
  }

  // Test how well hues fit complementary pattern (~180° apart)
  function testComplementary(hues) {
    if (hues.length < 2) return 0;
    var bestScore = 0;
    for (var i = 0; i < hues.length; i++) {
      for (var j = i + 1; j < hues.length; j++) {
        var dist = hueDist(hues[i], hues[j]);
        // Score peaks at 180°, falls off with tolerance of 30°
        var deviation = Math.abs(dist - 180);
        if (deviation < 30) {
          var score = 1 - (deviation / 30);
          if (score > bestScore) bestScore = score;
        }
      }
    }
    return bestScore;
  }

  // Test split-complementary: one hue + two hues ~150° and ~210° away
  function testSplitComplementary(hues) {
    if (hues.length < 3) return 0;
    var bestScore = 0;
    for (var i = 0; i < hues.length; i++) {
      var scores = [];
      for (var j = 0; j < hues.length; j++) {
        if (j === i) continue;
        var dist = hueDist(hues[i], hues[j]);
        // Should be ~150° (tolerance 20°)
        var deviation = Math.abs(dist - 150);
        if (deviation < 20) {
          scores.push(1 - (deviation / 20));
        }
      }
      if (scores.length >= 2) {
        scores.sort(function (a, b) { return b - a; });
        var score = (scores[0] + scores[1]) / 2;
        if (score > bestScore) bestScore = score;
      }
    }
    return bestScore;
  }

  // Test triadic: three hues ~120° apart
  function testTriadic(hues) {
    if (hues.length < 3) return 0;
    var bestScore = 0;
    for (var i = 0; i < hues.length; i++) {
      for (var j = i + 1; j < hues.length; j++) {
        for (var k = j + 1; k < hues.length; k++) {
          var d1 = hueDist(hues[i], hues[j]);
          var d2 = hueDist(hues[j], hues[k]);
          var d3 = hueDist(hues[i], hues[k]);
          var dev1 = Math.abs(d1 - 120);
          var dev2 = Math.abs(d2 - 120);
          var dev3 = Math.abs(d3 - 120);
          var maxDev = Math.max(dev1, dev2, dev3);
          if (maxDev < 25) {
            var score = 1 - (maxDev / 25);
            if (score > bestScore) bestScore = score;
          }
        }
      }
    }
    return bestScore;
  }

  // Test tetradic: four hues ~90° apart
  function testTetradic(hues) {
    if (hues.length < 4) return 0;
    var bestScore = 0;
    for (var i = 0; i < hues.length; i++) {
      var dists = [];
      for (var j = 0; j < hues.length; j++) {
        if (j === i) continue;
        dists.push(hueDist(hues[i], hues[j]));
      }
      dists.sort(function (a, b) { return a - b; });
      // Check if closest 3 are ~90°, ~180°, ~270°
      if (dists.length >= 3) {
        var dev1 = Math.abs(dists[0] - 90);
        var dev2 = Math.abs(dists[1] - 180);
        var dev3 = Math.abs(dists[2] - 270);
        var maxDev = Math.max(dev1, dev2, dev3);
        if (maxDev < 25) {
          var score = 1 - (maxDev / 25);
          if (score > bestScore) bestScore = score;
        }
      }
    }
    return bestScore;
  }

  return {
    analyze: analyze,
  };
})();
