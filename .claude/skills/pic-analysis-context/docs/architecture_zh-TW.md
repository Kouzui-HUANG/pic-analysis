# PicAnalysis 架構參考文件

## 專案根目錄
`/Users/kouzuimac/Documents/claude_code/pic-analysis/`

## 模組 → 檔案對應表

| 模組 | 檔案 | 管線階段 | 職責 |
|------|------|---------|------|
| Color | `js/color.js` | 基礎層 | RGB/HSL/LAB 色彩空間轉換、亮度計算 |
| Stats | `js/stats.js` | 基礎層 | mean、std、skewness、percentile、histogram、kMeans |
| Analyzer | `js/analyzer.js` | 第 1 階段 | ImageData → Diagnosis 診斷物件 |
| Scene | `js/scene.js` | 第 1.5 階段 | Diagnosis → Scene[]（含信心分數） |
| Strategy | `js/strategy.js` | 第 2 階段 | Diagnosis + Scene[] + params → Adjustment[] |
| Adjuster | `js/adjuster.js` | 第 3 階段 | ImageData + Adjustment[] → 調整後 ImageData |
| Lang | `js/lang.js` | UI 層 | 國際化，191 個翻譯鍵值，支援 EN + zh-Hant |
| Main | `js/main.js` | UI / 協調層 | 管線協調、DOM 綁定、預設值系統 |

---

## Diagnosis 物件結構（Analyzer 輸出）

```
luminance:    { mean, std, skewness, p5, p95, dynamicRange, histogram[256] }
saturation:   { mean, std }
colorTempBias: 浮點數 -1（冷色）…+1（暖色）
tintBias:     浮點數 -1（洋紅偏）…+1（綠色偏）
channels:     { rMean, gMean, bMean, rHistogram, gHistogram, bHistogram }
dominantColors: [{center:[R,G,B], count}]  ← 最多 6 色，來自 kMeans（抽樣 2000 點）
regions:      [{gx, gy, lumMean, satMean}]  ← 3×3 網格 = 9 個區塊
regionSummary: { regionContrast, darkest, brightest, centerEdgeDiff, darkestPos, brightestPos }
colorHarmony: { type, typeKey, score, hues[] }
  類型：neutral（中性）/ monochromatic（單色）/ analogous（類似色）/ complementary（互補色）/
        splitComplementary（分裂互補）/ triadic（三角）/ tetradic（四角）/ diverse（多元）
```

---

## 11 種場景類型（場景偵測器）

所有信心分數皆使用 `sigmoid(value, lo, hi)` 計算——無硬性閾值。

| 鍵值 | 觸發特徵 |
|------|---------|
| `lowKey` | 暗部均值 40-100、正偏態、動態範圍 60-120 |
| `highKey` | 亮部均值 160-220、負偏態、p95 達 230-250 |
| `desaturated` | 低飽和度均值 + 低飽和度標準差 |
| `warmTone` | colorTempBias > 0.03、主色相集中於 330°-60° |
| `coolTone` | colorTempBias < -0.03、主色相集中於 180°-260° |
| `highContrast` | 標準差 60-90、動態範圍 180-230、雙峰直方圖 |
| `silhouette` | 強烈雙峰分布、動態範圍 200-240、區域對比 100-180 |
| `softDreamy` | 低標準差 30-60（反轉）、偏亮均值 140-190、窄動態範圍 |
| `foggy` | 低標準差、**抬升陰影**（p5: 20-70）、低飽和度、均勻區域 |
| `goldenHour` | 強烈暖色偏向 0.06-0.18、豐富飽和度 0.25-0.5 |
| `portrait` | 膚色色相 10°-50°、膚色飽和度 0.15-0.55、中央比邊緣亮 |

---

## 10 種調整類型（Strategy → Adjuster）

| 類型 | 觸發條件 | 關鍵閾值參數 |
|------|---------|------------|
| `brightness` | \|skewness\| > 閾值 | brightnessSkewThreshold |
| `contrast` | dynamicRange < 最小值 | contrastMinDynamicRange |
| `contrastReduction` | std > 最大值 | contrastMaxStd |
| `vibrance` | satMean < 最小值 | vibranceMinMean |
| `saturation` | satMean < 最小值 | saturationMinMean |
| `desaturation` | satMean > 最大值 | saturationMaxMean |
| `whiteBalance` | \|colorTempBias\| > 最大值 | whiteBalanceMaxBias |
| `tintCorrection` | \|tintBias\| > 最大值 | tintMaxBias |
| `shadowRecovery` | p5 < 閾值 | shadowP5Threshold |
| `highlightRecovery` | p95 > 閾值 | highlightP95Threshold |

