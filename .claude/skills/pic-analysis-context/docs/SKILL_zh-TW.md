---
name: pic-analysis-context
description: PicAnalysis 影像處理專案的修改前情境載入器。在對 pic-analysis 專案進行任何程式碼規劃或實作之前，應先使用此 skill。它會將修改需求對應至受影響的管線階段與模組，讀取相關原始碼，並產出結構化情境摘要以支援後續規劃。觸發時機：任何針對 pic-analysis 的修改、新增、除錯或重構請求（涵蓋 analyzer、場景偵測、strategy、adjuster、color、stats、lang、main、UI、參數、預設值、直方圖、i18n、管線）。
---

# PicAnalysis 修改前情境載入器

## 角色定義
在任何程式碼變更之前，載入架構知識與相關原始檔案，然後輸出結構化情境摘要，作為後續規劃步驟的基礎。

## 核心指令
- 永遠先讀取 `references/architecture.md`——它包含完整的模組對應表、資料結構定義，以及 10 項設計約束。
- 絕不跳過讀取受影響模組的實際原始碼；參考文件僅摘要結構，真正的程式碼才能揭示確切的實作細節。
- 若需求涉及多個關注點，須讀取**所有**相關模組（路由規則請見 `references/module-routing.md`）。

## 知識中樞

| 參考文件 | 何時讀取 |
|---------|---------|
| `references/architecture.md` | **每次**呼叫皆必讀 |
| `references/module-routing.md` | 根據需求關鍵字確認應讀取哪些 `js/*.js` 檔案時 |

## 認知循環

1. **讀取** `references/architecture.md`。
2. **讀取** `references/module-routing.md` → 從需求關鍵字中識別受影響模組。
3. **讀取**每個識別到的原始碼檔案，路徑：`/Users/kouzuimac/Documents/claude_code/pic-analysis/js/`。
4. **輸出**修改前情境摘要（格式見下方輸出規格）。

## 輸出規格

以與使用者請求相同的語言，產出**修改前情境摘要**：

```
## 修改前情境摘要

### 需求理解
<一句話重述修改目標>

### 受影響模組
- 第 X 階段 — <module.js>：<受影響原因>

### 關鍵現有邏輯
<從原始碼中提取的相關函式名稱、資料結構、閾值或演算法>

### 設計約束提醒
<architecture.md 中 10 項約束裡的適用項目>

### 建議修改範圍
<需異動的檔案、需新增或修改的函式、需新增的 lang key、參數新增等>
```
