// stats.js — Statistical computation utilities
// Exposes: PicAnalysis.Stats

var PicAnalysis = PicAnalysis || {};

PicAnalysis.Stats = (function () {
  function mean(arr) {
    if (arr.length === 0) return 0;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  function std(arr, avg) {
    if (arr.length === 0) return 0;
    if (avg === undefined) avg = mean(arr);
    var sum = 0;
    for (var i = 0; i < arr.length; i++) {
      var d = arr[i] - avg;
      sum += d * d;
    }
    return Math.sqrt(sum / arr.length);
  }

  function skewness(arr, avg, sigma) {
    if (arr.length === 0) return 0;
    if (avg === undefined) avg = mean(arr);
    if (sigma === undefined) sigma = std(arr, avg);
    if (sigma === 0) return 0;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) {
      var d = (arr[i] - avg) / sigma;
      sum += d * d * d;
    }
    return sum / arr.length;
  }

  function percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    var idx = (p / 100) * (sortedArr.length - 1);
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    if (lo === hi) return sortedArr[lo];
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
  }

  function histogram(arr, bins, min, max) {
    var counts = new Float64Array(bins);
    var range = max - min || 1;
    for (var i = 0; i < arr.length; i++) {
      var idx = Math.floor(((arr[i] - min) / range) * (bins - 1));
      counts[Math.max(0, Math.min(bins - 1, idx))]++;
    }
    return counts;
  }

  function kMeans(points, k, maxIter) {
    if (maxIter === undefined) maxIter = 20;
    if (points.length === 0) return [];
    if (points.length <= k) {
      return points.map(function (p) {
        return { center: [p[0], p[1], p[2]], count: 1 };
      });
    }

    var step = Math.floor(points.length / k);
    var centroids = [];
    for (var i = 0; i < k; i++) {
      centroids.push([points[i * step][0], points[i * step][1], points[i * step][2]]);
    }

    var assignments = new Int32Array(points.length);

    for (var iter = 0; iter < maxIter; iter++) {
      var changed = false;

      for (var i = 0; i < points.length; i++) {
        var bestDist = Infinity;
        var bestIdx = 0;
        for (var c = 0; c < k; c++) {
          var dr = points[i][0] - centroids[c][0];
          var dg = points[i][1] - centroids[c][1];
          var db = points[i][2] - centroids[c][2];
          var dist = dr * dr + dg * dg + db * db;
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = c;
          }
        }
        if (assignments[i] !== bestIdx) {
          assignments[i] = bestIdx;
          changed = true;
        }
      }

      if (!changed) break;

      var sums = [];
      var counts = new Int32Array(k);
      for (var c = 0; c < k; c++) sums.push([0, 0, 0]);
      for (var i = 0; i < points.length; i++) {
        var c = assignments[i];
        sums[c][0] += points[i][0];
        sums[c][1] += points[i][1];
        sums[c][2] += points[i][2];
        counts[c]++;
      }
      for (var c = 0; c < k; c++) {
        if (counts[c] > 0) {
          centroids[c][0] = sums[c][0] / counts[c];
          centroids[c][1] = sums[c][1] / counts[c];
          centroids[c][2] = sums[c][2] / counts[c];
        }
      }
    }

    var result = centroids.map(function (center) {
      return { center: center, count: 0 };
    });
    for (var i = 0; i < assignments.length; i++) {
      result[assignments[i]].count++;
    }
    return result
      .filter(function (c) { return c.count > 0; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  return {
    mean: mean,
    std: std,
    skewness: skewness,
    percentile: percentile,
    histogram: histogram,
    kMeans: kMeans,
  };
})();
