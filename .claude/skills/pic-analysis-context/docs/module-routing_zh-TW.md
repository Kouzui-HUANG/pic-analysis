# 模組路由對應表

根據修改需求中的關鍵字，對應至需要讀取的原始碼檔案。

| 需求中的關鍵字 | 需讀取的檔案 |
|--------------|------------|
| luminance、histogram、saturation、color temp、tint、dominant color、region、color harmony、diagnosis | `js/analyzer.js` |
| scene、low-key、high-key、portrait、golden hour、silhouette、foggy、soft dreamy、warm tone、cool tone、desaturated、bimodal、confidence score | `js/scene.js` |
| adjustment、threshold、strength、suppression、route、strategy、trigger condition、scene multiplier、param | `js/strategy.js` |
| pixel、brightness、contrast、vibrance、white balance、shadow recovery、highlight recovery、edge protection、protection profile | `js/adjuster.js` |
| RGB、HSL、LAB、luminance formula、color conversion、clamp | `js/color.js` |
| mean、std、standard deviation、skewness、percentile、k-means、kMeans、histogram bins | `js/stats.js` |
| translation、i18n、language、Chinese、English、lang key、t()、locale | `js/lang.js` |
| UI、upload、drag、canvas、download、preset、slider、histogram render、pipeline trigger、DOM、localStorage | `js/main.js` |

## 多模組路由規則

當需求涉及多個關注點時，需讀取**所有**相關模組：

| 需求類型 | 需讀取的模組 |
|---------|------------|
| 新增場景類型 | `scene.js` + `strategy.js` + `lang.js` |
| 新增調整類型 | `strategy.js` + `adjuster.js` + `lang.js` |
| 新增 UI 參數/滑桿 | `strategy.js` + `main.js` + `lang.js` |
| 變更管線流程 | `main.js` + 受影響的階段模組 |
| 新增 lang 鍵值 | 僅 `lang.js`（需同時更新 EN 和 zh 兩個物件） |
| 變更色彩計算 | `color.js` + `analyzer.js` |
| 變更統計方法 | `stats.js` + `analyzer.js` |

## 原始碼根目錄
`/Users/kouzuimac/Documents/claude_code/pic-analysis/js/`
