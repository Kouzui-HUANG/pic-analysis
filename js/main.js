// main.js — Application entry point
// Wires together UI, pipeline modules, and canvas rendering.

(function () {
  var Analyzer = PicAnalysis.Analyzer;
  var Scene = PicAnalysis.Scene;
  var Strategy = PicAnalysis.Strategy;
  var Adjuster = PicAnalysis.Adjuster;
  var Recolor = PicAnalysis.Recolor;
  var Lang = PicAnalysis.Lang;
  var t = Lang.t;

  var MAX_PROCESS_DIM = 2048;
  var MODES = Strategy.MODES;

  // --- State ---

  var originalImageData = null;
  var currentDiagnosis = null;
  var currentAdjustedDiagnosis = null;
  var currentAdjustments = null;
  var currentScenes = null;
  var currentMode = MODES.PHOTO;
  var params = Strategy.defaultParams(currentMode);

  // Recolor state
  var recolorImageData = null;
  var recolorSchemes = null;
  var recolorCurrentIndex = 0;
  var recolorResults = []; // cached ImageData per scheme (full strength)
  var activeFeature = null; // "tonelab" or "recolor"
  var recolorStrength = 60; // 0-100
  var recolorSkinProtect = 0; // 0-100 (maps to 0-1 for engine)
  var recolorCustomHue = null; // null = auto, 0-1 = hue fraction
  var recolorAutoHue = 0; // cached auto-detected hue (0-1)
  var recolorHueDebounceTimer = null;
  var recolorSkinDebounceTimer = null;
  var recolorVibrance = 0; // -100 to 100
  var recolorVibranceDebounceTimer = null;
  var recolorDiagnosis = null;       // diagnosis of original recolor image
  var recolorScenes = null;          // scenes detected from original recolor image
  var recolorAdjustments = null;     // auto-correction adjustments applied after recolor
  var recolorCorrectedDiag = null;   // diagnosis of auto-corrected recolor result
  var recolorCorrectedCache = [];    // pre-computed auto-correction for each scheme
  var recolorStrengthDebounceTimer = null;

  // --- DOM refs ---

  function $(sel) { return document.querySelector(sel); }
  var landing = $("#landing");
  var dropZone = $("#drop-zone");
  var dropZoneRecolor = $("#drop-zone-recolor");
  var fileInput = $("#file-input");
  var fileInputRecolor = $("#file-input-recolor");
  var originalCanvas = $("#original-canvas");
  var adjustedCanvas = $("#adjusted-canvas");
  var originalCtx = originalCanvas.getContext("2d");
  var adjustedCtx = adjustedCanvas.getContext("2d");
  var diagnosisPanel = $("#diagnosis-panel");
  var diagnosisPanelAdj = $("#diagnosis-panel-adjusted");
  var adjustmentsPanel = $("#adjustments-panel");
  var scenesPanel = $("#scenes-panel");
  var controlsPanel = $("#controls-panel");
  var downloadBtn = $("#download-btn");
  var backBtn = $("#back-btn");
  var resetBtn = $("#reset-btn");
  var processingOverlay = $("#processing-overlay");
  var langBtn = $("#lang-btn");
  var uploadBtn = $("#upload-btn");
  var modePhotoBtn = $("#mode-photo");
  var modeIllustBtn = $("#mode-illustration");

  // --- Mode toggle ---

  function setMode(mode) {
    currentMode = mode;
    modePhotoBtn.classList.toggle("active", mode === MODES.PHOTO);
    modeIllustBtn.classList.toggle("active", mode === MODES.ILLUSTRATION);
    params = Strategy.defaultParams(mode);
    buildControls();
    if (activeFeature === "recolor" && recolorImageData) {
      // Re-run auto-correction with new mode
      rerunRecolorAutoCorrection();
    } else if (originalImageData) {
      runPipeline();
    }
  }

  modePhotoBtn.addEventListener("click", function () { setMode(MODES.PHOTO); });
  modeIllustBtn.addEventListener("click", function () { setMode(MODES.ILLUSTRATION); });

  // --- Language toggle ---

  langBtn.addEventListener("click", function () {
    Lang.setLang(Lang.getLang() === "en" ? "zh" : "en");
  });

  Lang.onChange(function () {
    t = Lang.t;
    refreshAllText();
    if (currentDiagnosis && currentAdjustments) {
      renderDiagnosis(currentDiagnosis, diagnosisPanel);
      if (currentAdjustedDiagnosis) renderDiagnosis(currentAdjustedDiagnosis, diagnosisPanelAdj);
      renderAdjustments(currentAdjustments);
      if (currentScenes) renderScenes(currentScenes);
    }
  });

  function refreshAllText() {
    // Header
    $("#app-title").textContent = t("appTitle");
    $("#back-btn").textContent = t("backToLanding");
    $("#reset-btn").textContent = t("resetParams");
    $("#upload-btn").textContent = t("uploadNew");
    $("#download-btn").textContent = t("download");
    modePhotoBtn.textContent = t("modePhoto");
    modeIllustBtn.textContent = t("modeIllustration");
    langBtn.textContent = Lang.getLang() === "en" ? "中文" : "EN";

    // Landing drop zones
    $("#drop-text").textContent = t("dropText");
    $("#drop-hint").textContent = t("dropHint");
    $("#landing-tone-title").textContent = t("landingToneTitle");
    $("#landing-tone-desc").textContent = t("landingToneDesc");
    $("#landing-tone-f1").textContent = t("landingToneF1");
    $("#landing-tone-f2").textContent = t("landingToneF2");
    $("#landing-tone-f3").textContent = t("landingToneF3");
    $("#landing-recolor-title").textContent = t("landingRecolorTitle");
    $("#landing-recolor-desc").textContent = t("landingRecolorDesc");
    $("#landing-recolor-f1").textContent = t("landingRecolorF1");
    $("#landing-recolor-f2").textContent = t("landingRecolorF2");
    $("#landing-recolor-f3").textContent = t("landingRecolorF3");
    $("#drop-text-recolor").textContent = t("dropTextRecolor");
    $("#drop-hint-recolor").textContent = t("dropHintRecolor");

    // Recolor workspace
    $("#recolor-title-original").textContent = t("original");
    $("#recolor-title-controls").textContent = t("recolorControls");
    $("#recolor-strength-label").textContent = t("recolorStrength");
    $("#recolor-skin-label").textContent = t("recolorSkinProtect");
    $("#recolor-vibrance-label").textContent = t("recolorVibrance");
    $("#recolor-hue-label").textContent = t("recolorBaseHue");
    if (recolorCustomHue == null) {
      $("#recolor-hue-value").textContent = t("recolorAutoHue");
    }
    $("#recolor-title-palette").textContent = t("recolorPaletteComparison");
    $("#recolor-palette-orig-label").textContent = t("recolorOriginalPalette");
    $("#recolor-palette-new-label").textContent = t("recolorNewPalette");
    $("#recolor-title-schemes").textContent = t("recolorAllSchemes");
    $("#recolor-title-scenes").textContent = t("recolorDetectedScenes");
    $("#recolor-title-diagnosis").textContent = t("recolorDiagnosis");
    $("#recolor-diag-title-original").textContent = t("recolorDiagOriginal");
    $("#recolor-diag-title-adjusted").textContent = t("recolorDiagCorrected");
    $("#recolor-title-adjustments").textContent = t("recolorAutoCorrections");
    if (recolorSchemes) {
      $("#recolor-scheme-name").textContent = t("recolor." + recolorSchemes[recolorCurrentIndex].key);
      renderRecolorSchemesPanel();
    }
    // Re-render recolor analysis panels on language change
    if (recolorDiagnosis && recolorScenes) {
      renderScenesToPanel(recolorScenes, $("#recolor-scenes-panel"));
      renderDiagnosis(recolorDiagnosis, $("#recolor-diagnosis-panel"));
      if (recolorCorrectedDiag) renderDiagnosis(recolorCorrectedDiag, $("#recolor-diagnosis-panel-adjusted"));
      if (recolorAdjustments) renderAdjustments(recolorAdjustments, $("#recolor-adjustments-panel"));
    }

    // Processing
    processingOverlay.textContent = t("processing");

    // Panel titles
    $("#title-original").textContent = t("original");
    $("#title-adjusted").textContent = t("adjusted");
    $("#title-scenes").textContent = t("detectedScenes");
    $("#title-diagnosis").textContent = t("diagnosis");
    $("#diag-title-original").textContent = t("diagOriginal");
    $("#diag-title-adjusted").textContent = t("diagAdjusted");
    $("#title-adjustments").textContent = t("activeAdjustments");
    $("#title-presets").textContent = t("presets");
    $("#title-parameters").textContent = t("parameters");

    // Histogram labels
    var histLabels = document.querySelectorAll(".hist-label-lum");
    for (var i = 0; i < histLabels.length; i++) histLabels[i].textContent = t("lum");

    // Rebuild controls and presets with translated labels
    buildControls();
    renderPresets();
  }

  // --- Image loading ---

  // ToneLab drop zone
  dropZone.addEventListener("click", function () { fileInput.click(); });

  dropZone.addEventListener("dragover", function (e) {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", function () {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", function (e) {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    var file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) loadImage(file);
  });

  fileInput.addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (file) loadImage(file);
  });

  // Recolor drop zone
  dropZoneRecolor.addEventListener("click", function () { fileInputRecolor.click(); });

  dropZoneRecolor.addEventListener("dragover", function (e) {
    e.preventDefault();
    dropZoneRecolor.classList.add("drag-over");
  });

  dropZoneRecolor.addEventListener("dragleave", function () {
    dropZoneRecolor.classList.remove("drag-over");
  });

  dropZoneRecolor.addEventListener("drop", function (e) {
    e.preventDefault();
    dropZoneRecolor.classList.remove("drag-over");
    var file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) loadRecolorImage(file);
  });

  fileInputRecolor.addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (file) loadRecolorImage(file);
  });

  // Allow drag-and-drop onto the recolor original panel for re-upload
  var recolorOrigPanel = document.querySelector(".recolor-workspace .image-panel");

  recolorOrigPanel.addEventListener("dragover", function (e) {
    e.preventDefault();
    recolorOrigPanel.classList.add("drag-over");
  });

  recolorOrigPanel.addEventListener("dragleave", function () {
    recolorOrigPanel.classList.remove("drag-over");
  });

  recolorOrigPanel.addEventListener("drop", function (e) {
    e.preventDefault();
    recolorOrigPanel.classList.remove("drag-over");
    var file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) loadRecolorImage(file);
  });

  // Allow drag-and-drop onto the original image panel for re-upload
  var originalPanel = document.querySelector(".workspace .image-panel");

  originalPanel.addEventListener("dragover", function (e) {
    e.preventDefault();
    originalPanel.classList.add("drag-over");
  });

  originalPanel.addEventListener("dragleave", function () {
    originalPanel.classList.remove("drag-over");
  });

  originalPanel.addEventListener("drop", function (e) {
    e.preventDefault();
    originalPanel.classList.remove("drag-over");
    var file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) loadImage(file);
  });

  function showFeature(feature) {
    activeFeature = feature;
    landing.classList.add("hidden");
    backBtn.classList.remove("hidden");
    if (feature === "tonelab") {
      $(".workspace").classList.remove("hidden");
      $(".recolor-workspace").classList.add("hidden");
      uploadBtn.classList.remove("hidden");
      // Show tonelab header controls
      $("#mode-toggle").style.display = "";
      resetBtn.style.display = "";
      downloadBtn.onclick = function () {
        var link = document.createElement("a");
        link.download = "adjusted.png";
        link.href = adjustedCanvas.toDataURL("image/png");
        link.click();
      };
    } else {
      $(".workspace").classList.add("hidden");
      $(".recolor-workspace").classList.remove("hidden");
      uploadBtn.classList.remove("hidden");
      // Show mode toggle (affects auto-correction), hide reset (no params in recolor)
      $("#mode-toggle").style.display = "";
      resetBtn.style.display = "none";
      downloadBtn.onclick = function () {
        var link = document.createElement("a");
        link.download = "recolored.png";
        link.href = $("#recolor-adjusted-canvas").toDataURL("image/png");
        link.click();
      };
    }
  }

  function backToLanding() {
    activeFeature = null;
    landing.classList.remove("hidden");
    $(".workspace").classList.add("hidden");
    $(".recolor-workspace").classList.add("hidden");
    uploadBtn.classList.add("hidden");
    backBtn.classList.add("hidden");
    $("#mode-toggle").style.display = "";
    resetBtn.style.display = "";
  }

  backBtn.addEventListener("click", backToLanding);

  function loadImage(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var w = img.width;
        var h = img.height;
        if (Math.max(w, h) > MAX_PROCESS_DIM) {
          var scale = MAX_PROCESS_DIM / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }

        originalCanvas.width = w;
        originalCanvas.height = h;
        adjustedCanvas.width = w;
        adjustedCanvas.height = h;

        originalCtx.drawImage(img, 0, 0, w, h);
        originalImageData = originalCtx.getImageData(0, 0, w, h);

        showFeature("tonelab");
        runPipeline();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function loadRecolorImage(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var w = img.width;
        var h = img.height;
        if (Math.max(w, h) > MAX_PROCESS_DIM) {
          var scale = MAX_PROCESS_DIM / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }

        var rOrigCanvas = $("#recolor-original-canvas");
        var rAdjCanvas = $("#recolor-adjusted-canvas");
        rOrigCanvas.width = w;
        rOrigCanvas.height = h;
        rAdjCanvas.width = w;
        rAdjCanvas.height = h;

        var rOrigCtx = rOrigCanvas.getContext("2d");
        rOrigCtx.drawImage(img, 0, 0, w, h);
        recolorImageData = rOrigCtx.getImageData(0, 0, w, h);

        showFeature("recolor");
        showProcessing(true);

        // Reset controls for new image
        recolorStrength = 60;
        recolorSkinProtect = 0;
        recolorVibrance = 0;
        recolorCustomHue = null;
        $("#recolor-strength-slider").value = 60;
        $("#recolor-strength-value").textContent = "60%";
        $("#recolor-vibrance-slider").value = 0;
        $("#recolor-vibrance-value").textContent = "0";
        $("#recolor-hue-auto-btn").classList.add("active");
        $("#recolor-hue-slider").classList.add("auto-active");
        $("#recolor-hue-value").textContent = t("recolorAutoHue");

        setTimeout(function () {
          try {
            // Stage 1: Analyze original image for diagnosis and scene detection
            recolorDiagnosis = Analyzer.analyze(recolorImageData);
            recolorScenes = Scene.detect(recolorDiagnosis);

            // Auto-detect portrait scene → enable skin protection
            // Requires both: portrait scene active AND actual skin hues present
            for (var si = 0; si < recolorScenes.length; si++) {
              if (recolorScenes[si].type === "portrait" && recolorScenes[si].active) {
                var factors = recolorScenes[si].factors;
                var hasSkin = false;
                for (var fi = 0; fi < factors.length; fi++) {
                  if (factors[fi].key === "factor.skinHues" && factors[fi].score > 0.15) {
                    hasSkin = true;
                    break;
                  }
                }
                if (hasSkin) recolorSkinProtect = 60;
                break;
              }
            }
            $("#recolor-skin-slider").value = recolorSkinProtect;
            $("#recolor-skin-value").textContent = recolorSkinProtect + "%";

            // Cache auto-detected hue for display
            recolorAutoHue = Recolor.getAutoHue(recolorImageData);
            $("#recolor-hue-slider").value = Math.round(recolorAutoHue * 360);

            recolorSchemes = Recolor.generateSchemes(recolorImageData);
            recolorResults = [];
            recolorCurrentIndex = 0;
            var skinVal = recolorSkinProtect / 100;
            var vibVal = recolorVibrance / 100;
            for (var i = 0; i < recolorSchemes.length; i++) {
              recolorResults.push(
                Recolor.applyScheme(recolorImageData, recolorSchemes[i].scheme, skinVal, vibVal)
              );
            }
            // Pre-compute auto-correction for all schemes (enables instant switching)
            buildRecolorCorrectionCache();
            renderRecolorScheme(0);
            renderRecolorSchemesPanel();
          } catch (err) {
            window._recolorError = err.message + "\n" + err.stack;
          }
          showProcessing(false);
        }, 60);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // --- Pipeline execution ---

  function runPipeline() {
    showProcessing(true);

    requestAnimationFrame(function () {
      setTimeout(function () {
        // Stage 1: Analyze
        currentDiagnosis = Analyzer.analyze(originalImageData);
        renderDiagnosis(currentDiagnosis, diagnosisPanel);
        renderOriginalHistogram(currentDiagnosis);

        // Stage 1.5: Scene Detection
        currentScenes = Scene.detect(currentDiagnosis);
        renderScenes(currentScenes);

        // Stage 2: Strategy (scene-aware)
        currentAdjustments = Strategy.route(currentDiagnosis, params, currentScenes, currentMode);
        renderAdjustments(currentAdjustments);

        // Stage 3: Adjust
        var resultData = Adjuster.adjust(originalImageData, currentAdjustments);
        adjustedCtx.putImageData(resultData, 0, 0);

        // Analyze adjusted for histogram comparison and diagnosis
        currentAdjustedDiagnosis = Analyzer.analyze(resultData);
        renderDiagnosis(currentAdjustedDiagnosis, diagnosisPanelAdj);
        renderAdjustedHistogram(currentAdjustedDiagnosis);

        showProcessing(false);
      }, 50);
    });
  }

  function showProcessing(show) {
    processingOverlay.classList.toggle("hidden", !show);
  }

  // --- Scene rendering ---

  function renderScenesToPanel(scenes, panel) {
    // Sort: active scenes first (by confidence desc), then inactive (by confidence desc)
    var sorted = scenes.slice().sort(function (a, b) {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.confidence - a.confidence;
    });

    var html = "";
    for (var i = 0; i < sorted.length; i++) {
      var s = sorted[i];
      var pct = (s.confidence * 100).toFixed(0);
      var name = t("scene." + s.type);
      var cls = "scene-tag" + (s.active ? "" : " scene-tag-inactive");

      html +=
        '<div class="' + cls + '" data-scene-idx="' + i + '">' +
          '<span class="scene-name">' + name + "</span>" +
          '<div class="scene-bar"><div class="scene-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="scene-confidence">' + pct + "%</span>" +
        "</div>";
    }
    panel.innerHTML = html;

    // Bind click handlers for scene explanation popup
    var tags = panel.querySelectorAll(".scene-tag");
    for (var i = 0; i < tags.length; i++) {
      (function (idx) {
        tags[idx].addEventListener("click", function (e) {
          showScenePopup(sorted[idx], tags[idx]);
        });
      })(i);
    }
  }

  function renderScenes(scenes) {
    renderScenesToPanel(scenes, scenesPanel);
  }

  function showScenePopup(scene, anchorEl) {
    // Remove any existing popup
    var old = document.querySelector(".scene-popup");
    if (old) {
      old.parentElement && old.parentElement.classList.remove("scene-tag-open");
      // If clicking the same tag, just toggle off
      if (old._sceneType === scene.type) {
        old.remove();
        return;
      }
      old.remove();
    }

    var desc = t("sceneDesc." + scene.type);
    var factors = scene.factors || [];

    var html = '<div class="scene-popup-header">' + escapeAttr(desc) + '</div>';
    html += '<div class="scene-popup-title">' + t("sceneFactors") + '</div>';
    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      var fpct = (f.score * 100).toFixed(0);
      var label = t(f.key);
      html +=
        '<div class="scene-popup-factor">' +
          '<span class="scene-popup-factor-name">' + label + '</span>' +
          '<div class="scene-popup-factor-bar"><div class="scene-popup-factor-fill" style="width:' + fpct + '%"></div></div>' +
          '<span class="scene-popup-factor-val">' + fpct + '%</span>' +
        '</div>';
    }
    html += '<div class="scene-popup-close">' + t("scenePopupClose") + '</div>';

    var popup = document.createElement("div");
    popup.className = "scene-popup";
    popup._sceneType = scene.type;
    popup.innerHTML = html;

    anchorEl.classList.add("scene-tag-open");
    anchorEl.appendChild(popup);

    // Close on click outside
    function onDocClick(e) {
      if (!popup.contains(e.target) && !anchorEl.contains(e.target)) {
        popup.remove();
        anchorEl.classList.remove("scene-tag-open");
        document.removeEventListener("click", onDocClick, true);
      }
    }
    setTimeout(function () {
      document.addEventListener("click", onDocClick, true);
    }, 0);
  }

  // --- Diagnosis rendering ---

  function renderDiagnosis(d, targetPanel) {
    var lum = d.luminance;
    var sat = d.saturation;

    var totalCount = 0;
    for (var i = 0; i < d.dominantColors.length; i++) totalCount += d.dominantColors[i].count;

    var swatchesHtml = "";
    var colors = d.dominantColors.slice(0, 6);
    for (var i = 0; i < colors.length; i++) {
      var c = colors[i];
      var r = Math.round(c.center[0]);
      var g = Math.round(c.center[1]);
      var b = Math.round(c.center[2]);
      var pct = ((c.count / totalCount) * 100).toFixed(0);
      swatchesHtml +=
        '<div class="swatch" style="background:rgb(' + r + "," + g + "," + b + ')" ' +
        'title="RGB(' + r + "," + g + "," + b + ") — " + pct + '%"></div>';
    }

    // Color harmony badge
    var harmonyHtml = "";
    if (d.colorHarmony) {
      var harmonyName = t(d.colorHarmony.typeKey || "harmony.diverse");
      var harmonyScore = (d.colorHarmony.score * 100).toFixed(0);
      harmonyHtml =
        '<div class="harmony-badge">' +
          '<span class="diag-label">' + t("colorHarmony") + "</span>" +
          '<span class="harmony-type">' + harmonyName + "</span>" +
          '<span class="harmony-score">' + harmonyScore + "%</span>" +
        "</div>";
    }

    // Regional analysis mini-grid
    var regionHtml = "";
    if (d.regionSummary) {
      var rs = d.regionSummary;
      // Build 3x3 mini heatmap
      var gridHtml = "";
      for (var i = 0; i < d.regions.length; i++) {
        var reg = d.regions[i];
        var brightness = Math.round((reg.lumMean / 255) * 100);
        var gray = Math.round(reg.lumMean);
        var posKey = "pos." + ["TL","TC","TR","ML","MC","MR","BL","BC","BR"][i];
        gridHtml +=
          '<div class="region-cell" style="background:rgb(' + gray + ',' + gray + ',' + gray + ')" ' +
          'title="' + escapeAttr(t(posKey)) + ": " + reg.lumMean.toFixed(0) + '">' +
          "</div>";
      }

      regionHtml =
        '<div class="region-analysis">' +
          '<span class="diag-label">' + t("regionAnalysis") + "</span>" +
          '<div class="region-grid-mini">' + gridHtml + "</div>" +
          '<div class="region-stats">' +
            '<div class="region-stat">' +
              '<span class="region-stat-label">' + t("regionContrast") + "</span>" +
              '<span class="region-stat-value">' + rs.regionContrast.toFixed(0) + "</span>" +
            "</div>" +
            '<div class="region-stat">' +
              '<span class="region-stat-label">' + t("centerEdgeDiff") + "</span>" +
              '<span class="region-stat-value">' + (rs.centerEdgeDiff > 0 ? "+" : "") + rs.centerEdgeDiff.toFixed(0) + "</span>" +
            "</div>" +
            '<div class="region-stat">' +
              '<span class="region-stat-label">' + t("darkestRegion") + "</span>" +
              '<span class="region-stat-value">' + t("pos." + rs.darkestPos) + " (" + rs.darkest.lum.toFixed(0) + ")</span>" +
            "</div>" +
            '<div class="region-stat">' +
              '<span class="region-stat-label">' + t("brightestRegion") + "</span>" +
              '<span class="region-stat-value">' + t("pos." + rs.brightestPos) + " (" + rs.brightest.lum.toFixed(0) + ")</span>" +
            "</div>" +
          "</div>" +
        "</div>";
    }

    targetPanel.innerHTML =
      '<div class="diag-grid">' +
        '<div class="diag-item">' +
          '<span class="diag-label">' + t("brightnessMean") + "</span>" +
          '<span class="diag-value">' + lum.mean.toFixed(1) + "</span>" +
          '<div class="diag-bar"><div class="diag-bar-fill" style="width:' + ((lum.mean / 255) * 100) + '%"></div></div>' +
        "</div>" +
        '<div class="diag-item">' +
          '<span class="diag-label">' + t("contrastStd") + "</span>" +
          '<span class="diag-value">' + lum.std.toFixed(1) + "</span>" +
          '<div class="diag-bar"><div class="diag-bar-fill" style="width:' + ((lum.std / 128) * 100) + '%"></div></div>' +
        "</div>" +
        '<div class="diag-item">' +
          '<span class="diag-label">' + t("skewness") + "</span>" +
          '<span class="diag-value">' + lum.skewness.toFixed(2) + "</span>" +
          '<div class="diag-bar-center"><div class="diag-bar-center-fill" style="left:' + (50 + (lum.skewness / 4) * 50) + '%;width:2px"></div></div>' +
        "</div>" +
        '<div class="diag-item">' +
          '<span class="diag-label">' + t("dynamicRange") + "</span>" +
          '<span class="diag-value">' + lum.dynamicRange.toFixed(0) + "</span>" +
          '<div class="diag-bar"><div class="diag-bar-fill" style="width:' + ((lum.dynamicRange / 255) * 100) + '%"></div></div>' +
        "</div>" +
        '<div class="diag-item">' +
          '<span class="diag-label">' + t("saturationMean") + "</span>" +
          '<span class="diag-value">' + sat.mean.toFixed(3) + "</span>" +
          '<div class="diag-bar"><div class="diag-bar-fill" style="width:' + (sat.mean * 100) + '%"></div></div>' +
        "</div>" +
        '<div class="diag-item">' +
          '<span class="diag-label">' + t("colorTempBias") + "</span>" +
          '<span class="diag-value">' + d.colorTempBias.toFixed(3) + "</span>" +
          '<div class="diag-bar-center"><div class="diag-bar-center-fill" style="left:' + (50 + d.colorTempBias * 250) + '%;width:2px"></div></div>' +
        "</div>" +
        '<div class="diag-item">' +
          '<span class="diag-label">' + t("tintBias") + "</span>" +
          '<span class="diag-value">' + d.tintBias.toFixed(3) + "</span>" +
          '<div class="diag-bar-center"><div class="diag-bar-center-fill" style="left:' + (50 + d.tintBias * 250) + '%;width:2px"></div></div>' +
        "</div>" +
      "</div>" +
      '<div class="diag-extra-row">' +
        '<div class="dominant-colors">' +
          '<span class="diag-label">' + t("dominantColors") + "</span>" +
          '<div class="color-swatches">' + swatchesHtml + "</div>" +
          harmonyHtml +
        "</div>" +
        regionHtml +
      "</div>";
  }

  // --- Histogram rendering ---

  function drawHistogram(canvas, histData, color) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    var max = 0;
    for (var i = 0; i < histData.length; i++) {
      if (histData[i] > max) max = histData[i];
    }
    if (max === 0) return;

    ctx.fillStyle = color;
    var binWidth = w / histData.length;
    for (var i = 0; i < histData.length; i++) {
      var barH = (histData[i] / max) * h;
      ctx.fillRect(i * binWidth, h - barH, binWidth, barH);
    }
  }

  function renderOriginalHistogram(d) {
    drawHistogram($("#hist-orig-lum"), d.luminance.histogram, "#aaa");
    drawHistogram($("#hist-orig-r"), d.channels.rHistogram, "#a44");
    drawHistogram($("#hist-orig-g"), d.channels.gHistogram, "#4a4");
    drawHistogram($("#hist-orig-b"), d.channels.bHistogram, "#44a");
  }

  function renderAdjustedHistogram(d) {
    drawHistogram($("#hist-adj-lum"), d.luminance.histogram, "#aaa");
    drawHistogram($("#hist-adj-r"), d.channels.rHistogram, "#a44");
    drawHistogram($("#hist-adj-g"), d.channels.gHistogram, "#4a4");
    drawHistogram($("#hist-adj-b"), d.channels.bHistogram, "#44a");
  }

  // --- Adjustments display ---

  function renderAdjustments(adjustments, targetPanel) {
    var panel = targetPanel || adjustmentsPanel;
    var html = "";
    for (var i = 0; i < adjustments.length; i++) {
      var adj = adjustments[i];
      var cls = adj.active ? "active" : "inactive";
      if (adj.sceneSuppressed) cls += " scene-suppressed";
      var indicator = adj.active ? "\u25cf" : "\u25cb";
      var typeName = t("type." + adj.type);
      var reason = adj.conflictKey
        ? t(adj.conflictKey)
        : t(adj.reasonKey, { val: adj.reasonVal });
      var amountHtml = adj.active
        ? '<span class="adj-amount">' + (adj.amount * 100).toFixed(0) + "%</span>"
        : "";

      // Scene modifier badge (suppression or enhancement)
      var suppressHtml = "";
      if (adj.active && adj.sceneMultiplier !== undefined) {
        if (adj.sceneMultiplier < 0.95) {
          var suppressPct = ((1 - adj.sceneMultiplier) * 100).toFixed(0);
          suppressHtml = '<span class="adj-scene-badge suppress">\u25bf ' + suppressPct + "%</span>";
        } else if (adj.sceneMultiplier > 1.05) {
          var enhancePct = ((adj.sceneMultiplier - 1) * 100).toFixed(0);
          suppressHtml = '<span class="adj-scene-badge enhance">\u25b5 +' + enhancePct + "%</span>";
        }
      }

      html +=
        '<div class="adj-item ' + cls + '">' +
          '<span class="adj-indicator">' + indicator + "</span>" +
          '<span class="adj-type">' + typeName + "</span>" +
          '<span class="adj-reason">' + reason + "</span>" +
          suppressHtml +
          amountHtml +
        "</div>";
    }
    panel.innerHTML = html;
  }

  // --- Presets (localStorage) ---

  var PRESETS_KEY = "picanalysis_presets";
  var PRESET_COUNT = 5;
  var presetsPanel = $("#presets-panel");

  function loadPresetsFromStorage() {
    try {
      var data = localStorage.getItem(PRESETS_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {}
    var slots = [];
    for (var i = 0; i < PRESET_COUNT; i++) {
      slots.push({ name: "", params: null });
    }
    return slots;
  }

  function savePresetsToStorage(slots) {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(slots));
    } catch (e) {}
  }

  var presetSlots = loadPresetsFromStorage();

  function renderPresets() {
    var html = "";
    for (var i = 0; i < PRESET_COUNT; i++) {
      var slot = presetSlots[i];
      var hasData = slot && slot.params;
      var cls = hasData ? "preset-slot has-data" : "preset-slot";

      if (hasData) {
        html +=
          '<div class="' + cls + '">' +
            '<input class="preset-name" type="text" data-slot="' + i + '" ' +
              'value="' + escapeAttr(slot.name) + '">' +
            '<div class="preset-actions">' +
              '<button data-action="load" data-slot="' + i + '">' + t("presetLoad") + '</button>' +
              '<button data-action="save" data-slot="' + i + '">' + t("presetSave") + '</button>' +
              '<button data-action="delete" data-slot="' + i + '">' + t("presetDelete") + '</button>' +
            '</div>' +
          '</div>';
      } else {
        html +=
          '<div class="' + cls + '">' +
            '<div class="preset-empty-label">' + t("presetEmpty") + '</div>' +
            '<div class="preset-actions">' +
              '<button data-action="save" data-slot="' + i + '">' + t("presetSave") + '</button>' +
            '</div>' +
          '</div>';
      }
    }
    presetsPanel.innerHTML = html;

    presetsPanel.querySelectorAll("button[data-action]").forEach(function (btn) {
      btn.addEventListener("click", onPresetAction);
    });
    presetsPanel.querySelectorAll("input.preset-name").forEach(function (input) {
      input.addEventListener("change", onPresetRename);
    });
  }

  function escapeAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function onPresetAction(e) {
    var action = e.target.dataset.action;
    var idx = parseInt(e.target.dataset.slot, 10);

    if (action === "save") {
      var slot = presetSlots[idx];
      var name = (slot && slot.name) ? slot.name : t("presets") + " " + (idx + 1);
      presetSlots[idx] = {
        name: name,
        params: JSON.parse(JSON.stringify(params)),
      };
      savePresetsToStorage(presetSlots);
      renderPresets();
    } else if (action === "load") {
      var slot = presetSlots[idx];
      if (slot && slot.params) {
        params = JSON.parse(JSON.stringify(slot.params));
        // Ensure new params exist for presets saved before these features
        var defaults = Strategy.defaultParams();
        for (var key in defaults) {
          if (params[key] === undefined) params[key] = defaults[key];
        }
        buildControls();
        if (originalImageData) runPipeline();
      }
    } else if (action === "delete") {
      presetSlots[idx] = { name: "", params: null };
      savePresetsToStorage(presetSlots);
      renderPresets();
    }
  }

  function onPresetRename(e) {
    var idx = parseInt(e.target.dataset.slot, 10);
    if (presetSlots[idx]) {
      presetSlots[idx].name = e.target.value;
      savePresetsToStorage(presetSlots);
    }
  }

  // --- Controls ---

  var LABEL_KEYS = {
    sceneAwareness: "sceneAwareness",
    brightnessSkewThreshold: "brightnessSkewThreshold",
    contrastMinDynamicRange: "minDynamicRange",
    contrastMaxStd: "maxContrastStd",
    vibranceMinMean: "minVibranceMean",
    saturationMinMean: "minSaturationMean",
    saturationMaxMean: "maxSaturationMean",
    whiteBalanceMaxBias: "maxColorTempBias",
    tintMaxBias: "maxTintBias",
    shadowP5Threshold: "shadowP5Threshold",
    highlightP95Threshold: "highlightP95Threshold",
    brightnessTarget: "brightnessTarget",
    contrastTarget: "contrastTargetRange",
    saturationTarget: "saturationTarget",
    globalStrength: "globalStrength",
    brightnessStrength: "brightness",
    contrastStrength: "contrast",
    contrastReductionStrength: "contrastReduction",
    vibranceStrength: "vibrance",
    saturationStrength: "saturation",
    desaturationStrength: "desaturation",
    whiteBalanceStrength: "whiteBalance",
    tintStrength: "tintCorrection",
    shadowStrength: "shadowRecovery",
    highlightStrength: "highlightRecovery",
    clarityMinMidtoneRange: "clarityMinMidtoneRange",
    clarityStrength: "clarity",
  };

  var CONTROLS = [
    {
      sectionKey: "strategyThresholds",
      items: [
        { key: "sceneAwareness", min: 0, max: 1, step: 0.05 },
        { key: "brightnessSkewThreshold", min: 0, max: 2, step: 0.05 },
        { key: "contrastMinDynamicRange", min: 20, max: 200, step: 5 },
        { key: "contrastMaxStd", min: 50, max: 120, step: 1 },
        { key: "vibranceMinMean", min: 0, max: 0.6, step: 0.01 },
        { key: "saturationMinMean", min: 0, max: 0.6, step: 0.01 },
        { key: "saturationMaxMean", min: 0.4, max: 1, step: 0.01 },
        { key: "whiteBalanceMaxBias", min: 0, max: 0.3, step: 0.01 },
        { key: "tintMaxBias", min: 0, max: 0.2, step: 0.005 },
        { key: "shadowP5Threshold", min: 0, max: 80, step: 1 },
        { key: "highlightP95Threshold", min: 180, max: 255, step: 1 },
        { key: "clarityMinMidtoneRange", min: 10, max: 100, step: 5 },
      ],
    },
    {
      sectionKey: "targetValues",
      items: [
        { key: "brightnessTarget", min: 60, max: 200, step: 1 },
        { key: "contrastTarget", min: 80, max: 220, step: 5 },
        { key: "saturationTarget", min: 0.1, max: 0.8, step: 0.01 },
      ],
    },
    {
      sectionKey: "adjustmentStrengths",
      items: [
        { key: "globalStrength", min: 0, max: 1.5, step: 0.05 },
        { key: "brightnessStrength", min: 0, max: 1, step: 0.05 },
        { key: "contrastStrength", min: 0, max: 1, step: 0.05 },
        { key: "contrastReductionStrength", min: 0, max: 1, step: 0.05 },
        { key: "vibranceStrength", min: 0, max: 1, step: 0.05 },
        { key: "saturationStrength", min: 0, max: 1, step: 0.05 },
        { key: "desaturationStrength", min: 0, max: 1, step: 0.05 },
        { key: "whiteBalanceStrength", min: 0, max: 1, step: 0.05 },
        { key: "tintStrength", min: 0, max: 1, step: 0.05 },
        { key: "shadowStrength", min: 0, max: 1, step: 0.05 },
        { key: "highlightStrength", min: 0, max: 1, step: 0.05 },
        { key: "clarityStrength", min: 0, max: 1, step: 0.05 },
      ],
    },
  ];

  function buildControls() {
    var html = "";
    for (var s = 0; s < CONTROLS.length; s++) {
      var section = CONTROLS[s];
      html += '<div class="control-section"><h3>' + t(section.sectionKey) + "</h3>";
      for (var i = 0; i < section.items.length; i++) {
        var item = section.items[i];
        var labelKey = LABEL_KEYS[item.key] || item.key;
        var tipKey = "tip." + item.key;
        var tipText = t(tipKey);
        var tipHtml = tipText !== tipKey
          ? '<span class="control-tip" data-tip="' + escapeAttr(tipText) + '">?</span>'
          : "";
        html +=
          '<div class="control-row">' +
            "<label>" + t(labelKey) + tipHtml + "</label>" +
            '<input type="range" data-key="' + item.key + '"' +
            ' min="' + item.min + '" max="' + item.max + '" step="' + item.step + '"' +
            ' value="' + params[item.key] + '">' +
            '<span class="control-value" data-value-for="' + item.key + '">' +
              formatControlValue(params[item.key]) +
            "</span>" +
          "</div>";
      }
      html += "</div>";
    }
    controlsPanel.innerHTML = html;

    var inputs = controlsPanel.querySelectorAll("input[type=range]");
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener("change", onControlChange);
    }
  }

  function onControlChange(e) {
    var key = e.target.dataset.key;
    params[key] = parseFloat(e.target.value);
    var valueEl = document.querySelector('.control-value[data-value-for="' + key + '"]');
    if (valueEl) valueEl.textContent = formatControlValue(params[key]);
    if (originalImageData) runPipeline();
  }

  function formatControlValue(v) {
    if (Number.isInteger(v)) return v.toString();
    if (v >= 10) return v.toFixed(0);
    if (v >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  // --- Recolor auto-correction (applies tonelab pipeline to recolored output) ---

  // Core: run pipeline on a single recolored ImageData → { corrected, adjustments, correctedDiag }
  function autoCorrectRecolored(recoloredData) {
    var diag = Analyzer.analyze(recoloredData);
    var scenes = recolorScenes || [];
    var modeParams = Strategy.defaultParams(currentMode);
    var adjustments = Strategy.route(diag, modeParams, scenes, currentMode);
    var corrected = Adjuster.adjust(recoloredData, adjustments);
    var correctedDiag = Analyzer.analyze(corrected);
    return { corrected: corrected, adjustments: adjustments, correctedDiag: correctedDiag };
  }

  // Pre-compute auto-correction for ALL schemes at current strength.
  // Called once during load / regenerate / mode-switch / strength-change.
  // After this, left/right switching is instant (cache lookup only).
  function buildRecolorCorrectionCache() {
    recolorCorrectedCache = [];
    var strength = recolorStrength / 100;
    for (var i = 0; i < recolorSchemes.length; i++) {
      var blended = strength >= 1 ? recolorResults[i]
        : Recolor.blendWithOriginal(recolorImageData, recolorResults[i], strength);
      recolorCorrectedCache.push(autoCorrectRecolored(blended));
    }
  }

  function renderRecolorAnalysis(origDiag, correctedDiag, scenes, adjustments) {
    renderScenesToPanel(scenes, $("#recolor-scenes-panel"));
    renderDiagnosis(origDiag, $("#recolor-diagnosis-panel"));
    renderDiagnosis(correctedDiag, $("#recolor-diagnosis-panel-adjusted"));
    renderAdjustments(adjustments, $("#recolor-adjustments-panel"));
  }

  // Called on mode switch while in recolor — rebuild entire cache with new mode params
  function rerunRecolorAutoCorrection() {
    if (!recolorSchemes || !recolorResults.length) return;
    showProcessing(true);
    setTimeout(function () {
      buildRecolorCorrectionCache();
      displayCachedRecolorScheme(recolorCurrentIndex);
      showProcessing(false);
    }, 30);
  }

  // Display a scheme from the pre-computed cache (instant, no pipeline work)
  function displayCachedRecolorScheme(idx) {
    var cached = recolorCorrectedCache[idx];
    recolorAdjustments = cached.adjustments;
    recolorCorrectedDiag = cached.correctedDiag;

    // Display corrected image
    var rAdjCanvas = $("#recolor-adjusted-canvas");
    rAdjCanvas.getContext("2d").putImageData(cached.corrected, 0, 0);

    // Update analysis panels
    renderRecolorAnalysis(recolorDiagnosis, recolorCorrectedDiag, recolorScenes, recolorAdjustments);
  }

  // --- Recolor pipeline ---

  function renderRecolorScheme(idx) {
    if (!recolorSchemes || idx < 0 || idx >= recolorSchemes.length) return;
    recolorCurrentIndex = idx;

    var scheme = recolorSchemes[idx];

    // Display auto-corrected image from pre-computed cache (instant)
    if (recolorCorrectedCache.length > idx) {
      displayCachedRecolorScheme(idx);
    }

    // Update scheme name and counter
    var nameEl = $("#recolor-scheme-name");
    nameEl.textContent = t("recolor." + scheme.key);
    nameEl._schemeKey = scheme.key;
    $("#recolor-scheme-counter").textContent = (idx + 1) + " / " + recolorSchemes.length;

    // Update palette swatches
    renderPaletteSwatches(scheme.originalPalette, $("#recolor-palette-original"));
    renderPaletteSwatches(scheme.newPalette, $("#recolor-palette-new"));

    // Update active dot in schemes panel
    var dots = document.querySelectorAll(".recolor-scheme-dot");
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle("active", i === idx);
    }
  }

  function renderPaletteSwatches(palette, container) {
    var html = "";
    for (var i = 0; i < palette.length; i++) {
      var c = palette[i].rgb;
      html += '<div class="swatch" style="background:rgb(' +
        c[0] + "," + c[1] + "," + c[2] +
        ')" title="RGB(' + c[0] + "," + c[1] + "," + c[2] + ')"></div>';
    }
    container.innerHTML = html;
  }

  function renderRecolorSchemesPanel() {
    var panel = $("#recolor-schemes-panel");
    var html = "";
    for (var i = 0; i < recolorSchemes.length; i++) {
      var scheme = recolorSchemes[i];
      var cls = "recolor-scheme-dot" + (i === recolorCurrentIndex ? " active" : "");
      html +=
        '<div class="' + cls + '" data-scheme-idx="' + i + '">' +
          '<span class="recolor-scheme-dot-name">' + t("recolor." + scheme.key) + '</span>' +
        '</div>';
    }
    panel.innerHTML = html;

    var dots = panel.querySelectorAll(".recolor-scheme-dot");
    for (var i = 0; i < dots.length; i++) {
      (function (idx) {
        dots[idx].addEventListener("click", function () {
          renderRecolorScheme(idx);
        });
      })(i);
    }
  }

  // Recolor nav buttons
  $("#recolor-prev").addEventListener("click", function () {
    if (!recolorSchemes) return;
    renderRecolorScheme((recolorCurrentIndex - 1 + recolorSchemes.length) % recolorSchemes.length);
  });

  $("#recolor-next").addEventListener("click", function () {
    if (!recolorSchemes) return;
    renderRecolorScheme((recolorCurrentIndex + 1) % recolorSchemes.length);
  });

  // --- Recolor scheme name tooltip (hover) ---
  (function () {
    var nameEl = $("#recolor-scheme-name");
    var tipEl = null;
    var hideTimer = null;

    function showTip() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      var key = nameEl._schemeKey;
      if (!key) return;
      var text = t("recolorTip." + key);
      if (!text || text === "recolorTip." + key) return;
      // Remove existing
      if (tipEl) tipEl.remove();
      tipEl = document.createElement("div");
      tipEl.className = "recolor-scheme-tip";
      tipEl.innerHTML = '<div class="recolor-scheme-tip-text">' + text + '</div>';
      nameEl.appendChild(tipEl);
    }

    function hideTip() {
      hideTimer = setTimeout(function () {
        if (tipEl) { tipEl.remove(); tipEl = null; }
      }, 120);
    }

    nameEl.addEventListener("mouseenter", showTip);
    nameEl.addEventListener("mouseleave", hideTip);
  })();

  // Keyboard left/right arrow navigation for recolor
  document.addEventListener("keydown", function (e) {
    if (activeFeature !== "recolor" || !recolorSchemes) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      $("#recolor-prev").click();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      $("#recolor-next").click();
    }
  });

  // --- Recolor controls: Strength slider ---

  $("#recolor-strength-slider").addEventListener("change", function () {
    recolorStrength = parseInt(this.value, 10);
    $("#recolor-strength-value").textContent = recolorStrength + "%";
    if (!recolorSchemes) return;

    showProcessing(true);
    setTimeout(function () {
      buildRecolorCorrectionCache();
      displayCachedRecolorScheme(recolorCurrentIndex);
      showProcessing(false);
    }, 20);
  });

  // --- Recolor controls: regenerate all schemes ---

  // Central regeneration: re-runs scheme generation and pixel-level apply
  // with current hue + skinProtect settings.
  // regenSchemes: true = also rebuild scheme objects (needed when hue changes)
  function regenerateRecolor(regenSchemes) {
    if (!recolorImageData) return;
    showProcessing(true);
    setTimeout(function () {
      try {
        if (regenSchemes) {
          recolorSchemes = Recolor.generateSchemes(recolorImageData, recolorCustomHue);
        }
        recolorResults = [];
        var skinVal = recolorSkinProtect / 100;
        var vibVal = recolorVibrance / 100;
        for (var i = 0; i < recolorSchemes.length; i++) {
          recolorResults.push(
            Recolor.applyScheme(recolorImageData, recolorSchemes[i].scheme, skinVal, vibVal)
          );
        }
        // Pre-compute auto-correction for all schemes (enables instant switching)
        buildRecolorCorrectionCache();
        renderRecolorScheme(recolorCurrentIndex);
        if (regenSchemes) renderRecolorSchemesPanel();
      } catch (err) {
        window._recolorError = err.message + "\n" + err.stack;
      }
      showProcessing(false);
    }, 30);
  }

  // --- Recolor controls: Skin tone protection slider ---

  $("#recolor-skin-slider").addEventListener("change", function () {
    recolorSkinProtect = parseInt(this.value, 10);
    $("#recolor-skin-value").textContent = recolorSkinProtect + "%";
    regenerateRecolor(false); // schemes unchanged, only pixel apply
  });

  // --- Recolor controls: Vibrance slider ---

  $("#recolor-vibrance-slider").addEventListener("change", function () {
    recolorVibrance = parseInt(this.value, 10);
    $("#recolor-vibrance-value").textContent = recolorVibrance > 0 ? "+" + recolorVibrance : "" + recolorVibrance;
    regenerateRecolor(false); // schemes unchanged, only pixel apply
  });

  // --- Recolor controls: Custom base hue ---

  $("#recolor-hue-slider").addEventListener("change", function () {
    var deg = parseInt(this.value, 10);
    recolorCustomHue = deg / 360;
    $("#recolor-hue-value").textContent = deg + "\u00B0";
    $("#recolor-hue-auto-btn").classList.remove("active");
    $("#recolor-hue-slider").classList.remove("auto-active");
    regenerateRecolor(true); // hue changed, rebuild schemes
  });

  $("#recolor-hue-auto-btn").addEventListener("click", function () {
    if (recolorCustomHue == null) return; // already auto
    recolorCustomHue = null;
    this.classList.add("active");
    $("#recolor-hue-slider").classList.add("auto-active");
    $("#recolor-hue-slider").value = Math.round(recolorAutoHue * 360);
    $("#recolor-hue-value").textContent = t("recolorAutoHue");
    regenerateRecolor(true); // hue changed, rebuild schemes
  });

  // --- Upload new image ---

  uploadBtn.addEventListener("click", function () {
    if (activeFeature === "recolor") {
      fileInputRecolor.value = "";
      fileInputRecolor.click();
    } else {
      fileInput.value = "";
      fileInput.click();
    }
  });

  // --- Reset ---

  resetBtn.addEventListener("click", function () {
    params = Strategy.defaultParams(currentMode);
    buildControls();
    if (originalImageData) runPipeline();
  });

  // --- Init ---

  buildControls();
  renderPresets();
  refreshAllText();
})();
