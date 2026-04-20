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

  var MAX_PROCESS_DIM = 3840;
  var TRANSFER_REF_MAX_DIM = 1024;
  var MODES = Strategy.MODES;
  var Transfer = PicAnalysis.Transfer;

  // --- State ---

  var originalImageData = null;
  var currentDiagnosis = null;
  var currentAdjustedDiagnosis = null;
  var currentAdjustments = null;
  var currentScenes = null;
  var currentMode = MODES.PHOTO;
  var params = Strategy.defaultParams(currentMode);
  var pipelineCache = {}; // mode → { adjustments, resultData, adjustedDiagnosis }
  var _pipelineBgTimer = null;

  // Recolor state
  var recolorImageData = null;
  var recolorSchemes = null;
  var recolorCurrentIndex = 0;
  var recolorResults = []; // cached ImageData per scheme (full strength)
  var activeFeature = null; // "tonelab" or "recolor"
  var recolorStrength = 75; // 0-100
  var recolorSkinProtect = 0; // 0-100 (maps to 0-1 for engine)
  var recolorCustomHue = null; // null = auto, 0-1 = hue fraction
  var recolorAutoHue = 0; // cached auto-detected hue (0-1)
  var recolorHueDebounceTimer = null;
  var recolorSkinDebounceTimer = null;
  var recolorVibrance = 0; // -100 to 100
  var recolorVibranceUserSet = false; // true once user moves the slider; suppresses auto-recompute on mode switch
  var recolorCharColors = null; // { skin: [R,G,B] | null, hair: [R,G,B] | null }
  var recolorVibranceDebounceTimer = null;
  var recolorDiagnosis = null;       // diagnosis of original recolor image
  var recolorScenes = null;          // scenes detected from original recolor image
  var recolorAdjustments = null;     // auto-correction adjustments applied after recolor
  var recolorCorrectedDiag = null;   // diagnosis of auto-corrected recolor result
  var recolorCorrectedCache = {};    // mode → [] pre-computed auto-correction for each scheme
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
  var processingText = processingOverlay.querySelector(".processing-text");
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
      // Defer heavy recolor re-correction so the button toggle renders first
      showProcessing(true);
      setTimeout(function () {
        // If user hasn't manually overridden vibrance, recompute it for the new mode.
        // Mode flips the philosophy (correct vs amplify), so the auto value differs.
        var needRegen = false;
        if (!recolorVibranceUserSet && recolorDiagnosis) {
          var newAuto = computeAutoVibrance(recolorDiagnosis.saturation.mean, recolorDiagnosis.saturation.std, mode);
          if (newAuto !== recolorVibrance) {
            applyAutoVibrance(recolorDiagnosis.saturation.mean, mode);
            // Vibrance is baked into recolorResults via applyScheme, so a full regen is required.
            // Drop the (now-stale) cache for both modes since the new vibrance affects both.
            recolorCorrectedCache = {};
            needRegen = true;
          }
        }
        if (needRegen) {
          // regenerateRecolor manages its own showProcessing lifecycle
          regenerateRecolor(false);
        } else {
          rerunRecolorAutoCorrection();
          showProcessing(false);
        }
      }, 30);
    } else if (originalImageData) {
      // Use pre-computed cache for instant mode switching
      if (pipelineCache[mode]) {
        var cached = pipelineCache[mode];
        currentAdjustments = cached.adjustments;
        currentAdjustedDiagnosis = cached.adjustedDiagnosis;
        renderAdjustments(currentAdjustments);
        adjustedCtx.putImageData(cached.resultData, 0, 0);
        renderDiagnosis(currentAdjustedDiagnosis, diagnosisPanelAdj);
        renderAdjustedHistogram(currentAdjustedDiagnosis);
      } else {
        runPipeline();
      }
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
    $("#recolor-alt-label").textContent = t("recolorAltLabel");
    $("#recolor-skin-color-label").textContent = t("recolorDetectedSkin");
    $("#recolor-hair-color-label").textContent = t("recolorDetectedHair");
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

    // API key modal + AI button + compare labels
    updateApiKeyModalText();
    $("#ai-recolor-btn").textContent = t("aiRecolorBtn");
    $("#ai-compare-label-left").textContent = t("aiCompareLabelLeft");
    $("#ai-compare-label-right").textContent = t("aiCompareLabelRight");

    // Recolor analysis toggle
    $("#recolor-analysis-toggle-text").textContent = t("recolorAdvancedAnalysis");

    // Upload button context
    if (activeFeature === "recolor") {
      uploadBtn.textContent = t("uploadNewRecolor");
    } else if (activeFeature === "transfer") {
      uploadBtn.textContent = t("uploadNewTransfer");
    } else {
      uploadBtn.textContent = t("uploadNew");
    }

    // Transfer feature labels
    if (typeof refreshTransferText === "function") refreshTransferText();

    // Download button context
    updateDownloadBtn();

    // Processing
    processingText.textContent = t("processing");

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
    downloadBtn.classList.remove("hidden");
    if (feature === "tonelab") {
      $("#mode-toggle").classList.remove("hidden");
      $(".workspace").classList.remove("hidden");
      $(".recolor-workspace").classList.add("hidden");
      $(".transfer-workspace").classList.add("hidden");
      uploadBtn.classList.remove("hidden");
      uploadBtn.textContent = t("uploadNew");
      resetBtn.classList.remove("hidden");
      apiKeyBtn.classList.add("hidden");
      downloadBtn.textContent = t("download");
      downloadBtn.onclick = function () {
        var link = document.createElement("a");
        link.download = "adjusted.png";
        link.href = adjustedCanvas.toDataURL("image/png");
        link.click();
      };
    } else if (feature === "recolor") {
      $("#mode-toggle").classList.remove("hidden");
      $(".workspace").classList.add("hidden");
      $(".recolor-workspace").classList.remove("hidden");
      $(".transfer-workspace").classList.add("hidden");
      uploadBtn.classList.remove("hidden");
      uploadBtn.textContent = t("uploadNewRecolor");
      resetBtn.classList.add("hidden");
      apiKeyBtn.classList.remove("hidden");
      updateDownloadBtn();
      downloadBtn.onclick = function () {
        var link = document.createElement("a");
        if (aiResultCache[recolorCurrentIndex] && currentAiCompareShowsAi()) {
          link.download = "recolored-ai.png";
          link.href = $("#recolor-ai-canvas").toDataURL("image/png");
        } else {
          link.download = "recolored.png";
          link.href = $("#recolor-adjusted-canvas").toDataURL("image/png");
        }
        link.click();
      };
    } else if (feature === "transfer") {
      // Reference Match — no photo/illustration toggle (target comes from ref image)
      $("#mode-toggle").classList.add("hidden");
      $(".workspace").classList.add("hidden");
      $(".recolor-workspace").classList.add("hidden");
      $(".transfer-workspace").classList.remove("hidden");
      uploadBtn.classList.remove("hidden");
      uploadBtn.textContent = t("uploadNewTransfer");
      resetBtn.classList.add("hidden");
      apiKeyBtn.classList.remove("hidden");
      downloadBtn.textContent = t("download");
      downloadBtn.onclick = function () {
        var link = document.createElement("a");
        if (transferAiResultData) {
          link.download = "reference-match-ai.png";
          link.href = $("#transfer-ai-canvas").toDataURL("image/png");
        } else {
          link.download = "reference-match.png";
          link.href = $("#transfer-result-canvas").toDataURL("image/png");
        }
        link.click();
      };
    }
  }

  function updateDownloadBtn() {
    if (activeFeature !== "recolor") return;
    if (aiResultCache[recolorCurrentIndex] && currentAiCompareShowsAi()) {
      downloadBtn.textContent = t("downloadAi");
    } else {
      downloadBtn.textContent = t("download");
    }
  }

  // Returns true when the AI compare slider is positioned such that the AI
  // side is (at least) the dominant half on screen. fraction <= 0.5 means the
  // divider is on the left half, revealing the AI canvas on most of the view.
  function currentAiCompareShowsAi() {
    if (!aiResultCache[recolorCurrentIndex]) return false;
    var frac = aiComparePositions[recolorCurrentIndex];
    if (frac == null) frac = 0.5;
    return frac <= 0.5;
  }

  function backToLanding() {
    activeFeature = null;
    landing.classList.remove("hidden");
    $(".workspace").classList.add("hidden");
    $(".recolor-workspace").classList.add("hidden");
    $(".transfer-workspace").classList.add("hidden");
    uploadBtn.classList.add("hidden");
    backBtn.classList.add("hidden");
    // Hide workspace-specific controls on landing
    $("#mode-toggle").classList.add("hidden");
    resetBtn.classList.add("hidden");
    downloadBtn.classList.add("hidden");
    apiKeyBtn.classList.add("hidden");
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

        // Clear all cached AI results for previous image
        resetAiCache();

        // Reset controls for new image
        recolorStrength = 75;
        recolorSkinProtect = 0;
        recolorVibrance = 0;
        recolorVibranceUserSet = false;
        recolorCustomHue = null;
        $("#recolor-strength-slider").value = 75;
        $("#recolor-strength-value").textContent = "75%";
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

            // Auto-set smart vibrance from saturation analysis (mode-aware)
            applyAutoVibrance(recolorDiagnosis.saturation.mean, currentMode);

            // Auto-detect skin → enable skin protection.
            // Scene-factor signal (factor.skinHues) is unreliable because it
            // only inspects the top-6 dominant palette colours — any image
            // whose subject is small relative to the background misses
            // detection even when skin is clearly present pixel-wise.
            // Pixel-level density is authoritative: sample ~3000 pixels and
            // count how many pass Recolor.skinScore > 0.3.
            //   density < 0.5%  → no auto-protect (subject tiny or absent)
            //   density 0.5-2%  → 55% (moderate presence)
            //   density ≥ 2%    → 70% (substantial face region)
            // Scene detection is still consulted as a boost: confirmed
            // portrait scene raises the top tier to 75%.
            var skinDensity = 0;
            (function() {
              var sd = recolorImageData.data;
              var totalPix = recolorImageData.width * recolorImageData.height;
              var step = Math.max(1, Math.floor(totalPix / 3000));
              var skinHits = 0, scanned = 0;
              var Color = PicAnalysis.Color;
              for (var p = 0; p < totalPix; p += step) {
                var idx = p * 4;
                var hsl = Color.rgbToHsl(sd[idx], sd[idx + 1], sd[idx + 2]);
                if (Recolor.skinScore(hsl[0], hsl[1], hsl[2]) > 0.3) skinHits++;
                scanned++;
              }
              skinDensity = scanned > 0 ? skinHits / scanned : 0;
            })();
            var portraitActive = false;
            for (var si = 0; si < recolorScenes.length; si++) {
              if (recolorScenes[si].type === "portrait" && recolorScenes[si].active) {
                portraitActive = true;
                break;
              }
            }
            if (skinDensity >= 0.02) {
              recolorSkinProtect = portraitActive ? 75 : 70;
            } else if (skinDensity >= 0.005) {
              recolorSkinProtect = 55;
            }
            $("#recolor-skin-slider").value = recolorSkinProtect;
            $("#recolor-skin-value").textContent = recolorSkinProtect + "%";

            // Cache auto-detected hue for display
            recolorAutoHue = Recolor.getAutoHue(recolorImageData);
            $("#recolor-hue-slider").value = Math.round(recolorAutoHue * 360);

            recolorSchemes = Recolor.generateSchemes(recolorImageData);
            recolorResults = [];
            recolorCurrentIndex = 0;
            recolorSchemeHues = [];
            var skinVal = recolorSkinProtect / 100;
            var vibVal = recolorVibrance / 100;
            for (var i = 0; i < recolorSchemes.length; i++) {
              recolorResults.push(
                Recolor.applyScheme(recolorImageData, recolorSchemes[i].scheme, skinVal, vibVal)
              );
            }

            // Extract and display character colors (skin & hair)
            recolorCharColors = extractCharacterColors(rOrigCanvas);
            renderCharacterColors(recolorCharColors);

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
    if (_pipelineBgTimer) { clearTimeout(_pipelineBgTimer); _pipelineBgTimer = null; }

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

        // Cache current mode result
        pipelineCache = {};
        pipelineCache[currentMode] = {
          adjustments: currentAdjustments,
          resultData: resultData,
          adjustedDiagnosis: currentAdjustedDiagnosis,
        };

        // Pre-compute other mode synchronously so mode switch is always an instant display swap.
        // Stage 1 (diagnosis) and Stage 1.5 (scenes) are shared — only Stage 2+3 need to rerun.
        var otherMode = currentMode === MODES.PHOTO ? MODES.ILLUSTRATION : MODES.PHOTO;
        var otherParams = Strategy.defaultParams(otherMode);
        var otherAdj = Strategy.route(currentDiagnosis, otherParams, currentScenes, otherMode);
        var otherResult = Adjuster.adjust(originalImageData, otherAdj);
        var otherAdjDiag = Analyzer.analyze(otherResult);
        pipelineCache[otherMode] = {
          adjustments: otherAdj,
          resultData: otherResult,
          adjustedDiagnosis: otherAdjDiag,
        };

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
  // mode: optional — defaults to currentMode for backward compat
  //
  // IMPORTANT: whiteBalance / tintCorrection / desaturation are filtered out
  // when correcting a recolored image. The recolor step deliberately pushes
  // the image toward a single hue (e.g. blue), so the diagnosis sees an
  // extreme cool/tint bias and tries to "correct" it back toward neutral —
  // adding warm/magenta to a blue image, which lands on purple/pink.
  // Verified case: raw blue [97,95,223] hue 241° → corrected [148,109,139]
  // hue 314°. Tonal adjustments (brightness, contrast, shadow, highlight,
  // vibrance, saturation) are still applied since they don't fight the hue.
  var SKIP_ON_RECOLOR = { whiteBalance: 1, tintCorrection: 1, desaturation: 1 };
  function autoCorrectRecolored(recoloredData, mode) {
    var m = mode || currentMode;
    var diag = Analyzer.analyze(recoloredData);
    var scenes = recolorScenes || [];
    var modeParams = Strategy.defaultParams(m);
    var rawAdjustments = Strategy.route(diag, modeParams, scenes, m);
    var adjustments = [];
    for (var i = 0; i < rawAdjustments.length; i++) {
      if (!SKIP_ON_RECOLOR[rawAdjustments[i].type]) adjustments.push(rawAdjustments[i]);
    }
    var corrected = Adjuster.adjust(recoloredData, adjustments);
    var correctedDiag = Analyzer.analyze(corrected);
    return { corrected: corrected, adjustments: adjustments, correctedDiag: correctedDiag };
  }

  // Pre-compute auto-correction for ALL schemes × BOTH modes at current strength.
  // Builds current mode synchronously (immediate display), then the other mode
  // asynchronously in chunks to avoid blocking the main thread.
  var _bgBuildTimer = null;
  function buildRecolorCorrectionCache() {
    if (_bgBuildTimer) { clearTimeout(_bgBuildTimer); _bgBuildTimer = null; }
    var strength = recolorStrength / 100;

    // Build blended data once (shared by both modes)
    var blendedArr = [];
    for (var i = 0; i < recolorSchemes.length; i++) {
      blendedArr.push(strength >= 1 ? recolorResults[i]
        : Recolor.blendWithOriginal(recolorImageData, recolorResults[i], strength));
    }

    // Synchronous: build cache for current mode (needed immediately)
    var currentCache = [];
    for (var i = 0; i < recolorSchemes.length; i++) {
      currentCache.push(autoCorrectRecolored(blendedArr[i], currentMode));
    }
    recolorCorrectedCache = {};
    recolorCorrectedCache[currentMode] = currentCache;

    // Async: build cache for the other mode in background chunks
    var otherMode = currentMode === MODES.PHOTO ? MODES.ILLUSTRATION : MODES.PHOTO;
    var otherCache = [];
    var idx = 0;
    function buildNextChunk() {
      var end = Math.min(idx + 2, recolorSchemes.length);
      for (; idx < end; idx++) {
        otherCache.push(autoCorrectRecolored(blendedArr[idx], otherMode));
      }
      if (idx < recolorSchemes.length) {
        _bgBuildTimer = setTimeout(buildNextChunk, 0);
      } else {
        recolorCorrectedCache[otherMode] = otherCache;
        _bgBuildTimer = null;
      }
    }
    _bgBuildTimer = setTimeout(buildNextChunk, 0);
  }

  function renderRecolorAnalysis(origDiag, correctedDiag, scenes, adjustments) {
    renderScenesToPanel(scenes, $("#recolor-scenes-panel"));
    renderDiagnosis(origDiag, $("#recolor-diagnosis-panel"));
    renderDiagnosis(correctedDiag, $("#recolor-diagnosis-panel-adjusted"));
    renderAdjustments(adjustments, $("#recolor-adjustments-panel"));
  }

  // Called on mode switch while in recolor — programmatic corrections are pre-cached
  // for both modes. If the other mode's cache isn't ready yet, build it now.
  // AI corrections are re-computed from raw cache.
  function rerunRecolorAutoCorrection() {
    if (!recolorSchemes || !recolorResults.length) return;
    // If the other mode's cache isn't ready, build it synchronously now
    if (!recolorCorrectedCache[currentMode]) {
      var strength = recolorStrength / 100;
      var cache = [];
      for (var i = 0; i < recolorSchemes.length; i++) {
        var blended = strength >= 1 ? recolorResults[i]
          : Recolor.blendWithOriginal(recolorImageData, recolorResults[i], strength);
        cache.push(autoCorrectRecolored(blended, currentMode));
      }
      recolorCorrectedCache[currentMode] = cache;
    }
    displayCachedRecolorScheme(recolorCurrentIndex);
    // Re-correct all cached AI results for the new mode and refresh overlay
    if (aiRawCache[recolorCurrentIndex]) {
      correctAllAiForCurrentMode();
      var aiCanvas = $("#recolor-ai-canvas");
      var rAdjCanvas = $("#recolor-adjusted-canvas");
      aiCanvas.width = rAdjCanvas.width;
      aiCanvas.height = rAdjCanvas.height;
      aiCanvas.getContext("2d").putImageData(aiResultCache[recolorCurrentIndex], 0, 0);
      showAiCompare(true);
      setAiComparePosition(aiComparePositions[recolorCurrentIndex] != null ? aiComparePositions[recolorCurrentIndex] : 0.5);
      var scheme = recolorSchemes[recolorCurrentIndex];
      var schemeName = t("recolor." + scheme.key);
      $("#recolor-scheme-name").textContent = t("aiRecolorSchemeLabel", { scheme: schemeName });
    } else {
      showAiCompare(false);
    }
  }

  // Display a scheme from the pre-computed cache (instant, no pipeline work)
  function displayCachedRecolorScheme(idx) {
    var cached = recolorCorrectedCache[currentMode][idx];
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
    if (recolorCorrectedCache[currentMode] && recolorCorrectedCache[currentMode].length > idx) {
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

    // Render alternative palette picks
    renderAlternativePalettes(idx);
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

  // --- Alternative palette variants (same scheme, different hue) ---

  var currentVariants = null; // [{scheme, newPalette, hue}, ...] or null
  var recolorSchemeHues = []; // per-index effective hue

  function getEffectiveHue(idx) {
    if (recolorSchemeHues[idx] != null) return recolorSchemeHues[idx];
    return recolorCustomHue != null ? recolorCustomHue : recolorAutoHue;
  }

  function renderAlternativePalettes(currentIdx) {
    var altLabel = $("#recolor-alt-label");
    var altARow = $("#recolor-alt-a");
    var altBRow = $("#recolor-alt-b");
    var scheme = recolorSchemes[currentIdx];

    var palette = scheme.originalPalette;
    var hue = getEffectiveHue(currentIdx);
    var medianL = Recolor.paletteMedianL(palette);
    currentVariants = Recolor.generateVariants(scheme.key, palette, hue, medianL);

    if (!currentVariants) {
      altARow.style.display = "none";
      altBRow.style.display = "none";
      altLabel.style.display = "none";
      return;
    }

    altLabel.textContent = t("recolorAltLabel");
    altLabel.style.display = "";

    var rows = [altARow, altBRow];
    var names = [$("#recolor-alt-a-name"), $("#recolor-alt-b-name")];
    var dots = [$("#recolor-alt-a-dot"), $("#recolor-alt-b-dot")];
    var swatches = [$("#recolor-alt-a-swatches"), $("#recolor-alt-b-swatches")];

    for (var i = 0; i < 2; i++) {
      if (i < currentVariants.length) {
        var v = currentVariants[i];
        rows[i].style.display = "";
        var deg = Math.round(v.hue * 360);
        names[i].textContent = deg + "°";
        dots[i].style.background = "hsl(" + deg + ", 70%, 55%)";
        renderPaletteSwatches(v.newPalette, swatches[i]);
      } else {
        rows[i].style.display = "none";
      }
    }
  }

  function applyVariant(variantIdx) {
    if (!currentVariants || variantIdx >= currentVariants.length) return;
    var variant = currentVariants[variantIdx];
    var idx = recolorCurrentIndex;

    showProcessing(true);
    setTimeout(function () {
      // Replace scheme data at current index
      recolorSchemes[idx].scheme = variant.scheme;
      recolorSchemes[idx].newPalette = variant.newPalette;
      recolorSchemeHues[idx] = variant.hue;

      // Recompute applied image for this scheme
      var skinVal = recolorSkinProtect / 100;
      var vibVal = recolorVibrance / 100;
      recolorResults[idx] = Recolor.applyScheme(recolorImageData, variant.scheme, skinVal, vibVal);

      // Rebuild correction cache for this index (both modes, so a later
      // mode switch doesn't display the previous variant's stale result)
      var strength = recolorStrength / 100;
      var blended = strength >= 1 ? recolorResults[idx]
        : Recolor.blendWithOriginal(recolorImageData, recolorResults[idx], strength);
      if (recolorCorrectedCache[currentMode]) {
        recolorCorrectedCache[currentMode][idx] = autoCorrectRecolored(blended, currentMode);
      }
      var otherMode = currentMode === MODES.PHOTO ? MODES.ILLUSTRATION : MODES.PHOTO;
      if (recolorCorrectedCache[otherMode] && recolorCorrectedCache[otherMode].length > idx) {
        recolorCorrectedCache[otherMode][idx] = autoCorrectRecolored(blended, otherMode);
      }

      // Invalidate AI cache for this scheme — the previously generated AI
      // recolor was based on the old hue and would otherwise be restored on
      // top of the new programmatic result by the renderRecolorScheme wrapper.
      if (aiRawCache[idx]) {
        delete aiRawCache[idx];
        delete aiResultCache[idx];
        delete aiComparePositions[idx];
      }

      renderRecolorScheme(idx);
      showProcessing(false);
    }, 20);
  }

  // Click handlers for alternative palette buttons
  $("#recolor-alt-a-btn").addEventListener("click", function () { applyVariant(0); });
  $("#recolor-alt-b-btn").addEventListener("click", function () { applyVariant(1); });

  function renderCharacterColors(charColors) {
    var container = $("#recolor-char-colors");
    var skinRow = $("#recolor-skin-color-row");
    var hairRow = $("#recolor-hair-color-row");

    if (!charColors || (!charColors.skin && !charColors.hair)) {
      container.style.display = "none";
      return;
    }

    container.style.display = "";

    if (charColors.skin) {
      var s = charColors.skin;
      skinRow.style.display = "";
      $("#recolor-skin-color-label").textContent = t("recolorDetectedSkin");
      var swatch = $("#recolor-skin-swatch");
      var rgbLabel = $("#recolor-skin-rgb");
      if (charColors.skinShadow && charColors.skinHighlight) {
        var lo = charColors.skinShadow, mid = s, hi = charColors.skinHighlight;
        swatch.style.background =
          "linear-gradient(90deg, rgb(" + lo[0] + "," + lo[1] + "," + lo[2] + ") 0%, " +
          "rgb(" + mid[0] + "," + mid[1] + "," + mid[2] + ") 50%, " +
          "rgb(" + hi[0] + "," + hi[1] + "," + hi[2] + ") 100%)";
        rgbLabel.textContent =
          "RGB(" + lo[0] + "," + lo[1] + "," + lo[2] + ") \u2192 " +
          "(" + mid[0] + "," + mid[1] + "," + mid[2] + ") \u2192 " +
          "(" + hi[0] + "," + hi[1] + "," + hi[2] + ")";
      } else {
        swatch.style.background = "rgb(" + s[0] + "," + s[1] + "," + s[2] + ")";
        rgbLabel.textContent = "RGB(" + s[0] + ", " + s[1] + ", " + s[2] + ")";
      }
    } else {
      skinRow.style.display = "none";
    }

    if (charColors.hair) {
      var h = charColors.hair;
      hairRow.style.display = "";
      $("#recolor-hair-color-label").textContent = t("recolorDetectedHair");
      $("#recolor-hair-swatch").style.background = "rgb(" + h[0] + "," + h[1] + "," + h[2] + ")";
      $("#recolor-hair-rgb").textContent = "RGB(" + h[0] + ", " + h[1] + ", " + h[2] + ")";
    } else {
      hairRow.style.display = "none";
    }
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
  // Auto vibrance based on saturation analysis + mode philosophy.
  // Photo: correct toward neutral target (over-saturated → reduce, dull → boost).
  // Illustration: amplify existing direction (saturated → push further, dull → push duller).
  //
  // Two-term formula:
  //   base    = deviation from target (how far mean is from 0.30)
  //   variety = bonus for sat.std above 0.08 (images with rich color variance
  //             benefit more from vibrance boost/cut than flat images)
  //
  // Without the variety term, images whose mean sits near 0.30 get ±3 which is
  // essentially no-op — even when they have obviously vivid or muted areas.
  // Returns slider value in [-70, 70].
  function computeAutoVibrance(satMean, satStd, mode) {
    var target = 0.30;
    var deviation = satMean - target; // + = too saturated, - = too dull
    var sign = (mode === MODES.PHOTO) ? -1 : 1;
    // Coefficients reduced 200→150 (base) and 200→100 (variety): previous
    // values pushed rich-variance images (e.g. illustrations with satMean
    // 0.47 std 0.20) to the ±70 clamp, which desaturated the recolor preview
    // so much that schemes looked washed out. The new balance still reacts
    // strongly to over/under-saturation but no longer slams the clamp for
    // normal vivid content.
    var base = deviation * 150;                       // ~±38 for extreme means
    var variety = Math.max(0, (satStd - 0.08) * 100); // 0..~15 for std 0.08..0.23
    var v = sign * (base + variety);
    // Clamp ±50 (from ±70): a recolor preview with ±70 vibrance applied on
    // top of the scheme's own satMult often over-corrects. ±50 leaves
    // headroom for the user to push further manually if needed.
    if (v > 50) v = 50;
    if (v < -50) v = -50;
    return Math.round(v);
  }

  function applyAutoVibrance(satMean, mode) {
    var satStd = recolorDiagnosis ? recolorDiagnosis.saturation.std : 0;
    recolorVibrance = computeAutoVibrance(satMean, satStd, mode);
    var slider = $("#recolor-vibrance-slider");
    if (slider) slider.value = recolorVibrance;
    var label = $("#recolor-vibrance-value");
    if (label) label.textContent = recolorVibrance > 0 ? "+" + recolorVibrance : "" + recolorVibrance;
  }

  function regenerateRecolor(regenSchemes) {
    if (!recolorImageData) return;
    showProcessing(true);
    setTimeout(function () {
      try {
        if (regenSchemes) {
          recolorSchemes = Recolor.generateSchemes(recolorImageData, recolorCustomHue);
          recolorSchemeHues = [];
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
    recolorVibranceUserSet = true;
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

  // --- Recolor analysis collapsible toggle ---

  (function () {
    var toggleBtn = $("#recolor-analysis-toggle");
    var collapsible = $("#recolor-analysis-collapsible");
    var arrow = toggleBtn.querySelector(".recolor-analysis-toggle-arrow");

    toggleBtn.addEventListener("click", function () {
      var isCollapsed = collapsible.classList.toggle("collapsed");
      arrow.textContent = isCollapsed ? "\u25BC" : "\u25B2";
    });
  })();

  // --- Upload new image ---

  uploadBtn.addEventListener("click", function () {
    if (activeFeature === "recolor") {
      fileInputRecolor.value = "";
      fileInputRecolor.click();
    } else if (activeFeature === "transfer") {
      var ti = $("#file-input-transfer-target");
      ti.value = "";
      ti.click();
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

  // --- API Key Modal System ---

  var API_KEY_PATH_STORAGE = "tonelab_apikey_path";
  var API_KEY_SAVE_PREF = "tonelab_apikey_save_pref";
  var IDB_NAME = "tonelab_apikey_db";
  var IDB_STORE = "handles";
  var IDB_KEY = "apiKeyFileHandle";
  var currentApiKey = "";
  var savedFileHandle = null;

  // --- IndexedDB helpers for persisting FileSystemFileHandle ---
  function openIDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function saveHandleToIDB(handle) {
    return openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function loadHandleFromIDB() {
    return openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readonly");
        var req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function clearHandleFromIDB() {
    return openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(IDB_KEY);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  var apiKeyBtn = $("#api-key-btn");
  var apiKeyModal = $("#api-key-modal");
  var apiKeyInput = $("#api-key-input");
  var apiKeyToggle = $("#api-key-toggle");
  var apiKeySaveCheck = $("#api-key-save-check");
  var apiKeyPathRow = $("#api-key-path-row");
  var apiKeyPathValue = $("#api-key-path-value");
  var apiKeyPathChange = $("#api-key-path-change");
  var apiKeyLoadBtn = $("#api-key-load-btn");
  var apiKeyConfirm = $("#api-key-confirm");
  var apiKeyCancel = $("#api-key-cancel");

  function updateApiKeyBtnState() {
    if (currentApiKey) {
      apiKeyBtn.textContent = t("apiKeyBtnSet");
      apiKeyBtn.classList.add("has-key");
    } else {
      apiKeyBtn.textContent = t("apiKeyBtn");
      apiKeyBtn.classList.remove("has-key");
    }
  }

  function updateApiKeyModalText() {
    $("#api-key-modal-title").textContent = t("apiKeyModalTitle");
    apiKeyInput.placeholder = t("apiKeyPlaceholder");
    $("#api-key-save-text").textContent = t("apiKeySaveLocal");
    $("#api-key-path-label").textContent = t("apiKeyPathLabel");
    apiKeyPathChange.textContent = t("apiKeyPathChange");
    apiKeyLoadBtn.textContent = t("apiKeyLoadFile");
    apiKeyConfirm.textContent = t("apiKeyConfirm");
    apiKeyCancel.textContent = t("apiKeyCancel");
    updateApiKeyBtnState();
    // Update path display
    var savedPath = localStorage.getItem(API_KEY_PATH_STORAGE);
    apiKeyPathValue.textContent = savedPath || t("apiKeyPathDefault");
  }

  function openApiKeyModal() {
    apiKeyInput.value = currentApiKey;
    apiKeyInput.type = "password";
    var savePref = localStorage.getItem(API_KEY_SAVE_PREF) === "true";
    apiKeySaveCheck.checked = savePref;
    apiKeyPathRow.classList.toggle("hidden", !savePref);
    var savedPath = localStorage.getItem(API_KEY_PATH_STORAGE);
    apiKeyPathValue.textContent = savedPath || t("apiKeyPathDefault");
    apiKeyModal.classList.remove("hidden");
    apiKeyInput.focus();
  }

  function closeApiKeyModal() {
    apiKeyModal.classList.add("hidden");
  }

  apiKeyBtn.addEventListener("click", openApiKeyModal);

  apiKeyToggle.addEventListener("click", function () {
    var isPassword = apiKeyInput.type === "password";
    apiKeyInput.type = isPassword ? "text" : "password";
  });

  apiKeySaveCheck.addEventListener("change", function () {
    apiKeyPathRow.classList.toggle("hidden", !apiKeySaveCheck.checked);
  });

  // Save key to a local file via File System Access API
  function saveKeyToFile(key, pickNew) {
    var opts = {
      types: [{ description: "API Key file", accept: { "application/json": [".json"] } }],
      suggestedName: "tonelab-apikey.json"
    };
    var handlePromise;
    if (pickNew || !savedFileHandle) {
      if (!window.showSaveFilePicker) {
        // Fallback: download as file
        var blob = new Blob([JSON.stringify({ apiKey: key })], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "tonelab-apikey.json";
        a.click();
        URL.revokeObjectURL(a.href);
        localStorage.setItem(API_KEY_SAVE_PREF, "true");
        localStorage.setItem(API_KEY_PATH_STORAGE, "tonelab-apikey.json (" + t("apiKeyPathDefault") + ")");
        return Promise.resolve();
      }
      handlePromise = window.showSaveFilePicker(opts);
    } else {
      handlePromise = Promise.resolve(savedFileHandle);
    }
    return handlePromise.then(function (handle) {
      savedFileHandle = handle;
      var pathDisplay = handle.name;
      localStorage.setItem(API_KEY_PATH_STORAGE, pathDisplay);
      localStorage.setItem(API_KEY_SAVE_PREF, "true");
      apiKeyPathValue.textContent = pathDisplay;
      // Persist handle to IndexedDB for auto-load on next visit
      saveHandleToIDB(handle).catch(function () {});
      return handle.createWritable();
    }).then(function (writable) {
      return writable.write(JSON.stringify({ apiKey: key })).then(function () {
        return writable.close();
      });
    });
  }

  // Load key from a local file via File System Access API
  function loadKeyFromFile() {
    var opts = {
      types: [{ description: "API Key file", accept: { "application/json": [".json"] } }],
      multiple: false
    };
    if (!window.showOpenFilePicker) {
      // Fallback: use file input
      var input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.addEventListener("change", function () {
        if (!input.files.length) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var data = JSON.parse(reader.result);
            if (data.apiKey) {
              apiKeyInput.value = data.apiKey;
              localStorage.setItem(API_KEY_PATH_STORAGE, input.files[0].name);
              apiKeyPathValue.textContent = input.files[0].name;
            }
          } catch (e) {
            alert(t("apiKeyLoadError", { msg: e.message }));
          }
        };
        reader.readAsText(input.files[0]);
      });
      input.click();
      return;
    }
    window.showOpenFilePicker(opts).then(function (handles) {
      var handle = handles[0];
      savedFileHandle = handle;
      var pathDisplay = handle.name;
      localStorage.setItem(API_KEY_PATH_STORAGE, pathDisplay);
      apiKeyPathValue.textContent = pathDisplay;
      // Persist handle for auto-load on next visit
      saveHandleToIDB(handle).catch(function () {});
      return handle.getFile();
    }).then(function (file) {
      return file.text();
    }).then(function (text) {
      var data = JSON.parse(text);
      if (data.apiKey) {
        apiKeyInput.value = data.apiKey;
      }
    }).catch(function (e) {
      if (e.name !== "AbortError") {
        alert(t("apiKeyLoadError", { msg: e.message }));
      }
    });
  }

  apiKeyLoadBtn.addEventListener("click", loadKeyFromFile);

  apiKeyPathChange.addEventListener("click", function () {
    if (currentApiKey) {
      saveKeyToFile(currentApiKey, true).catch(function () {});
    } else {
      // Just let user pick a location for future saves
      if (window.showSaveFilePicker) {
        var opts = {
          types: [{ description: "API Key file", accept: { "application/json": [".json"] } }],
          suggestedName: "tonelab-apikey.json"
        };
        window.showSaveFilePicker(opts).then(function (handle) {
          savedFileHandle = handle;
          localStorage.setItem(API_KEY_PATH_STORAGE, handle.name);
          apiKeyPathValue.textContent = handle.name;
          saveHandleToIDB(handle).catch(function () {});
        }).catch(function () {});
      }
    }
  });

  apiKeyConfirm.addEventListener("click", function () {
    currentApiKey = (apiKeyInput.value || "").trim();
    if (apiKeySaveCheck.checked && currentApiKey) {
      saveKeyToFile(currentApiKey, false).catch(function (e) {
        if (e.name !== "AbortError") {
          alert(t("apiKeySaveError", { msg: e.message }));
        }
      });
    } else if (!apiKeySaveCheck.checked) {
      savedFileHandle = null;
      clearHandleFromIDB().catch(function () {});
    }
    localStorage.setItem(API_KEY_SAVE_PREF, apiKeySaveCheck.checked ? "true" : "false");
    updateApiKeyBtnState();
    closeApiKeyModal();
  });

  apiKeyCancel.addEventListener("click", closeApiKeyModal);

  // Close modal on overlay click
  apiKeyModal.addEventListener("click", function (e) {
    if (e.target === apiKeyModal) closeApiKeyModal();
  });

  // Close modal on Escape
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !apiKeyModal.classList.contains("hidden")) {
      closeApiKeyModal();
    }
  });

  // On page load: try to auto-load key from saved file handle in IndexedDB
  (function initApiKey() {
    updateApiKeyBtnState();
    updateApiKeyModalText();
    if (localStorage.getItem(API_KEY_SAVE_PREF) !== "true") return;
    loadHandleFromIDB().then(function (handle) {
      if (!handle) return;
      savedFileHandle = handle;
      // Request permission then read file
      return handle.queryPermission({ mode: "read" }).then(function (perm) {
        if (perm === "granted") return handle.getFile();
        return handle.requestPermission({ mode: "read" }).then(function (p) {
          if (p === "granted") return handle.getFile();
          return null;
        });
      });
    }).then(function (file) {
      if (!file) return;
      return file.text();
    }).then(function (text) {
      if (!text) return;
      try {
        var data = JSON.parse(text);
        if (data.apiKey) {
          currentApiKey = data.apiKey;
          updateApiKeyBtnState();
        }
      } catch (e) { /* ignore parse errors */ }
    }).catch(function () { /* silently fail — user can enter key manually */ });
  })();

  // --- AI Recolor ---

  var GEMINI_PRO_MODEL = "gemini-3.1-pro-preview";
  var NANO_BANANA_MODEL = "gemini-3.1-flash-image-preview";
  var GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

  function getApiKey() {
    return currentApiKey;
  }

  function canvasToBase64Jpeg(canvas) {
    var dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return dataUrl.split(",")[1];
  }

  function canvasToGrayscaleBase64(srcCanvas) {
    var w = srcCanvas.width;
    var h = srcCanvas.height;
    var tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    var ctx = tmpCanvas.getContext("2d");
    ctx.drawImage(srcCanvas, 0, 0);
    var imgData = ctx.getImageData(0, 0, w, h);
    var d = imgData.data;
    for (var i = 0; i < d.length; i += 4) {
      var gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = gray;
      d[i + 1] = gray;
      d[i + 2] = gray;
    }
    ctx.putImageData(imgData, 0, 0);
    return tmpCanvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  }

  function callGeminiApi(model, contents, config) {
    var apiKey = getApiKey();
    var url = GEMINI_API_BASE + model + ":generateContent?key=" + encodeURIComponent(apiKey);
    var body = { contents: contents };
    if (config) body.generationConfig = config;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        return res.json().then(function (err) {
          throw new Error((err.error && err.error.message) || ("HTTP " + res.status));
        });
      }
      return res.json();
    });
  }

  // --- Extract skin & hair colors programmatically from original image ---
  //
  // Skin is extracted as THREE luminance-stratified anchors (shadow / mid /
  // highlight) rather than a single average. Reason: a flat mean of all
  // skin pixels collapses face shading to a muddy L~55% tone (the classic
  // "wheat/tan" look) which, when fed to Nano Banana as the lone skin
  // reference, causes the AI to paint entire faces in that uniform colour.
  // By giving the AI three anchors and a luminance mapping, it can restore
  // the natural shadow→highlight variation of real skin.
  //
  // Filtering uses skinScore > 0.5 (stricter than the 0.3 used for
  // auto-enabling skin protection) and excludes L < 0.25 to avoid pulling
  // in dark brown hair and deep shadow regions that the wide skinScore
  // envelope would otherwise accept.

  function extractCharacterColors(canvas) {
    var Color = PicAnalysis.Color;
    var w = canvas.width;
    var h = canvas.height;
    var ctx = canvas.getContext("2d");
    var imgData = ctx.getImageData(0, 0, w, h);
    var d = imgData.data;
    var totalPixels = w * h;

    // Subsample for performance (max ~5000 pixels)
    var step = Math.max(1, Math.floor(totalPixels / 5000));

    // Collect high-confidence skin pixels with per-pixel luminance
    var samples = [];
    for (var p = 0; p < totalPixels; p += step) {
      var idx = p * 4;
      var R = d[idx], G = d[idx + 1], B = d[idx + 2];
      var hsl = Color.rgbToHsl(R, G, B);
      var lum = hsl[2];
      if (lum < 0.25) continue;
      var sk = Recolor.skinScore(hsl[0], hsl[1], lum);
      if (sk > 0.5) {
        samples.push({ r: R, g: G, b: B, l: lum, w: sk });
      }
    }

    var result = { skin: null, skinShadow: null, skinHighlight: null, hair: null };
    if (samples.length < 10) return result;

    // Weighted average over a luminance band [loPct, hiPct] of sorted samples
    samples.sort(function (a, b) { return a.l - b.l; });
    function bandAvg(loPct, hiPct) {
      var n = samples.length;
      var lo = Math.floor(n * loPct);
      var hi = Math.min(n, Math.max(lo + 1, Math.ceil(n * hiPct)));
      var sr = 0, sg = 0, sb = 0, sw = 0;
      for (var i = lo; i < hi; i++) {
        var s = samples[i];
        sr += s.r * s.w; sg += s.g * s.w; sb += s.b * s.w; sw += s.w;
      }
      if (sw < 1e-6) return null;
      return [Math.round(sr / sw), Math.round(sg / sw), Math.round(sb / sw)];
    }

    // Mid: P40-P60 (central 20% for a stable midtone, resists outliers)
    result.skin = bandAvg(0.40, 0.60);
    // Only emit shadow/highlight anchors when the skin has meaningful
    // luminance spread — otherwise three near-identical RGBs just add
    // prompt noise without helping the AI.
    var lumSpread = samples[samples.length - 1].l - samples[0].l;
    if (lumSpread >= 0.15 && samples.length >= 30) {
      result.skinShadow = bandAvg(0.10, 0.25);
      result.skinHighlight = bandAvg(0.75, 0.90);
    }

    return result;
  }

  function formatCharacterColorsForPrompt(charColors) {
    if (!charColors || (!charColors.skin && !charColors.hair)) return "";
    var Color = PicAnalysis.Color;
    var lines = [];
    function skinLine(label, rgb) {
      var hsl = Color.rgbToHsl(rgb[0], rgb[1], rgb[2]);
      return "- " + label + ": RGB(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ") " +
        "at Hue " + Math.round(hsl[0] * 360) + "°, Sat " + Math.round(hsl[1] * 100) + "%, Lum " + Math.round(hsl[2] * 100) + "%";
    }
    if (charColors.skinShadow && charColors.skin && charColors.skinHighlight) {
      // Three-anchor skin gradient — gives the AI the luminance map it needs
      // to paint shaded skin instead of a flat wheat tone.
      lines.push(skinLine("SKIN SHADOW", charColors.skinShadow));
      lines.push(skinLine("SKIN MIDTONE", charColors.skin));
      lines.push(skinLine("SKIN HIGHLIGHT", charColors.skinHighlight));
    } else if (charColors.skin) {
      lines.push(skinLine("SKIN", charColors.skin));
    }
    if (charColors.hair) {
      var h = charColors.hair;
      var hhsl = Color.rgbToHsl(h[0], h[1], h[2]);
      lines.push("- HAIR: RGB(" + h[0] + "," + h[1] + "," + h[2] + ") " +
        "at Hue " + Math.round(hhsl[0] * 360) + "°, Sat " + Math.round(hhsl[1] * 100) + "%, Lum " + Math.round(hhsl[2] * 100) + "%");
    }
    return lines.join("\n");
  }

  function buildPaletteListText(palette) {
    var lines = [];
    for (var i = 0; i < palette.length; i++) {
      var c = palette[i].rgb;
      lines.push("  [" + i + "] RGB(" + c[0] + "," + c[1] + "," + c[2] + ")");
    }
    return lines.join("\n");
  }

  function aiAnalyzeImage(base64Jpeg, palette) {
    var paletteText = "";
    if (palette && palette.length > 0) {
      paletteText =
        "\n5. HAIR COLOR SELECTION: Below is the image's extracted color palette (6 dominant colors). " +
        "If any person/character is present, identify which palette color is closest to their HAIR color and output EXACTLY one line in this format:\n" +
        "HAIR_COLOR_INDEX: <number>\n" +
        "where <number> is the index (0-" + (palette.length - 1) + ") of the closest match. " +
        "If no person/character or no visible hair, output: HAIR_COLOR_INDEX: -1\n\n" +
        "PALETTE:\n" + buildPaletteListText(palette) + "\n";
    }

    var prompt =
      "You are a professional color grading expert. Analyze this image and describe:\n" +
      "1. The main subject and composition elements\n" +
      "2. The current color palette and mood\n" +
      "3. The lighting conditions and color temperature\n" +
      "4. If any people/characters are present, describe their SKIN COLOR (e.g. fair/light/medium/olive/tan/brown/dark, and the specific tone like warm peach, cool beige, etc.) and HAIR COLOR (e.g. black, dark brown, blonde, red, etc.) in detail.\n" +
      paletteText +
      "Keep your analysis concise (under 250 words). Focus on elements relevant to recoloring.";

    var contents = [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: "image/jpeg", data: base64Jpeg } }
      ]
    }];

    return callGeminiApi(GEMINI_PRO_MODEL, contents).then(function (resp) {
      var parts = resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts;
      if (!parts || !parts.length) throw new Error("No analysis returned");
      var text = "";
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].text) text += parts[i].text;
      }

      // Parse hair color index from Gemini's response
      var hairColorIndex = -1;
      var hairMatch = text.match(/HAIR_COLOR_INDEX:\s*(-?\d+)/);
      if (hairMatch) {
        hairColorIndex = parseInt(hairMatch[1]);
      }

      return { text: text, hairColorIndex: hairColorIndex };
    });
  }

  function buildPaletteMappingText(scheme) {
    var orig = scheme.originalPalette || [];
    var target = scheme.newPalette || [];
    var lines = [];
    var count = Math.min(orig.length, target.length);
    for (var i = 0; i < count; i++) {
      var o = orig[i].rgb;
      var n = target[i].rgb;
      lines.push(
        "  RGB(" + o[0] + "," + o[1] + "," + o[2] + ") -> " +
        "RGB(" + n[0] + "," + n[1] + "," + n[2] + ")"
      );
    }
    return lines.join("\n");
  }

  function aiRecolorImage(base64Jpeg, analysis, schemeName, scheme, charColors) {
    // Get the detailed scheme description from lang keys
    var schemeDesc = t("recolorTip." + scheme.key) || "";

    // Build the concrete palette mapping from the programmatic engine
    var paletteMapping = buildPaletteMappingText(scheme);

    // Build character color preservation block with exact RGB values
    var charColorText = formatCharacterColorsForPrompt(charColors);
    var hasSkinGradient = !!(charColors && charColors.skinShadow && charColors.skinHighlight);
    var charColorBlock = "";
    if (charColorText) {
      charColorBlock =
        "CRITICAL — ORIGINAL CHARACTER COLORS (measured from the source image, MUST preserve):\n" +
        charColorText + "\n";
      if (hasSkinGradient) {
        charColorBlock +=
          "SKIN RENDERING RULE (read carefully):\n" +
          "- The three SKIN anchors above represent the original shadow / midtone / highlight of the character's skin.\n" +
          "- For every skin pixel in the grayscale image, interpolate between these three anchors based on its local grayscale luminance — DARK grayscale → SKIN SHADOW, MID grayscale → SKIN MIDTONE, BRIGHT grayscale → SKIN HIGHLIGHT. Use smooth interpolation between adjacent anchors; do NOT snap to a single anchor.\n" +
          "- DO NOT paint the entire face/body in a single uniform tone. Skin MUST retain its shadow→highlight variation.\n" +
          "- Skin hue MUST stay within 5°–50° (warm peach/tan/brown). Never push skin toward yellow (>55°), green, blue, purple, or grey.\n";
      } else {
        charColorBlock +=
          "SKIN RENDERING RULE:\n" +
          "- Use the SKIN colour above as the midtone anchor. Preserve the natural shadow→highlight variation visible in the grayscale image — darker skin regions slightly darker than the anchor, brighter regions slightly brighter — without flattening the face to one tone.\n" +
          "- Skin hue MUST stay within 5°–50° (warm peach/tan/brown). Never shift skin toward yellow (>55°), green, blue, purple, or grey.\n";
      }
      charColorBlock +=
        "Apply the color scheme ONLY to background, clothing, objects, and environment — NOT to skin or hair.\n\n";
    }

    var prompt =
      "You are a professional colorist. Here is an analysis of this image:\n\n" +
      analysis + "\n\n" +
      "RECOLOR TASK: Apply a \"" + schemeName + "\" color scheme to this image.\n" +
      "IMPORTANT: The attached image has been intentionally converted to GRAYSCALE to give you full creative control over coloring. Use the luminance/brightness information to guide where to place colors.\n\n" +
      "SCHEME DESCRIPTION:\n" + schemeDesc + "\n\n" +
      "TARGET COLOR PALETTE (apply these colors to NON-skin / NON-hair regions, based on brightness zones):\n" +
      paletteMapping + "\n\n" +
      charColorBlock +
      "INSTRUCTIONS:\n" +
      "- Colorize this grayscale image using the target palette above for backgrounds, clothing, objects, and environment.\n" +
      "- For skin areas, follow the SKIN RENDERING RULE above strictly — preserve the luminance-driven shadow→highlight gradient of the original skin, never flatten to a single tone.\n" +
      "- For hair areas, use the HAIR colour listed above while preserving the original brightness variation.\n" +
      "- Map darker non-skin regions to the darker palette colours, brighter regions to the brighter palette colours.\n" +
      "- Preserve the exact luminance/brightness relationships between regions.\n" +
      "- Keep the EXACT same composition, subjects, structure, and level of detail.\n" +
      "- The result should look like a professional color grade with vivid, intentional colors — and with natural, lifelike skin.\n" +
      "Return ONLY the recolored image.";

    var contents = [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: "image/jpeg", data: base64Jpeg } }
      ]
    }];

    var config = {
      responseModalities: ["TEXT", "IMAGE"]
    };

    return callGeminiApi(NANO_BANANA_MODEL, contents, config).then(function (resp) {
      var parts = resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts;
      if (!parts) throw new Error("No response from image model");
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].inlineData && parts[i].inlineData.data) {
          return parts[i].inlineData;
        }
        if (parts[i].inline_data && parts[i].inline_data.data) {
          return parts[i].inline_data;
        }
      }
      throw new Error("No image returned from AI model");
    });
  }

  function loadBase64Image(mimeType, base64Data) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Failed to decode AI image")); };
      img.src = "data:" + mimeType + ";base64," + base64Data;
    });
  }

  var aiRecolorBtn = $("#ai-recolor-btn");

  aiRecolorBtn.addEventListener("click", function () {
    if (!recolorImageData || !recolorSchemes) return;

    var apiKey = getApiKey();
    if (!apiKey) {
      openApiKeyModal();
      return;
    }

    var scheme = recolorSchemes[recolorCurrentIndex];
    var schemeName = t("recolor." + scheme.key);

    aiRecolorBtn.classList.add("loading");
    aiRecolorBtn.textContent = "...";
    processingText.textContent = t("aiRecolorAnalyzing");
    showProcessing(true);

    // Get the original image as base64 from the recolor original canvas
    var origCanvas = $("#recolor-original-canvas");
    var base64Jpeg = canvasToBase64Jpeg(origCanvas);

    // Create grayscale version for Nano Banana 2 (removes original color interference)
    var grayBase64 = canvasToGrayscaleBase64(origCanvas);

    // Use cached character colors (already extracted during init), or extract now as fallback
    var charColors = recolorCharColors || extractCharacterColors(origCanvas);
    var palette = scheme.originalPalette || [];

    // Step 1: Analyze with Gemini 3.1 Pro (use COLOR original for accurate analysis)
    // Also pass the 6-color palette so Gemini can pick the hair color
    aiAnalyzeImage(base64Jpeg, palette)
      .then(function (result) {
        // Extract hair color from palette based on Gemini's selection
        var hairIdx = result.hairColorIndex;
        if (hairIdx >= 0 && hairIdx < palette.length) {
          charColors.hair = palette[hairIdx].rgb.slice();
          // Update UI with Gemini-detected hair color
          recolorCharColors = charColors;
          renderCharacterColors(charColors);
        }

        processingText.textContent = t("aiRecolorGenerating");
        // Step 2: Recolor with Nano Banana 2 (use GRAYSCALE to avoid color interference)
        return aiRecolorImage(grayBase64, result.text, schemeName, scheme, charColors);
      })
      .then(function (imageData) {
        // Step 3: Load the returned image and display it
        return loadBase64Image(imageData.mimeType || imageData.mime_type || "image/png", imageData.data);
      })
      .then(function (img) {
        // Draw AI result onto the comparison overlay canvas
        var aiCanvas = $("#recolor-ai-canvas");
        var rAdjCanvas = $("#recolor-adjusted-canvas");
        var w = rAdjCanvas.width;
        var h = rAdjCanvas.height;
        aiCanvas.width = w;
        aiCanvas.height = h;
        var aiCtx = aiCanvas.getContext("2d");
        aiCtx.drawImage(img, 0, 0, w, h);

        // Cache the raw AI result and auto-correct for current mode
        var cachedIdx = recolorCurrentIndex;
        var aiRawData = aiCtx.getImageData(0, 0, w, h);
        aiRawCache[cachedIdx] = aiRawData;
        var correctedData = correctAiForCurrentMode(cachedIdx);
        aiCtx.putImageData(correctedData, 0, 0);
        aiComparePositions[cachedIdx] = 0.5;

        // Show comparison slider at 50%
        showAiCompare(true);
        setAiComparePosition(0.5);

        // Update header to indicate AI result
        var nameEl = $("#recolor-scheme-name");
        nameEl.textContent = t("aiRecolorSchemeLabel", { scheme: schemeName });

        showProcessing(false);
        aiRecolorBtn.classList.remove("loading");
        aiRecolorBtn.textContent = t("aiRecolorBtn");
      })
      .catch(function (err) {
        showProcessing(false);
        aiRecolorBtn.classList.remove("loading");
        aiRecolorBtn.textContent = t("aiRecolorBtn");
        alert(t("aiRecolorError", { msg: err.message || String(err) }));
      });
  });

  // --- AI Compare Slider ---

  var aiCompareContainer = $("#ai-compare-container");
  var aiCompareDivider = $("#ai-compare-divider");
  var aiCompareActive = false;
  var aiRawCache = {};            // schemeIndex → ImageData (raw AI result before auto-correction)
  var aiResultCache = {};         // schemeIndex → ImageData (corrected AI result for display)
  var aiComparePositions = {};    // schemeIndex → last slider fraction

  function showAiCompare(show) {
    aiCompareContainer.classList.toggle("hidden", !show);
    aiCompareActive = show;
    updateDownloadBtn();
  }

  // Re-correct a raw AI result with the current mode's parameters
  function correctAiForCurrentMode(schemeIdx) {
    var raw = aiRawCache[schemeIdx];
    if (!raw) return null;
    var corrected = autoCorrectRecolored(raw, currentMode);
    aiResultCache[schemeIdx] = corrected.corrected;
    return corrected.corrected;
  }

  // Re-correct ALL cached raw AI results for the current mode
  function correctAllAiForCurrentMode() {
    for (var idx in aiRawCache) {
      if (aiRawCache.hasOwnProperty(idx)) {
        correctAiForCurrentMode(parseInt(idx, 10));
      }
    }
  }

  function resetAiCache() {
    aiRawCache = {};
    aiResultCache = {};
    aiComparePositions = {};
    showAiCompare(false);
  }

  function setAiComparePosition(fraction) {
    // fraction: 0 = divider at left edge → AI fully visible
    //           1 = divider at right edge → programmatic fully visible
    fraction = Math.max(0, Math.min(1, fraction));
    var pct = fraction * 100;
    var aiCanvas = $("#recolor-ai-canvas");
    // clip-path: inset(top right bottom left) — reveal right side from divider
    aiCanvas.style.clipPath = "inset(0 0 0 " + pct + "%)";
    aiCanvas.style.webkitClipPath = "inset(0 0 0 " + pct + "%)";
    aiCompareDivider.style.left = pct + "%";

    // Remember position for this scheme
    if (recolorCurrentIndex != null) {
      aiComparePositions[recolorCurrentIndex] = fraction;
    }

    // Update labels
    var leftLabel = $(".ai-compare-label-left");
    var rightLabel = $(".ai-compare-label-right");
    if (leftLabel) leftLabel.style.display = pct < 8 ? "none" : "";
    if (rightLabel) rightLabel.style.display = pct > 92 ? "none" : "";

    // Refresh download button — label + target depend on slider position
    updateDownloadBtn();
  }

  (function () {
    var dragging = false;

    function getPosFraction(e) {
      var rect = aiCompareContainer.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      return x / rect.width;
    }

    aiCompareContainer.addEventListener("mousedown", function (e) {
      e.preventDefault();
      dragging = true;
      setAiComparePosition(getPosFraction(e));
    });

    aiCompareContainer.addEventListener("touchstart", function (e) {
      dragging = true;
      setAiComparePosition(getPosFraction(e));
    }, { passive: true });

    document.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      setAiComparePosition(getPosFraction(e));
    });

    document.addEventListener("touchmove", function (e) {
      if (!dragging) return;
      setAiComparePosition(getPosFraction(e));
    }, { passive: true });

    document.addEventListener("mouseup", function () { dragging = false; });
    document.addEventListener("touchend", function () { dragging = false; });
  })();

  // Show/hide AI compare per scheme — restore cached AI result if available
  var origRenderRecolorScheme = renderRecolorScheme;
  renderRecolorScheme = function (idx) {
    // Switch the programmatic scheme
    origRenderRecolorScheme(idx);
    // Restore or hide AI compare for the new scheme
    if (aiRawCache[idx]) {
      // Re-correct for current mode if needed
      if (!aiResultCache[idx]) correctAiForCurrentMode(idx);
      var aiCanvas = $("#recolor-ai-canvas");
      var rAdjCanvas = $("#recolor-adjusted-canvas");
      aiCanvas.width = rAdjCanvas.width;
      aiCanvas.height = rAdjCanvas.height;
      aiCanvas.getContext("2d").putImageData(aiResultCache[idx], 0, 0);
      showAiCompare(true);
      setAiComparePosition(aiComparePositions[idx] != null ? aiComparePositions[idx] : 0.5);
      // Update header label
      var scheme = recolorSchemes[idx];
      var schemeName = t("recolor." + scheme.key);
      $("#recolor-scheme-name").textContent = t("aiRecolorSchemeLabel", { scheme: schemeName });
    } else {
      showAiCompare(false);
    }
  };

  // ═══════════════════════════════════════════════
  // ── Transfer (Reference Match) Feature ──
  // ═══════════════════════════════════════════════

  // State
  var transferTargetImageData = null;   // ImageData of target (downscaled)
  var transferRefImageData = null;      // ImageData of reference (smaller cap)
  var transferRefProfile = null;        // Transfer.buildProfile() result
  var transferRefDiagnosis = null;
  var transferRefScenes = null;
  var transferTargetDiagnosis = null;
  var transferResultDiagnosis = null;
  var transferResultData = null;        // ImageData of latest algorithmic result
  var transferAiResultData = null;      // ImageData of latest AI result (if any)
  var transferRerunTimer = null;
  var transferParams = {
    overall: 1.0,
    lum: 0.8,
    color: 0.8,
    hue: 0.6,
    hist: 0.3,
    skin: 0.5,
    detail: 0.0
  };

  // DOM refs
  var dropZoneTransfer = $("#drop-zone-transfer");
  var fileInputTransferTarget = $("#file-input-transfer-target");
  var fileInputTransferRef = $("#file-input-transfer-ref");
  var transferTargetCanvas = $("#transfer-target-canvas");
  var transferRefCanvas = $("#transfer-ref-canvas");
  var transferResultCanvas = $("#transfer-result-canvas");
  var transferAiCanvas = $("#transfer-ai-canvas");
  var transferAiCompareContainer = $("#transfer-ai-compare-container");
  var transferAiCompareDivider = $("#transfer-ai-compare-divider");
  var transferRefEmpty = $("#transfer-ref-empty");
  var transferRefReplaceBtn = $("#transfer-ref-replace");
  var transferAiBtn = $("#transfer-ai-btn");
  var transferRefPanel = document.querySelector(".transfer-panel-ref");

  // ── Landing card wiring ──
  dropZoneTransfer.addEventListener("click", function () {
    fileInputTransferTarget.value = "";
    fileInputTransferTarget.click();
  });
  dropZoneTransfer.addEventListener("dragover", function (e) {
    e.preventDefault();
    dropZoneTransfer.classList.add("drag-over");
  });
  dropZoneTransfer.addEventListener("dragleave", function () {
    dropZoneTransfer.classList.remove("drag-over");
  });
  dropZoneTransfer.addEventListener("drop", function (e) {
    e.preventDefault();
    dropZoneTransfer.classList.remove("drag-over");
    var file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) loadTransferTarget(file);
  });

  fileInputTransferTarget.addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (file) loadTransferTarget(file);
  });
  fileInputTransferRef.addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (file) loadTransferReference(file);
  });

  // Reference image drop zone (the empty state) and Replace button
  transferRefEmpty.addEventListener("click", function () {
    fileInputTransferRef.value = "";
    fileInputTransferRef.click();
  });
  transferRefReplaceBtn.addEventListener("click", function () {
    fileInputTransferRef.value = "";
    fileInputTransferRef.click();
  });
  transferRefPanel.addEventListener("dragover", function (e) {
    e.preventDefault();
    transferRefPanel.classList.add("drag-over");
  });
  transferRefPanel.addEventListener("dragleave", function () {
    transferRefPanel.classList.remove("drag-over");
  });
  transferRefPanel.addEventListener("drop", function (e) {
    e.preventDefault();
    transferRefPanel.classList.remove("drag-over");
    var file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) loadTransferReference(file);
  });

  // Drag-and-drop onto target panel for replacement
  var transferTargetPanel = document.querySelector(".transfer-panel-target");
  transferTargetPanel.addEventListener("dragover", function (e) {
    e.preventDefault();
    transferTargetPanel.classList.add("drag-over");
  });
  transferTargetPanel.addEventListener("dragleave", function () {
    transferTargetPanel.classList.remove("drag-over");
  });
  transferTargetPanel.addEventListener("drop", function (e) {
    e.preventDefault();
    transferTargetPanel.classList.remove("drag-over");
    var file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) loadTransferTarget(file);
  });

  // ── Image loading ──
  function loadTransferTarget(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        if (Math.max(w, h) > MAX_PROCESS_DIM) {
          var scale = MAX_PROCESS_DIM / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        transferTargetCanvas.width = w;
        transferTargetCanvas.height = h;
        transferResultCanvas.width = w;
        transferResultCanvas.height = h;
        var tctx = transferTargetCanvas.getContext("2d");
        tctx.drawImage(img, 0, 0, w, h);
        transferTargetImageData = tctx.getImageData(0, 0, w, h);
        transferTargetDiagnosis = null;
        transferResultData = null;
        transferAiResultData = null;
        showTransferAiCompare(false);

        // Initial draw — copy original to result (until ref is loaded)
        transferResultCanvas.getContext("2d").drawImage(img, 0, 0, w, h);

        showFeature("transfer");

        // Compute target diagnosis in background (used for advanced panel)
        setTimeout(function () {
          transferTargetDiagnosis = Analyzer.analyze(transferTargetImageData);
          renderTransferAdvanced();
          if (transferRefImageData) runTransferPipeline();
        }, 30);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function loadTransferReference(file) {
    if (!transferTargetImageData) {
      // No target yet — open target picker first
      fileInputTransferTarget.value = "";
      fileInputTransferTarget.click();
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        if (Math.max(w, h) > TRANSFER_REF_MAX_DIM) {
          var scale = TRANSFER_REF_MAX_DIM / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        transferRefCanvas.width = w;
        transferRefCanvas.height = h;
        var rctx = transferRefCanvas.getContext("2d");
        rctx.drawImage(img, 0, 0, w, h);
        transferRefImageData = rctx.getImageData(0, 0, w, h);
        transferRefEmpty.style.display = "none";
        transferAiResultData = null;
        showTransferAiCompare(false);

        showProcessing(true);
        setTimeout(function () {
          try {
            transferRefProfile = Transfer.buildProfile(transferRefImageData);
            transferRefDiagnosis = Analyzer.analyze(transferRefImageData);
            transferRefScenes = Scene.detect(transferRefDiagnosis);
            renderTransferRefSummary();
            renderTransferAdvanced();
            runTransferPipeline();
          } catch (err) {
            window._transferError = err.message + "\n" + err.stack;
            showProcessing(false);
          }
        }, 30);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ── Pipeline ──
  function runTransferPipeline() {
    if (!transferTargetImageData || !transferRefProfile) return;
    showProcessing(true);
    setTimeout(function () {
      try {
        var opts = {
          overallStrength: transferParams.overall,
          lumStrength: transferParams.lum,
          colorStrength: transferParams.color,
          hueStrength: transferParams.hue,
          histogramShape: transferParams.hist,
          skinProtect: transferParams.skin,
          detailRetain: transferParams.detail
        };
        transferResultData = Transfer.match(transferTargetImageData, transferRefProfile, opts);
        transferResultCanvas.getContext("2d").putImageData(transferResultData, 0, 0);
        // Diagnosis of result for the comparison table
        transferResultDiagnosis = Analyzer.analyze(transferResultData);
        renderTransferAdvanced();
      } catch (err) {
        window._transferError = err.message + "\n" + err.stack;
      }
      showProcessing(false);
    }, 20);
  }

  function scheduleTransferRerun() {
    if (transferRerunTimer) clearTimeout(transferRerunTimer);
    transferRerunTimer = setTimeout(function () {
      transferRerunTimer = null;
      runTransferPipeline();
    }, 180);
  }

  // ── Reference summary ──
  function renderTransferRefSummary() {
    var panel = $("#transfer-ref-summary");
    if (!transferRefDiagnosis) { panel.innerHTML = ""; return; }
    var d = transferRefDiagnosis;
    var pal = transferRefProfile && transferRefProfile.palette || [];

    var swatches = "";
    var totalCount = 0;
    for (var i = 0; i < pal.length; i++) totalCount += pal[i].count;
    for (var i = 0; i < pal.length; i++) {
      var c = pal[i].rgb;
      var pct = totalCount > 0 ? ((pal[i].count / totalCount) * 100).toFixed(0) : "0";
      swatches +=
        '<div class="swatch" style="background:rgb(' + c[0] + "," + c[1] + "," + c[2] + ')" ' +
        'title="RGB(' + c[0] + "," + c[1] + "," + c[2] + ") — " + pct + '%"></div>';
    }

    panel.innerHTML =
      '<div class="transfer-ref-summary-item"><span class="label">' + t("transferRefBrightness") + '</span>' +
        '<span class="value">' + d.luminance.mean.toFixed(1) + '</span></div>' +
      '<div class="transfer-ref-summary-item"><span class="label">' + t("transferRefContrast") + '</span>' +
        '<span class="value">' + d.luminance.std.toFixed(1) + '</span></div>' +
      '<div class="transfer-ref-summary-item"><span class="label">' + t("transferRefSat") + '</span>' +
        '<span class="value">' + d.saturation.mean.toFixed(3) + '</span></div>' +
      '<div class="transfer-ref-summary-item"><span class="label">' + t("transferRefTemp") + '</span>' +
        '<span class="value">' + (d.colorTempBias > 0 ? "+" : "") + d.colorTempBias.toFixed(3) + '</span></div>' +
      '<div class="transfer-ref-summary-palette">' +
        '<span class="label">' + t("transferRefPalette") + '</span>' +
        '<div class="color-swatches">' + swatches + '</div>' +
      '</div>';
  }

  // ── Advanced analysis (collapsible) ──
  function renderTransferAdvanced() {
    if (transferRefScenes) {
      renderScenesToPanel(transferRefScenes, $("#transfer-ref-scenes-panel"));
    }
    if (transferTargetDiagnosis) renderDiagnosis(transferTargetDiagnosis, $("#transfer-diag-target"));
    if (transferRefDiagnosis) renderDiagnosis(transferRefDiagnosis, $("#transfer-diag-ref"));
    if (transferResultDiagnosis) renderDiagnosis(transferResultDiagnosis, $("#transfer-diag-result"));

    renderTransferPaletteRow($("#transfer-palette-target"), transferTargetDiagnosis);
    if (transferRefProfile) {
      renderTransferProfilePalette($("#transfer-palette-ref"), transferRefProfile.palette);
    }
    renderTransferPaletteRow($("#transfer-palette-result"), transferResultDiagnosis);
  }

  function renderTransferPaletteRow(el, diag) {
    if (!el) return;
    if (!diag || !diag.dominantColors) { el.innerHTML = ""; return; }
    var totalCount = 0;
    for (var i = 0; i < diag.dominantColors.length; i++) totalCount += diag.dominantColors[i].count;
    var html = "";
    var colors = diag.dominantColors.slice(0, 6);
    for (var i = 0; i < colors.length; i++) {
      var c = colors[i];
      var r = Math.round(c.center[0]), g = Math.round(c.center[1]), b = Math.round(c.center[2]);
      var pct = totalCount > 0 ? ((c.count / totalCount) * 100).toFixed(0) : "0";
      html +=
        '<div class="swatch" style="background:rgb(' + r + "," + g + "," + b + ')" ' +
        'title="RGB(' + r + "," + g + "," + b + ") — " + pct + '%"></div>';
    }
    el.innerHTML = html;
  }

  function renderTransferProfilePalette(el, palette) {
    if (!el) return;
    if (!palette) { el.innerHTML = ""; return; }
    var totalCount = 0;
    for (var i = 0; i < palette.length; i++) totalCount += palette[i].count;
    var html = "";
    for (var i = 0; i < palette.length; i++) {
      var c = palette[i].rgb;
      var pct = totalCount > 0 ? ((palette[i].count / totalCount) * 100).toFixed(0) : "0";
      html +=
        '<div class="swatch" style="background:rgb(' + c[0] + "," + c[1] + "," + c[2] + ')" ' +
        'title="RGB(' + c[0] + "," + c[1] + "," + c[2] + ") — " + pct + '%"></div>';
    }
    el.innerHTML = html;
  }

  // ── Sliders ──
  function bindTransferSlider(sliderId, valueId, key, suffix, scale) {
    var slider = $("#" + sliderId);
    var valueEl = $("#" + valueId);
    slider.addEventListener("input", function () {
      var raw = parseInt(slider.value, 10);
      transferParams[key] = raw / scale;
      valueEl.textContent = raw + suffix;
      scheduleTransferRerun();
    });
  }
  bindTransferSlider("transfer-strength-overall", "transfer-strength-overall-value", "overall", "%", 100);
  bindTransferSlider("transfer-strength-lum", "transfer-strength-lum-value", "lum", "%", 100);
  bindTransferSlider("transfer-strength-color", "transfer-strength-color-value", "color", "%", 100);
  bindTransferSlider("transfer-strength-hue", "transfer-strength-hue-value", "hue", "%", 100);
  bindTransferSlider("transfer-strength-hist", "transfer-strength-hist-value", "hist", "%", 100);
  bindTransferSlider("transfer-strength-skin", "transfer-strength-skin-value", "skin", "%", 100);
  bindTransferSlider("transfer-strength-detail", "transfer-strength-detail-value", "detail", "%", 100);

  // ── Advanced collapsible toggle ──
  (function () {
    var btn = $("#transfer-analysis-toggle");
    var col = $("#transfer-analysis-collapsible");
    var arrow = btn.querySelector(".recolor-analysis-toggle-arrow");
    btn.addEventListener("click", function () {
      var isCollapsed = col.classList.toggle("collapsed");
      arrow.textContent = isCollapsed ? "\u25BC" : "\u25B2";
    });
  })();

  // ── AI Reference Match ──
  function showTransferAiCompare(show) {
    transferAiCompareContainer.classList.toggle("hidden", !show);
  }

  function setTransferAiComparePos(fraction) {
    fraction = Math.max(0, Math.min(1, fraction));
    var pct = fraction * 100;
    transferAiCanvas.style.clipPath = "inset(0 0 0 " + pct + "%)";
    transferAiCanvas.style.webkitClipPath = "inset(0 0 0 " + pct + "%)";
    transferAiCompareDivider.style.left = pct + "%";
  }

  (function () {
    var dragging = false;
    function frac(e) {
      var rect = transferAiCompareContainer.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      return x / rect.width;
    }
    transferAiCompareContainer.addEventListener("mousedown", function (e) {
      e.preventDefault(); dragging = true; setTransferAiComparePos(frac(e));
    });
    transferAiCompareContainer.addEventListener("touchstart", function (e) {
      dragging = true; setTransferAiComparePos(frac(e));
    }, { passive: true });
    document.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      if (transferAiCompareContainer.classList.contains("hidden")) return;
      setTransferAiComparePos(frac(e));
    });
    document.addEventListener("touchmove", function (e) {
      if (!dragging) return;
      if (transferAiCompareContainer.classList.contains("hidden")) return;
      setTransferAiComparePos(frac(e));
    }, { passive: true });
    document.addEventListener("mouseup", function () { dragging = false; });
    document.addEventListener("touchend", function () { dragging = false; });
  })();

  function aiTransferMatch(targetCanvas, refCanvas) {
    // Both as base64 jpegs
    var targetB64 = canvasToBase64Jpeg(targetCanvas);
    var refB64 = canvasToBase64Jpeg(refCanvas);

    var prompt =
      "You are a professional colorist. The FIRST image is the TARGET image. " +
      "The SECOND image is a REFERENCE image whose color palette, lighting, and overall mood the user wants to imitate.\n\n" +
      "TASK: Recolor the TARGET image so that its overall color palette, lighting, contrast, saturation, and color temperature " +
      "match the REFERENCE image as closely as possible. Do NOT change the composition, subjects, or structure of the TARGET. " +
      "Only change colors and tones.\n\n" +
      "INSTRUCTIONS:\n" +
      "- Match the reference's color cast (warm/cool/tinted) on the target\n" +
      "- Match the reference's brightness range and contrast feel\n" +
      "- Match the reference's saturation level\n" +
      "- Preserve all subjects, faces, and details exactly — only change color/tone\n" +
      "- The result should look like the target image was photographed/painted under the same color grading as the reference\n" +
      "Return ONLY the recolored target image.";

    var contents = [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: "image/jpeg", data: targetB64 } },
        { inline_data: { mime_type: "image/jpeg", data: refB64 } }
      ]
    }];
    var config = { responseModalities: ["TEXT", "IMAGE"] };

    return callGeminiApi(NANO_BANANA_MODEL, contents, config).then(function (resp) {
      var parts = resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts;
      if (!parts) throw new Error("No response from image model");
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].inlineData && parts[i].inlineData.data) return parts[i].inlineData;
        if (parts[i].inline_data && parts[i].inline_data.data) return parts[i].inline_data;
      }
      throw new Error("No image returned from AI model");
    });
  }

  transferAiBtn.addEventListener("click", function () {
    if (!transferTargetImageData || !transferRefImageData) return;
    var apiKey = getApiKey();
    if (!apiKey) { openApiKeyModal(); return; }

    transferAiBtn.classList.add("loading");
    transferAiBtn.textContent = "...";
    processingText.textContent = t("transferAiAnalyzing");
    showProcessing(true);

    setTimeout(function () { processingText.textContent = t("transferAiGenerating"); }, 600);

    aiTransferMatch(transferTargetCanvas, transferRefCanvas)
      .then(function (imageData) {
        return loadBase64Image(imageData.mimeType || imageData.mime_type || "image/png", imageData.data);
      })
      .then(function (img) {
        var w = transferResultCanvas.width;
        var h = transferResultCanvas.height;
        transferAiCanvas.width = w;
        transferAiCanvas.height = h;
        var ctx = transferAiCanvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        transferAiResultData = ctx.getImageData(0, 0, w, h);

        showTransferAiCompare(true);
        setTransferAiComparePos(0.5);

        showProcessing(false);
        transferAiBtn.classList.remove("loading");
        transferAiBtn.textContent = t("transferAiBtn");
      })
      .catch(function (err) {
        showProcessing(false);
        transferAiBtn.classList.remove("loading");
        transferAiBtn.textContent = t("transferAiBtn");
        alert((err && err.message) || String(err));
      });
  });

  // ── Text refresh ──
  function refreshTransferText() {
    $("#landing-transfer-title").textContent = t("landingTransferTitle");
    $("#landing-transfer-desc").textContent = t("landingTransferDesc");
    $("#landing-transfer-f1").textContent = t("landingTransferF1");
    $("#landing-transfer-f2").textContent = t("landingTransferF2");
    $("#landing-transfer-f3").textContent = t("landingTransferF3");
    $("#drop-text-transfer").textContent = t("dropTextTransfer");
    $("#drop-hint-transfer").textContent = t("dropHintTransfer");

    $("#transfer-title-target").textContent = t("transferTitleTarget");
    $("#transfer-title-ref").textContent = t("transferTitleRef");
    $("#transfer-title-result").textContent = t("transferTitleResult");
    $("#transfer-ref-empty-text").textContent = t("transferRefEmptyText");
    $("#transfer-ref-empty-hint").textContent = t("transferRefEmptyHint");
    $("#transfer-ref-replace").textContent = t("transferRefReplace");

    $("#transfer-title-summary").textContent = t("transferRefSummary");
    $("#transfer-title-controls").textContent = t("transferControlsTitle");
    $("#transfer-strength-overall-label").textContent = t("transferStrengthOverall");
    $("#transfer-strength-lum-label").textContent = t("transferStrengthLum");
    $("#transfer-strength-color-label").textContent = t("transferStrengthColor");
    $("#transfer-strength-hue-label").textContent = t("transferStrengthHue");
    $("#transfer-strength-hist-label").textContent = t("transferStrengthHist");
    $("#transfer-strength-skin-label").textContent = t("transferStrengthSkin");
    $("#transfer-strength-detail-label").textContent = t("transferStrengthDetail");

    $("#transfer-analysis-toggle-text").textContent = t("transferAdvancedAnalysis");
    $("#transfer-title-ref-scenes").textContent = t("transferRefScenes");
    $("#transfer-title-diagnosis").textContent = t("transferDiagnosisCompare");
    $("#transfer-diag-title-target").textContent = t("transferDiagTarget");
    $("#transfer-diag-title-ref").textContent = t("transferDiagRef");
    $("#transfer-diag-title-result").textContent = t("transferDiagResult");
    $("#transfer-title-palette-compare").textContent = t("transferPaletteCompare");
    $("#transfer-palette-target-label").textContent = t("transferPaletteTarget");
    $("#transfer-palette-ref-label").textContent = t("transferPaletteRef");
    $("#transfer-palette-result-label").textContent = t("transferPaletteResult");

    $("#transfer-ai-btn").textContent = t("transferAiBtn");
    $("#transfer-ai-compare-label-left").textContent = t("aiCompareLabelLeft");
    $("#transfer-ai-compare-label-right").textContent = t("aiCompareLabelRight");

    // Re-render any panels that contain translatable strings
    if (transferRefDiagnosis) renderTransferRefSummary();
    renderTransferAdvanced();
  }

  // --- Init ---

  buildControls();
  renderPresets();
  refreshAllText();
})();
