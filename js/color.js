// color.js — Color space conversion utilities
// Exposes: PicAnalysis.Color

var PicAnalysis = PicAnalysis || {};

PicAnalysis.Color = (function () {
  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // --- RGB <-> HSL ---

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var l = (max + min) / 2;

    if (max === min) return [0, 0, l];

    var d = max - min;
    var s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    var h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;

    return [h, s, l];
  }

  function hueToChannel(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      var v = Math.round(l * 255);
      return [v, v, v];
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [
      Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
      Math.round(hueToChannel(p, q, h) * 255),
      Math.round(hueToChannel(p, q, h - 1 / 3) * 255),
    ];
  }

  // --- RGB <-> LAB (via XYZ, D65 illuminant) ---

  function gammaToLinear(c) {
    c /= 255;
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  }

  function linearToGamma(c) {
    var v =
      c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
    return Math.round(clamp(v, 0, 1) * 255);
  }

  var D65_X = 0.95047;
  var D65_Y = 1.0;
  var D65_Z = 1.08883;

  function labF(t) {
    return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  }

  function labFInv(t) {
    return t > 0.206897 ? t * t * t : (t - 16 / 116) / 7.787;
  }

  function rgbToLab(r, g, b) {
    var lr = gammaToLinear(r);
    var lg = gammaToLinear(g);
    var lb = gammaToLinear(b);

    var x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / D65_X;
    var y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / D65_Y;
    var z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / D65_Z;

    var fx = labF(x);
    var fy = labF(y);
    var fz = labF(z);

    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function labToRgb(L, a, b) {
    var fy = (L + 16) / 116;
    var fx = a / 500 + fy;
    var fz = fy - b / 200;

    var x = labFInv(fx) * D65_X;
    var y = labFInv(fy) * D65_Y;
    var z = labFInv(fz) * D65_Z;

    var lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
    var lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
    var lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

    return [linearToGamma(lr), linearToGamma(lg), linearToGamma(lb)];
  }

  // --- RGB <-> LCH (LAB polar coordinates) ---

  function rgbToLch(r, g, b) {
    var lab = rgbToLab(r, g, b);
    var C = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
    var h = Math.atan2(lab[2], lab[1]);
    if (h < 0) h += 2 * Math.PI;
    return [lab[0], C, h / (2 * Math.PI)]; // h normalised to 0-1
  }

  function lchToRgb(L, C, h) {
    var hRad = h * 2 * Math.PI;
    return labToRgb(L, C * Math.cos(hRad), C * Math.sin(hRad));
  }

  return {
    clamp: clamp,
    luminance: luminance,
    rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb,
    rgbToLab: rgbToLab,
    labToRgb: labToRgb,
    rgbToLch: rgbToLch,
    lchToRgb: lchToRgb,
  };
})();
