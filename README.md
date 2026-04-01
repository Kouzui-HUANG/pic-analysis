# PicAnalysis — 智慧影像分析與場景感知增強系統

> 一套純前端、無依賴的專業級影像分析引擎，透過多階段管線自動診斷影像特性、識別藝術場景意圖，並以像素級精度施加保護性修正。

---

## 目錄

1. [專案概述](#1-專案概述)
2. [整體架構說明](#2-整體架構說明)
3. [各模組詳細介紹](#3-各模組詳細介紹)
   - [color.js — 色彩空間轉換層](#31-colorjs--色彩空間轉換層)
   - [stats.js — 統計工具層](#32-statsjs--統計工具層)
   - [analyzer.js — 診斷引擎（Stage 1）](#33-analyzerjs--診斷引擎stage-1)
   - [scene.js — 場景偵測器（Stage 1.5）](#34-scenejs--場景偵測器stage-15)
   - [strategy.js — 策略路由器（Stage 2）](#35-strategyjs--策略路由器stage-2)
   - [adjuster.js — 像素調整器（Stage 3）](#36-adjusterjs--像素調整器stage-3)
   - [lang.js — 多語系模組](#37-langjs--多語系模組)
   - [main.js — 應用程式協調器](#38-mainjs--應用程式協調器)
4. [核心機制深度解析](#4-核心機制深度解析)
   - [影像分析機制](#41-影像分析機制)
   - [場景感知機制](#42-場景感知機制)
   - [策略決策機制](#43-策略決策機制)
   - [邊緣保護機制](#44-邊緣保護機制)
   - [像素調整機制](#45-像素調整機制)
5. [資料處理流程](#5-資料處理流程)
6. [API 介面參考](#6-api-介面參考)
7. [參數系統說明](#7-參數系統說明)
8. [預設值系統](#8-預設值系統)
9. [使用方式](#9-使用方式)
10. [安裝與啟動](#10-安裝與啟動)
11. [技術棧說明](#11-技術棧說明)
12. [設計理念](#12-設計理念)

---

## 1. 專案概述

**PicAnalysis** 是一套以瀏覽器為執行環境的智慧影像分析與自動增強系統，專為攝影師與影像創作者設計。系統的核心理念是「**場景感知優先於盲目修正**」——在套用任何自動調整之前，系統會先判斷影像是否具有特定的藝術風格意圖（如低調攝影、剪影、霧感等），再決定是否應當干預，以及干預的力度。

### 主要特色

| 特性 | 說明 |
|------|------|
| **零依賴** | 純 Vanilla JavaScript，無需任何第三方函式庫或框架 |
| **純前端** | 所有運算在瀏覽器端完成，影像資料不會上傳至伺服器 |
| **場景感知** | 自動偵測 11 種藝術場景類型，防止破壞創作者意圖 |
| **像素級保護** | 每種調整皆有獨立的邊緣保護輪廓，避免posterization與色彩雜訊 |
| **雙向調整** | 系統可對影像進行增強或抑制，依實際需求雙向修正 |
| **雙語界面** | 支援英文與繁體中文，所有界面元素完整在地化 |
| **預設系統** | 支援 5 組參數預設值，透過 localStorage 持久保存 |

---

## 2. 整體架構說明

PicAnalysis 採用**四階段串列管線（Pipeline）**架構，每個階段的輸出作為下一個階段的輸入：

```
┌─────────────────────────────────────────────────────────────────┐
│                        使用者上傳影像                            │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    影像預處理（main.js）                         │
│  縮放至最大處理尺寸（MAX_PROCESS_DIM = 2048px）                  │
│  從 Canvas 取得 ImageData（RGBA Uint8ClampedArray）               │
└─────────────────────────────┬───────────────────────────────────┘
                              │
              ┌───────────────┼───────────────────────────────┐
              │               │                               │
              ▼               ▼                               ▼
        ┌──────────┐   ┌──────────────┐              ┌──────────────┐
        │ color.js │   │   stats.js   │              │   lang.js    │
        │ 色彩空間  │   │  統計工具    │              │  多語系模組  │
        └──────────┘   └──────────────┘              └──────────────┘
              │               │
              └───────┬───────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                STAGE 1 — Analyzer（診斷引擎）                    │
│  輸入：ImageData                                                 │
│  輸出：Diagnosis（完整統計診斷物件）                              │
│  工作：亮度/飽和度/色溫/色偏/色彩和諧/K-means主色/區域分析        │
└─────────────────────────────┬───────────────────────────────────┘
                              │ Diagnosis
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              STAGE 1.5 — Scene Detector（場景偵測器）             │
│  輸入：Diagnosis                                                  │
│  輸出：Scene[]（帶信心分數的場景陣列）                            │
│  工作：識別 11 種藝術風格場景，計算信心分數                       │
└─────────────────────────────┬───────────────────────────────────┘
                              │ Scene[]
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              STAGE 2 — Strategy Router（策略路由器）              │
│  輸入：Diagnosis + Scene[] + 使用者參數                           │
│  輸出：Adjustment[]（帶數量與抑制係數的調整列表）                 │
│  工作：決定套用哪些調整、施力多強、場景抑制係數為何              │
└─────────────────────────────┬───────────────────────────────────┘
                              │ Adjustment[]
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              STAGE 3 — Adjuster（像素調整器）                    │
│  輸入：ImageData + Adjustment[]                                  │
│  輸出：調整後的 ImageData                                        │
│  工作：逐像素施加調整，搭配邊緣保護輪廓                          │
└─────────────────────────────┬───────────────────────────────────┘
                              │ 調整後 ImageData
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    渲染結果（main.js）                           │
│  - 並列顯示原始與調整後影像                                      │
│  - 繪製亮度 / RGB 色頻直方圖                                     │
│  - 顯示診斷面板、場景標籤、調整列表                              │
│  - 啟用下載按鈕                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 命名空間結構

所有模組均掛載在全域命名空間 `PicAnalysis` 下：

```
PicAnalysis
├── Color     (color.js)
├── Stats     (stats.js)
├── Analyzer  (analyzer.js)
├── Scene     (scene.js)
├── Strategy  (strategy.js)
├── Adjuster  (adjuster.js)
└── Lang      (lang.js)
```

---

## 3. 各模組詳細介紹

### 3.1 color.js — 色彩空間轉換層

提供 RGB、HSL、LAB 三種色彩空間之間的轉換函式，是所有色彩計算的基礎層。

#### 公開函式

| 函式 | 說明 |
|------|------|
| `clamp(val, min, max)` | 將數值限制在 `[min, max]` 範圍內 |
| `luminance(r, g, b)` | 依 ITU-R 標準計算感知亮度（`0.299R + 0.587G + 0.114B`） |
| `rgbToHsl(r, g, b)` | RGB → `[H(0-360), S(0-1), L(0-1)]` |
| `hslToRgb(h, s, l)` | HSL → `[R, G, B]`（0-255） |
| `rgbToLab(r, g, b)` | RGB → `[L*(0-100), a*(-128~127), b*(-128~127)]`（D65 光源） |
| `labToRgb(L, a, b)` | LAB → `[R, G, B]`（0-255） |

#### 關鍵設計

- **亮度公式**：採用 ITU-R BT.601 標準，符合人眼感知特性（綠色通道權重最高）
- **LAB 色彩空間**：基於 CIE D65 標準光源，適合感知均勻的色彩計算
- HSL 空間主要用於亮度與飽和度調整；LAB 空間則用於需要感知準確性的操作

---

### 3.2 stats.js — 統計工具層

提供影像統計分析所需的數學工具，包含機率統計、直方圖運算與 K-means 分群演算法。

#### 公開函式

| 函式 | 說明 |
|------|------|
| `mean(arr)` | 計算陣列平均值 |
| `std(arr, avg)` | 計算標準差（需傳入預先計算的平均值） |
| `skewness(arr, avg, sigma)` | 計算三階矩偏態係數（正值=右偏/暗部居多，負值=左偏/亮部居多） |
| `percentile(sortedArr, p)` | 線性插值計算百分位數 |
| `histogram(arr, bins, min, max)` | 建立指定區間數的直方圖（回傳正規化 Float64Array） |
| `kMeans(points, k, maxIter)` | K-means 分群（預設最多 20 次迭代） |

#### K-means 演算法細節

- **輸入**：`[[R, G, B], ...]` 色點陣列
- **輸出**：`[{center: [R, G, B], count: N}, ...]`，依出現次數降序排列
- **效能最佳化**：從原始像素中隨機抽取最多 2000 個樣本點進行分群
- **用途**：提取影像中最多 6 種主要色彩

---

### 3.3 analyzer.js — 診斷引擎（Stage 1）

整個管線的第一階段，負責從原始像素資料中提取完整的統計診斷資訊。

#### 輸入／輸出

```
輸入：ImageData（HTML Canvas 標準格式）
輸出：Diagnosis 物件（見下方）
```

#### Diagnosis 物件結構

```javascript
{
  width: Number,            // 影像寬度（px）
  height: Number,           // 影像高度（px）
  pixelCount: Number,       // 總像素數

  luminance: {
    mean: Number,           // 平均亮度（0-255）
    std: Number,            // 標準差（反映對比度）
    skewness: Number,       // 偏態（+正值=暗部居多，-負值=亮部居多）
    p5: Number,             // 第5百分位（陰影水準）
    p95: Number,            // 第95百分位（亮部水準）
    dynamicRange: Number,   // 動態範圍（p95 - p5）
    histogram: Float64Array // 256格正規化直方圖
  },

  saturation: {
    mean: Number,           // 平均飽和度（0-1）
    std: Number             // 飽和度標準差
  },

  colorTempBias: Number,    // 色溫偏向（-1=極冷藍/+1=極暖橘）
  tintBias: Number,         // 色偏（-1=偏洋紅/+1=偏綠）

  channels: {
    rMean, gMean, bMean,            // 各色頻平均值
    rHistogram, gHistogram, bHistogram  // 各色頻 256 格直方圖
  },

  dominantColors: [         // K-means 主要色彩（最多6色）
    { center: [R, G, B], count: Number }
  ],

  regions: [                // 3×3 區域分析（共9個區塊）
    { gx, gy, lumMean, satMean }
  ],

  regionSummary: {
    regionContrast: Number,  // 區域間最大亮度差
    darkest: Object,         // 最暗區塊資訊
    brightest: Object,       // 最亮區塊資訊
    centerEdgeDiff: Number,  // 中心與邊緣的亮度差（正值=中央明亮如人像）
    darkestPos: String,      // 最暗位置（如「左上」）
    brightestPos: String     // 最亮位置
  },

  colorHarmony: {
    type: String,            // 色彩和諧類型（英文）
    typeKey: String,         // 用於多語系查找的鍵值
    score: Number,           // 和諧分數（0-1）
    hues: Array              // 主要色相列表
    // 類型：neutral（中性）/ monochromatic（單色）/ analogous（類似色）
    //       complementary（互補色）/ splitComplementary（分裂互補）
    //       triadic（三角）/ tetradic（四角）/ diverse（多元）
  }
}
```

#### 色彩和諧分析邏輯

1. 以 25° 為閾值將色相聚類
2. 過濾條件：飽和度 > 0.08、在主要色彩中佔比 > 0.03
3. 依序測試 5 種和諧模式：
   - **類似色**：色相差 ≤ 60°
   - **互補色**：色相差接近 180°（±30°容忍）
   - **分裂互補**：色相差接近 150°（±20°容忍）
   - **三角色**：色相差接近 120°（±25°容忍）
   - **四角色**：色相差接近 90°（±25°容忍）

---

### 3.4 scene.js — 場景偵測器（Stage 1.5）

系統最具特色的模組，能識別 11 種藝術攝影場景類型，並為每種場景賦予 0-1 的信心分數。

#### 11 種場景類型

| 場景類型 | 鍵值 | 偵測特徵 |
|---------|------|----------|
| **低調（Low-Key）** | `lowKey` | 平均亮度 40-100、正偏態（暗部為主）、合理動態範圍 60-120、有深沉黑色 |
| **高調（High-Key）** | `highKey` | 平均亮度 160-220、負偏態（亮部為主）、P95 亮部達 230-250 |
| **去飽和（Desaturated）** | `desaturated` | 低飽和度均值與低標準差，主要色彩也呈低飽和 |
| **暖色調（Warm Tone）** | `warmTone` | 色溫偏向 > 0.03，主色相集中於 330°-60°（紅/橙/黃） |
| **冷色調（Cool Tone）** | `coolTone` | 色溫偏向 < -0.03，主色相集中於 180°-260°（青/藍） |
| **高對比（High Contrast）** | `highContrast` | 高標準差 60-90、寬廣動態範圍 180-230、雙峰直方圖 |
| **剪影（Silhouette）** | `silhouette` | 強烈雙峰分布、極端動態範圍 200-240、巨大區域對比 100-180 |
| **柔焦夢幻（Soft/Dreamy）** | `softDreamy` | 低標準差 30-60（反轉）、偏亮均值 140-190、窄動態範圍 80-150 |
| **霧感（Foggy/Hazy）** | `foggy` | 低標準差、**抬升陰影**（P5: 20-70，有別於曝光不足）、低飽和度、均勻區域 |
| **黃金時刻（Golden Hour）** | `goldenHour` | 強烈暖色偏向 0.06-0.18、豐富飽和度 0.25-0.5、主色相集中於暖色範圍 |
| **人像（Portrait）** | `portrait` | 存在膚色色相（10°-50°）、膚色飽和度 0.15-0.55、中央比邊緣亮（主燈效果）、中等對比 |

#### 輔助函式

```javascript
sigmoid(value, lo, hi)
// 平滑步進函式，將 [lo, hi] 範圍映射至 [0, 1]
// 用於所有場景信心分數的計算，避免硬性閾值

bimodality(histogram)
// 偵測直方圖中的雙峰分布
// 找出兩個峰值及其之間的谷深
// 用於高對比、剪影場景的偵測

dominantHueInRange(colors, hueLo, hueHi)
// 計算落在指定色相範圍內的主要色彩佔比
// 用於暖色調、冷色調、黃金時刻等場景的色相驗證
```

---

### 3.5 strategy.js — 策略路由器（Stage 2）

根據診斷結果與場景偵測輸出，決定應套用哪些調整及其強度。

#### 10 種調整類型

| 調整類型 | 鍵值 | 觸發條件示例 |
|---------|------|-------------|
| **亮度** | `brightness` | 偏態絕對值 > 閾值，影像整體過暗或過亮 |
| **對比增強** | `contrast` | 動態範圍 < 最小閾值，影像偏平 |
| **對比降低** | `contrastReduction` | 標準差 > 最大閾值，影像過度反差 |
| **清晰飽和** | `vibrance` | 平均飽和度 < vibrance 最小值 |
| **飽和度增強** | `saturation` | 平均飽和度 < 最小值 |
| **飽和度降低** | `desaturation` | 平均飽和度 > 最大值 |
| **白平衡** | `whiteBalance` | 色溫偏向絕對值 > 最大容忍值 |
| **色偏修正** | `tintCorrection` | 色偏絕對值 > 最大容忍值 |
| **陰影還原** | `shadowRecovery` | P5 < 陰影閾值（暗部細節遺失） |
| **亮部還原** | `highlightRecovery` | P95 > 亮部閾值（亮部細節遺失） |

#### 場景抑制係數表

當偵測到特定場景時，相關調整會被按比例抑制（係數越低 = 抑制越強）：

| 場景 | 受抑制的調整 | 抑制係數 |
|------|-------------|---------|
| 低調 | 亮度、陰影還原 | 0.9 / 0.85 |
| 高調 | 亮度、亮部還原 | 0.9 / 0.85 |
| 去飽和 | 飽和度、清晰飽和 | 0.95 / 0.90 |
| 暖色調 | 白平衡 | 0.80 |
| 冷色調 | 白平衡 | 0.80 |
| 高對比 | 對比增強、對比降低、各種還原 | 0.90 / 0.95 / 0.60 |
| **剪影** | 所有調整（最強抑制） | 0.50-0.95 |
| 柔焦夢幻 | 對比增強、亮部還原 | 0.85 / 0.80 |
| 霧感 | 對比增強、飽和度、清晰飽和 | 0.90 / 0.85 / 0.80 |
| 黃金時刻 | 白平衡、去飽和、色偏修正 | 0.95 / 0.80 / 0.60 |
| **人像** | 飽和度、清晰飽和、對比增強 | 0.70 / 0.50 / 0.60 |

#### 最終調整量計算公式

```
最終調整量 = 基礎調整量 × 場景抑制係數 × 全域強度（globalStrength）
```

#### defaultParams() 函式

Strategy 模組提供 `defaultParams()` 函式，回傳包含所有 32 個可調參數預設值的物件。

---

### 3.6 adjuster.js — 像素調整器（Stage 3）

管線最末端，負責對每個像素逐一套用 Strategy 模組輸出的調整列表。

#### 邊緣保護輪廓系統

每種調整都有一個獨立的保護輪廓（Protection Profile），控制三種特殊像素類型的保護強度：

| 調整類型 | 亮部保護 | 暗部保護 | 無彩色保護 |
|---------|---------|---------|----------|
| 亮度 | 1.0 | 1.0 | 0.3 |
| 對比增強 | 0.6 | 0.6 | 0.3 |
| 對比降低 | 0.5 | 0.5 | 0.3 |
| 飽和度增強 | 0.8 | 0.8 | 1.0 |
| 飽和度降低 | 0.2 | 0.2 | 0.0 |
| 白平衡 | 0.7 | 0.4 | 0.0 |
| 色偏修正 | 0.7 | 0.4 | 0.0 |
| 陰影還原 | 0.0 | 0.0 | 0.4 |
| 亮部還原 | 0.0 | 0.0 | 0.3 |
| 清晰飽和 | 0.7 | 0.7 | 0.4 |

#### 邊緣保護計算函式

```javascript
edgeProtection(r, g, b, profile) → 保護係數（0-1）
```

- **亮部保護**：亮度 > 0.8 時啟動，三次方衰減曲線
- **暗部保護**：亮度 < 0.1 時啟動，三次方衰減曲線
- **無彩色保護**：色度（Chroma）< 0.1 時啟動，二次方衰減曲線
- 最終係數 = `1 - max(亮部保護值, 暗部保護值, 無彩色保護值)`

#### 10 種調整函式細節

**1. applyBrightness（亮度）**
- 在 HSL 色彩空間操作
- 公式：`L += 方向 × 調整量 × 0.3 × 保護係數`

**2. applyContrast（對比增強）**
- 非線性 S 曲線：`curved = 0.5 + centered × factor / (1 + |centered × factor|)`
- 將色調從中點（0.5）向外延伸
- 係數：`factor = 1 + amount × 2`

**3. applyContrastReduction（對比降低）**
- 對比增強的逆操作：向中點壓縮
- 係數：`factor = 1 / (1 + amount × 1.5)`

**4. applySaturation（飽和度增強）**
- 在 HSL 空間：`S × (1 + amount × 1.5)`
- 無彩色像素受到完全保護（保護係數 = 1.0）

**5. applyDesaturation（飽和度降低）**
- 在 HSL 空間：`S × (1 / (1 + amount × 1.5))`

**6. applyWhiteBalance（白平衡）**
- 直接操作 R/B 色頻：`R += 方向 × amount × 30 × 保護係數`
- 正方向 = 增暖（加紅減藍），負方向 = 增冷（加藍減紅）

**7. applyTintCorrection（色偏修正）**
- 操作 G 色頻：`G += 方向 × amount × 20 × 保護係數`
- 正方向 = 修正洋紅偏色（加綠），負方向 = 修正綠色偏色（減綠）

**8. applyShadowRecovery（陰影還原）**
- 提亮暗部像素：`L += (提亮量 / 255) × t² × 保護係數`
- 其中 `t = 1 - (亮度值 / 閾值)`（越暗的像素提亮越多）
- 提亮量：`amount × 50`

**9. applyHighlightRecovery（亮部還原）**
- 壓暗亮部像素，邏輯與陰影還原對稱
- 壓暗量：`amount × 40`

**10. applyVibrance（清晰飽和）**
```
智慧飽和度提升，包含多層保護機制：
  a. 反向加權：低飽和度像素獲得更多提升
  b. 膚色保護：色相 10°-55°、飽和度 0.15-0.7 的像素被識別為膚色，減少提升
  c. 過飽和防護：飽和度 > 0.7 時自動降低增強力度
  d. 低色度淡入：色度 0.02-0.08 之間平滑過渡（避免雜訊放大）
最終強度 = 強度 × 飽和度權重 × 膚色係數 × 過飽和護罩 × 色度淡入 × 邊緣保護
```

---

### 3.7 lang.js — 多語系模組

提供完整的國際化（i18n）支援。

#### 支援語言

- **英文（en）**：191 個翻譯鍵值
- **繁體中文（zh-Hant / zh）**：191 個翻譯鍵值

#### 公開 API

```javascript
PicAnalysis.Lang.t(key, values?)     // 取得翻譯文字（支援變數插值）
PicAnalysis.Lang.getLang()           // 取得目前語言（"en" | "zh"）
PicAnalysis.Lang.setLang(lang)       // 設定語言
PicAnalysis.Lang.onChange(fn)        // 訂閱語言變更事件
```

#### 翻譯覆蓋範疇

- UI 標籤（標題、區段名稱、按鈕）
- 診斷指標名稱
- 參數控制標籤與工具提示（32 個參數）
- 場景偵測名稱與說明
- 調整類型名稱與觸發原因（含變數插值）
- 色彩和諧類型名稱
- 3×3 區域位置標籤（9 個位置，如「左上」、「中央」）

---

### 3.8 main.js — 應用程式協調器

負責串接所有模組、管理 UI 互動、以及協調整個處理流程。

#### 主要職責

| 功能 | 說明 |
|------|------|
| **影像載入** | 支援拖放（drag & drop）與點擊上傳，縮放至最大處理尺寸 |
| **管線執行** | 依序呼叫 Analyzer → Scene → Strategy → Adjuster |
| **直方圖渲染** | 分別為原始與調整後影像繪製亮度與 RGB 四格直方圖 |
| **診斷面板** | 顯示診斷結果（亮度、飽和度、色溫、色偏、動態範圍等）及進度條 |
| **場景標籤** | 顯示偵測到的場景及其信心分數（含視覺信心條） |
| **調整列表** | 列出所有套用的調整及原因說明 |
| **參數控制** | 32 個滑桿控制項，即時更新並重跑管線 |
| **預設系統** | 儲存/載入/重設 5 組命名預設值 |
| **語言切換** | 即時切換英文/繁體中文 |
| **下載** | 將調整後影像輸出為 PNG 檔案 |

---

## 4. 核心機制深度解析

### 4.1 影像分析機制

分析引擎對每個像素執行以下計算：

```
對每個像素（R, G, B）：
  1. 計算感知亮度：L = 0.299R + 0.587G + 0.114B
  2. 轉換至 HSL：取得 H（色相）、S（飽和度）
  3. 計算色溫偏向：(R - B) / (R + G + B + 1) × 正規化
  4. 計算色偏：(G - (R+B)/2) / (R+G+B+1) × 正規化
  5. 累計亮度、飽和度、各色頻的陣列

統計匯總：
  6. 計算亮度的 mean、std、skewness、p5、p95、dynamicRange
  7. 建立亮度與 RGB 各色頻的 256 格直方圖
  8. K-means 分群取得主要色彩（最多 6 色）

區域分析：
  9. 將影像分成 3×3 共 9 個區塊
  10. 各區塊分別計算 lumMean、satMean
  11. 比較各區塊差異，計算 centerEdgeDiff、regionContrast
```

### 4.2 場景感知機制

場景偵測的核心設計原則：**用平滑函式取代硬性閾值**。

```javascript
// 以低調（Low-Key）場景偵測為例
function detectLowKey(diag) {
  const meanScore = sigmoid(diag.luminance.mean, 100, 40);  // 越暗信心越高
  const skewScore = sigmoid(diag.luminance.skewness, 0.2, 1.0);  // 越右偏信心越高
  const rangeScore = sigmoid(diag.luminance.dynamicRange, 120, 60);  // 合理範圍
  const blackScore = sigmoid(255 - diag.luminance.p5, 200, 240);  // 有深黑色

  confidence = meanScore × 0.35 + skewScore × 0.30 + rangeScore × 0.20 + blackScore × 0.15;
}
```

場景偵測結果直接影響 Stage 2 的策略路由，讓系統「尊重」攝影師的創作意圖。

### 4.3 策略決策機制

Strategy 模組為每種調整類型設計了獨立的決策邏輯。以**白平衡修正**為例：

```
1. 讀取診斷值：colorTempBias = +0.12（偏暖）
2. 判斷是否超過閾值（whiteBalanceMaxBias = 0.05）：0.12 > 0.05 → 是
3. 計算基礎調整量：(0.12 - 0.05) / 0.15 × 1.0 × whiteBalanceStrength
4. 讀取場景抑制係數（假設偵測到 goldenHour 信心 0.8）：
   乘數 = 1 - (0.8 × (1 - 0.95)) = 0.96
5. 乘上 globalStrength（全域強度）
6. 最終調整量 = 基礎量 × 0.96 × globalStrength
7. 附上原因說明：「色溫偏暖 (+12%)，建議修正」
```

### 4.4 邊緣保護機制

邊緣保護的設計目的是避免調整在極端亮度或無彩色像素上造成偽影：

```
以「飽和度增強」為例，遇到一個純白像素（R=255, G=255, B=255）：
  - 亮度計算：L = 1.0（極亮）
  - 亮部保護啟動：highProt = (L - 0.8) / 0.2 = 1.0（完全保護）
  - 無彩色保護：chroma ≈ 0，achromProt = 1.0（完全保護）
  - 最終係數 = 1 - max(1.0, 1.0) = 0

=> 此像素的飽和度增強 = 0，完全被保護
```

### 4.5 像素調整機制

所有調整均在**像素層級**逐一處理，確保精確控制：

```
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i+1], b = data[i+2];

  // 計算此像素的保護係數
  const protection = edgeProtection(r, g, b, profile);

  // 在 HSL 空間套用調整
  const [h, s, l] = rgbToHsl(r, g, b);
  const newL = l + direction × amount × 0.3 × protection;
  const [nr, ng, nb] = hslToRgb(h, s, clamp(newL, 0, 1));

  data[i] = nr; data[i+1] = ng; data[i+2] = nb;
}
```

---

## 5. 資料處理流程

### 完整執行序列

```
使用者操作（上傳 / 拖放）
  │
  ▼
loadImage()
  ├── 建立 Image 物件並載入檔案
  ├── 縮放至最大 2048px（保持長寬比）
  └── 繪製至 Canvas → 取得 ImageData

runPipeline()
  ├── STAGE 1：PicAnalysis.Analyzer.analyze(imageData)
  │   耗時：~50-200ms（依解析度）
  │   輸出：Diagnosis 物件
  │
  ├── STAGE 1.5：PicAnalysis.Scene.detect(diagnosis)
  │   耗時：<5ms
  │   輸出：Scene[] 陣列（11個場景各自的信心分數）
  │
  ├── STAGE 2：PicAnalysis.Strategy.route(diagnosis, params, scenes)
  │   耗時：<1ms
  │   輸出：Adjustment[] 陣列（0-10個調整項目）
  │
  └── STAGE 3：PicAnalysis.Adjuster.adjust(imageData, adjustments)
      耗時：~50-300ms（依解析度與調整數量）
      輸出：調整後的 ImageData

renderResults()
  ├── 繪製原始影像至左側 Canvas
  ├── 繪製調整後影像至右側 Canvas
  ├── 使用 requestAnimationFrame 繪製直方圖（4格：亮度/R/G/B）
  ├── 更新診斷面板（診斷數值 + 進度條）
  ├── 顯示場景標籤（含信心條）
  ├── 更新區域分析 mini-grid（3×3，依亮度深淺著色）
  ├── 列出調整項目（類型 + 強度 + 原因說明）
  └── 啟用下載按鈕
```

### 參數變更觸發流程

使用者調整任何滑桿時，系統會**跳過** Stage 1（診斷）直接從 Stage 2（策略）重新執行：

```
使用者調整滑桿
  │
  ▼
updateParams()
  ├── 更新參數物件
  └── 呼叫 rerouteAndAdjust()
        ├── STAGE 2：Strategy.route（用快取的 Diagnosis）
        └── STAGE 3：Adjuster.adjust
              └── renderResults()
```

---

## 6. API 介面參考

### PicAnalysis.Analyzer

```javascript
// 分析影像，回傳完整診斷物件
const diagnosis = PicAnalysis.Analyzer.analyze(imageData: ImageData): Diagnosis
```

### PicAnalysis.Scene

```javascript
// 偵測場景類型
const scenes = PicAnalysis.Scene.detect(diagnosis: Diagnosis): Scene[]
// Scene = { type: string, confidence: number, active: boolean }
```

### PicAnalysis.Strategy

```javascript
// 路由調整策略
const adjustments = PicAnalysis.Strategy.route(
  diagnosis: Diagnosis,
  params: ParamObject,
  scenes: Scene[]
): Adjustment[]
// Adjustment = { type: string, amount: number, direction: number, reason: string }

// 取得預設參數
const params = PicAnalysis.Strategy.defaultParams(): ParamObject
```

### PicAnalysis.Adjuster

```javascript
// 套用調整至影像
const adjustedImageData = PicAnalysis.Adjuster.adjust(
  sourceImageData: ImageData,
  adjustments: Adjustment[]
): ImageData
```

### PicAnalysis.Lang

```javascript
// 取得翻譯文字（支援 {{variable}} 插值語法）
const text = PicAnalysis.Lang.t(key: string, values?: object): string

// 語言管理
PicAnalysis.Lang.getLang(): "en" | "zh"
PicAnalysis.Lang.setLang(lang: "en" | "zh"): void
PicAnalysis.Lang.onChange(fn: (lang: string) => void): void
```

---

## 7. 參數系統說明

Strategy 模組支援 **32 個可調參數**，分為三大類別：

### 策略閾值（11 個）

| 參數名稱 | 預設值 | 說明 |
|---------|--------|------|
| `sceneAwareness` | 0.8 | 場景感知強度（0=無視場景，1=完全尊重） |
| `brightnessSkewThreshold` | 0.4 | 觸發亮度調整的偏態閾值 |
| `contrastMinDynamicRange` | 100 | 對比增強的最低動態範圍觸發值 |
| `contrastMaxStd` | 80 | 對比降低的最高標準差觸發值 |
| `vibranceMinMean` | 0.35 | 觸發清晰飽和的最低飽和度均值 |
| `saturationMinMean` | 0.2 | 觸發飽和度增強的最低均值 |
| `saturationMaxMean` | 0.65 | 觸發飽和度降低的最高均值 |
| `whiteBalanceMaxBias` | 0.05 | 觸發白平衡修正的最大色溫偏向 |
| `tintMaxBias` | 0.04 | 觸發色偏修正的最大色偏值 |
| `shadowP5Threshold` | 30 | 觸發陰影還原的 P5 閾值 |
| `highlightP95Threshold` | 230 | 觸發亮部還原的 P95 閾值 |

### 目標值（3 個）

| 參數名稱 | 預設值 | 說明 |
|---------|--------|------|
| `brightnessTarget` | 128 | 亮度調整的目標均值（0-255） |
| `contrastTarget` | 150 | 對比調整的目標動態範圍 |
| `saturationTarget` | 0.45 | 飽和度調整的目標均值 |

### 調整強度（12 個）

| 參數名稱 | 預設值 | 說明 |
|---------|--------|------|
| `globalStrength` | 1.0 | 全域強度乘數（影響所有調整） |
| `brightnessStrength` | 0.8 | 亮度調整最大強度 |
| `contrastStrength` | 0.7 | 對比增強最大強度 |
| `contrastReductionStrength` | 0.6 | 對比降低最大強度 |
| `vibranceStrength` | 0.8 | 清晰飽和最大強度 |
| `saturationStrength` | 0.7 | 飽和度增強最大強度 |
| `desaturationStrength` | 0.6 | 飽和度降低最大強度 |
| `whiteBalanceStrength` | 0.7 | 白平衡修正最大強度 |
| `tintStrength` | 0.6 | 色偏修正最大強度 |
| `shadowStrength` | 0.8 | 陰影還原最大強度 |
| `highlightStrength` | 0.7 | 亮部還原最大強度 |

> **注意**：參數系統仍有部分欄位（如各場景的 `suppressionFactor`）保留擴充彈性。

---

## 8. 預設值系統

系統提供 **5 個命名預設槽位**，透過 `localStorage` 持久保存：

```javascript
// 儲存格式（localStorage key: "picanalysis_presets"）
[
  { name: "我的預設 1", params: { ...所有32個參數 } },
  null,    // 空槽位
  { name: "人像設定", params: { ... } },
  null,
  null
]
```

#### 操作流程

1. 點擊任意槽位的「儲存」按鈕 → 輸入名稱 → 目前參數寫入 localStorage
2. 點擊已儲存槽位的「載入」按鈕 → 讀取參數 → 觸發管線重跑
3. 點擊「重設」按鈕 → 回復所有參數至 `defaultParams()` 的預設值
4. 槽位顯示：已儲存（顯示名稱）vs 空槽位（顯示「空」）

---

## 9. 使用方式

### 基本操作

1. **上傳影像**：將圖片拖放至上傳區，或點擊區域選擇檔案
2. **查看分析結果**：系統自動執行四階段管線，左側顯示原始影像，右側顯示調整後影像
3. **查看診斷資訊**：頁面下方顯示完整的診斷面板，包含亮度、飽和度、色溫、色彩和諧等
4. **查看場景偵測**：場景標籤區顯示偵測到的藝術風格及信心分數
5. **調整參數**：使用三欄滑桿區域調整各項策略參數，系統即時重新運算
6. **儲存預設**：將滿意的參數組合儲存至 5 個預設槽位之一
7. **下載結果**：點擊下載按鈕將調整後影像儲存為 PNG 格式

### 語言切換

點擊頁面右上角的語言切換按鈕（EN / 中文）即可即時切換界面語言，所有文字元素均會同步更新。

### 進階使用（開發者）

可直接呼叫各模組 API 進行程式化操作：

```javascript
// 取得畫布像素資料
const canvas = document.getElementById('myCanvas');
const ctx = canvas.getContext('2d');
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

// 執行完整管線
const diagnosis = PicAnalysis.Analyzer.analyze(imageData);
const scenes = PicAnalysis.Scene.detect(diagnosis);
const params = PicAnalysis.Strategy.defaultParams();
const adjustments = PicAnalysis.Strategy.route(diagnosis, params, scenes);
const result = PicAnalysis.Adjuster.adjust(imageData, adjustments);

// 將結果繪製回畫布
ctx.putImageData(result, 0, 0);
```

---

## 10. 安裝與啟動

### 系統需求

- 現代瀏覽器（支援 HTML5 Canvas API 與 File API）
- 建議：Chrome 90+、Firefox 88+、Safari 14+、Edge 90+
- 開發伺服器：Python 3.x（或任何靜態檔案伺服器）

### 本地開發啟動

```bash
# 克隆或下載專案
git clone <repository-url>
cd pic-analysis

# 使用 Python 內建 HTTP 伺服器（推薦）
python3 -m http.server 3000

# 開啟瀏覽器
open http://localhost:3000
```

### 使用其他伺服器

```bash
# Node.js（npx serve）
npx serve . -p 3000

# Node.js（http-server）
npx http-server . -p 3000

# PHP
php -S localhost:3000
```

### 生產部署

由於本專案是純靜態網站，可直接部署至任何靜態託管平台：

```bash
# 直接上傳以下檔案至 CDN 或靜態託管服務
/
├── index.html
├── css/
│   └── style.css
└── js/
    ├── color.js
    ├── stats.js
    ├── lang.js
    ├── analyzer.js
    ├── scene.js
    ├── strategy.js
    ├── adjuster.js
    └── main.js
```

**相容平台**：GitHub Pages、Netlify、Vercel、Cloudflare Pages、AWS S3 靜態託管等。

### 專案檔案說明

```
pic-analysis/
├── index.html              # 主入口，繁體中文（zh-Hant）
├── css/
│   └── style.css           # 單色灰階暗色主題樣式表
├── js/
│   ├── color.js            # 色彩空間轉換（RGB/HSL/LAB）
│   ├── stats.js            # 統計工具（mean/std/skewness/k-means）
│   ├── lang.js             # 多語系（EN/繁中，共 191 鍵）
│   ├── analyzer.js         # Stage 1：影像診斷引擎
│   ├── scene.js            # Stage 1.5：11 種場景偵測器
│   ├── strategy.js         # Stage 2：策略路由，32 個可調參數
│   ├── adjuster.js         # Stage 3：10 種像素級調整函式
│   └── main.js             # 應用程式協調，UI 綁定
├── .claude/
│   ├── launch.json         # 開發伺服器設定（port 3000）
│   └── settings.local.json # 本地設定
└── test.png                # 測試用範例影像
```

---

## 11. 技術棧說明

### 程式語言與執行環境

| 技術 | 說明 |
|------|------|
| **JavaScript（ES5 相容）** | 核心邏輯，無 class 語法，確保最廣泛相容性 |
| **HTML5** | 結構標記，語言設定為 `zh-Hant` |
| **CSS3** | 響應式樣式，媒體查詢（900px 斷點）|

### 瀏覽器 API

| API | 用途 |
|-----|------|
| **HTML5 Canvas API** | 影像讀取（`getImageData`）、渲染（`putImageData`）、直方圖繪製 |
| **File API** | 檔案上傳處理、讀取原始二進位資料 |
| **Drag and Drop API** | 拖放上傳支援 |
| **localStorage API** | 預設值持久保存（5 個參數槽位） |
| **requestAnimationFrame** | 流暢的直方圖動畫渲染 |

### 色彩科學標準

| 標準 | 實作 |
|------|------|
| **ITU-R BT.601** | 感知亮度計算（`0.299R + 0.587G + 0.114B`） |
| **CIE D65** | LAB 色彩空間的參考光源 |
| **CIE LAB (L\*a\*b\*)** | 感知均勻色彩空間，用於精確色彩計算 |
| **HSL** | 直觀的色相/飽和度/亮度空間，用於大部分調整操作 |

### 演算法

| 演算法 | 用途 | 複雜度 |
|--------|------|--------|
| **K-means 分群** | 提取最多 6 種主要色彩 | O(k × n × iter)，n ≤ 2000 |
| **直方圖分析** | 亮度與色頻分布、雙峰偵測 | O(n) |
| **三階矩（偏態）** | 診斷影像整體明暗傾向 | O(n) |
| **Sigmoid 函式** | 場景信心分數平滑計算 | O(1) per pixel |
| **三次/二次曲線** | 邊緣保護平滑衰減 | O(1) per pixel |
| **S 曲線（反正切型）** | 對比增強/降低 | O(1) per pixel |

### UI 設計

| 特性 | 實作 |
|------|------|
| **暗色主題** | 主背景 `#111`，文字 `#ccc`，強調 `#999` |
| **等寬字型** | SF Mono、Fira Code、Consolas（fallback 鏈） |
| **響應式佈局** | 雙欄佈局在 900px 以下自動折疊為單欄 |
| **直方圖** | 4 格配置（亮度 / R / G / B），Canvas 繪製 |
| **區域 mini-grid** | 3×3 CSS Grid，依亮度動態著色 |

### 效能考量

| 最佳化項目 | 實作方式 |
|-----------|---------|
| **影像縮放** | 上傳後自動縮放至最大 2048px |
| **K-means 取樣** | 隨機抽取最多 2000 個像素點進行分群 |
| **診斷快取** | 參數調整時跳過 Stage 1，直接從 Stage 2 重算 |
| **非同步渲染** | 直方圖使用 `requestAnimationFrame` 避免阻塞 |

---

## 12. 設計理念

### 核心原則

**1. 場景感知優先（Scene Awareness First）**

系統不是盲目的「讓影像更好看」工具。在套用任何修正之前，它會先問：「這張照片是故意這樣拍的嗎？」低調攝影（Low-Key）天生就該是暗的，剪影就該有強烈反差，霧感攝影就該有抬升的陰影——系統識別這些意圖並予以尊重。

**2. 邊緣保護（Edge Protection）**

每種調整都設計了獨立的保護輪廓，防止在像素值極端或無彩色區域產生偽影。這是專業影像處理軟體的標準做法，確保調整的品質。

**3. 雙向調整（Bidirectional Adjustments）**

系統可以增強也可以抑制影像特性。若影像過暗會提亮，若影像過亮會壓暗；若飽和度不足會增強，若飽和度過高會降低。這讓系統能應對各種起始狀態的影像。

**4. 統計嚴謹性（Statistical Rigor）**

使用正式的統計指標（偏態、動態範圍、雙峰性）而非直覺化的簡單閾值，確保分析的客觀性和可重複性。所有閾值轉換使用 sigmoid 函式，避免硬性邊界帶來的不自然效果。

**5. 感知準確性（Perceptual Accuracy）**

採用 ITU-R 標準亮度公式和 CIE LAB 色彩空間，確保所有計算符合人眼的感知特性，而非僅在數學意義上正確。

**6. 完全本地化（Fully Local）**

所有影像處理在用戶端完成，影像資料永遠不會離開用戶的裝置，確保隱私安全。

---

*本系統的哲學：最好的影像增強工具，是那個知道什麼時候不該動手的工具。*