**最終調整量公式：**
```
調整量 = 基礎調整量 × 場景抑制係數 × globalStrength（全域強度）
```

---

## 場景抑制係數（Strategy 模組）

係數 < 1.0 表示偵測到特定場景時，對應調整會被按比例抑制。

| 場景 | 受抑制的調整 | 係數範圍 |
|------|------------|---------|
| `lowKey` | brightness、shadowRecovery | 0.90 / 0.85 |
| `highKey` | brightness、highlightRecovery | 0.90 / 0.85 |
| `desaturated` | saturation、vibrance | 0.95 / 0.90 |
| `warmTone` | whiteBalance | 0.80 |
| `coolTone` | whiteBalance | 0.80 |
| `highContrast` | contrast、contrastReduction、各種還原 | 0.90 / 0.95 / 0.60 |
| `silhouette` | **所有調整**（最強抑制） | 0.50-0.95 |
| `softDreamy` | contrast、highlightRecovery | 0.85 / 0.80 |
| `foggy` | contrast、saturation、vibrance | 0.90 / 0.85 / 0.80 |
| `goldenHour` | whiteBalance、desaturation、tintCorrection | 0.95 / 0.80 / 0.60 |
| `portrait` | saturation、vibrance、contrast | 0.70 / 0.50 / 0.60 |

---

## 邊緣保護輪廓（Adjuster 模組）

每種調整對三種像素類型設有保護強度（0 = 無保護，1 = 完全保護）。

| 調整類型 | 亮部保護 | 暗部保護 | 無彩色保護 |
|---------|---------|---------|----------|
| brightness | 1.0 | 1.0 | 0.3 |
| contrast | 0.6 | 0.6 | 0.3 |
| contrastReduction | 0.5 | 0.5 | 0.3 |
| saturation | 0.8 | 0.8 | **1.0** |
| desaturation | 0.2 | 0.2 | 0.0 |
| whiteBalance | 0.7 | 0.4 | **0.0**（必須影響中性色） |
| tintCorrection | 0.7 | 0.4 | **0.0** |
| shadowRecovery | 0.0 | 0.0 | 0.4 |
| highlightRecovery | 0.0 | 0.0 | 0.3 |
| vibrance | 0.7 | 0.7 | 0.4 |

保護透過三次方/二次方衰減曲線啟動：
- 亮部保護：亮度 > 0.8
- 暗部保護：亮度 < 0.1
- 無彩色保護：色度 < 0.1

---

## 32 個可調參數（Strategy.defaultParams）

### 策略閾值
`sceneAwareness`、`brightnessSkewThreshold`、`contrastMinDynamicRange`、`contrastMaxStd`、
`vibranceMinMean`、`saturationMinMean`、`saturationMaxMean`、`whiteBalanceMaxBias`、
`tintMaxBias`、`shadowP5Threshold`、`highlightP95Threshold`

### 目標值
`brightnessTarget`（60-200）、`contrastTarget`（80-220）、`saturationTarget`（0.1-0.8）

### 調整強度
`globalStrength`、`brightnessStrength`、`contrastStrength`、`contrastReductionStrength`、
`vibranceStrength`、`saturationStrength`、`desaturationStrength`、
`whiteBalanceStrength`、`tintStrength`、`shadowStrength`、`highlightStrength`

透過 localStorage 以 5 個命名預設槽位持久保存。

---

## 關鍵設計約束（修改前必讀）

1. **無外部依賴** — 純 Vanilla JS ES5，無建構步驟，無 npm
2. **Diagnosis 已快取** — 參數滑桿變更時跳過第 1 階段，直接從第 2 階段重新執行
3. **場景感知為乘法運算** — `sceneAwareness` 參數（0-1）會縮放**所有**抑制係數
4. **無彩色像素的飽和度神聖不可侵犯** — 保護係數 = 1.0，絕不向灰色像素添加色彩
5. **whiteBalance/tintCorrection 必須影響中性色** — 無彩色保護係數 = 0.0，此為刻意設計
6. **K-means 抽樣至 2000 點** — 出於效能考量；更改此值會影響主要色彩的準確性
7. **MAX_PROCESS_DIM = 2048** — 影像在處理前會被縮小至此尺寸
8. **Lang 鍵值必須同時存在於 EN 和 zh 物件中** — 新增 UI 標籤時需更新 lang.js 的兩個語言物件
9. **直方圖為 256 格正規化格式** — 值為 Float64 分數，非原始計數
10. **管線重入口** — 參數變更時，只有第 2 和第 3 階段重新執行（Diagnosis 和 Scene 結果會被重複使用）
