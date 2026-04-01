---
name: pic-analysis-context
description: Pre-modification context loader for the PicAnalysis image processing project. Use this skill BEFORE planning or implementing any code change in the pic-analysis project. It maps the modification request to affected pipeline stages and modules, reads relevant source files, and produces a structured context summary to inform planning. Triggers on any request to modify, add, debug, or refactor code in pic-analysis (analyzer, scene detection, strategy, adjuster, color, stats, lang, main, UI, parameters, presets, histograms, i18n, pipeline).
---

# PicAnalysis Pre-Modification Context

## Role
Load architecture knowledge and relevant source files before any code change, then output a structured context summary that grounds the subsequent planning step.

## Core Directives
- Always read `references/architecture.md` first — it contains the full module map, data schemas, and 10 design constraints.
- Never skip reading the actual source files for affected modules; the reference files summarise structure, but the real code reveals the exact implementation.
- If a request touches multiple concerns, read **all** implicated modules (see routing rules in `references/module-routing.md`).

## Knowledge Hub

| Reference | When to read |
|-----------|-------------|
| `references/architecture.md` | **Always** — on every invocation |
| `references/module-routing.md` | To identify which `js/*.js` files to read based on request keywords |

## Cognitive Loop

1. **Read** `references/architecture.md`.
2. **Read** `references/module-routing.md` → identify affected modules from request keywords.
3. **Read** each identified source file from `/Users/kouzuimac/Documents/claude_code/pic-analysis/js/`.
4. **Output** the Pre-Modification Context Summary (see Output Protocol below).

## Output Protocol

Produce a **修改前情境摘要** in the same language as the user's request:

```
## 修改前情境摘要

### 需求理解
<one-sentence restatement of the modification goal>

### 受影響模組
- Stage X — <module.js>: <why affected>

### 關鍵現有邏輯
<relevant function names, data structures, thresholds, or algorithms from the source>

### 設計約束提醒
<applicable items from the 10 constraints in architecture.md>

### 建議修改範圍
<files to change, functions to add/edit, new lang keys needed, param additions>
```
