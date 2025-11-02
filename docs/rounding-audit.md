# Rounding & Formatting Audit

This audit inventories every occurrence of `toFixed`, `toLocaleString`, `Intl.NumberFormat`, `Math.round`, `Math.floor`, and `Math.ceil` in the repository. Each entry lists where the call appears, shows the surrounding snippet, states whether it is display-only or part of a calculation path, and notes the effective cadence (monthly vs. annual vs. ad-hoc).

## `toFixed(...)`

| File | Line(s) | Snippet | Purpose | Frequency |
| --- | --- | --- | --- | --- |
| `ner-calculator/js/app.js` | 21 | `(n * 100).toFixed(1)` | UI percentage formatter (display-only). | Render-time, ad-hoc. |
| `ner-calculator/js/app.js` | 107 | `v.toFixed(2)` | UI PSF string formatter (display-only). | Render-time, per usage. |
| `ner-calculator/js/app.js` | 229 | `lat.toFixed(6)` / `lon.toFixed(6)` | Formats map coordinates for display/logging. | Geocode fallback (ad-hoc). |
| `ner-calculator/js/app.js` | 356–357 | `pct.toFixed(1)` / `dr.toFixed(1)` | Descriptive abatement strings (display-only). | UI label assembly (ad-hoc). |
| `ner-calculator/js/app.js` | 667 | `(prefill.growth * 100).toFixed(2)` | Pre-populates input text; display-only. | Input binding (ad-hoc). |
| `ner-calculator/js/app.js` | 2437 | `delta.toFixed(2)` | Dev-only rounding delta log (display). | Annual rounding check. |
| `ner-calculator/js/app.js` | 2610 | `(pctAbated * 100).toFixed(1)` | KPI display text. | KPI render (term-based). |
| `ner-calculator/js/app.js` | 2617 | `(recoveryRatio * 100).toFixed(1)` | KPI display text. | KPI render (term-based). |
| `ner-calculator/js/app.js` | 2625 | `occPSFmo.toFixed(2)` | KPI display text. | KPI render (term-based). |
| `ner-calculator/js/charts.js` | 531 | `p.e.toFixed(2)` | Rounds chart data points for display. | Chart render (scenario comparisons). |
| `ner-calculator/js/charts.js` | 540 | `c.parsed.x.toFixed(2)` | Tooltip formatting (display). | Chart hover (ad-hoc). |
| `ner-calculator/js/scenarios.js` | 198 | `Number(v).toFixed(2)` | Scenario card currency string (display). | Scenario render (ad-hoc). |
| `ner-calculator/js/scenarios.js` | 202 | `Number(v).toFixed(1)` | Scenario percentage string (display). | Scenario render (ad-hoc). |
| `ner-calculator/js/exports/export-excel.js` | 101 | `aprPct.toFixed(2)` | Narrative text in export. | Export-time (ad-hoc). |
| `ner-calculator/js/exports/export-excel.js` | 282 | `aprPct.toFixed(2)` | Narrative text in export. | Export-time (ad-hoc). |

## `toLocaleString(...)`

| File | Line(s) | Snippet | Purpose | Frequency |
| --- | --- | --- | --- | --- |
| `ner-calculator/js/app.js` | 15 | `(n ?? 0).toLocaleString('en-US', { style: 'currency', ... })` | Fallback USD formatter (display). | Any currency render. |
| `ner-calculator/js/app.js` | 19 | `n.toLocaleString(undefined, { style: 'currency', ... })` | USD currency display helper. | UI render across views. |
| `ner-calculator/js/app.js` | 20 | `n.toLocaleString(undefined, { style: 'currency', maximumFractionDigits: 0 })` | Whole-dollar display helper. | UI render across views. |
| `ner-calculator/js/app.js` | 367 | `Math.round(n).toLocaleString()` | Formats integer input values. | Input formatting (ad-hoc). |
| `ner-calculator/js/app.js` | 368 | `n.toLocaleString(undefined, { minimumFractionDigits: 2, ... })` | Formats money input values. | Input formatting (ad-hoc). |
| `ner-calculator/js/app.js` | 369 | `n.toLocaleString(undefined, { maximumFractionDigits: 2 })` | Formats percentage inputs. | Input formatting (ad-hoc). |
| `ner-calculator/js/app.js` | 515 | `(Number.isFinite(+n) ? +n : 0).toLocaleString(undefined, {...})` | Number formatter for UI (display). | Form feedback. |
| `ner-calculator/js/app.js` | 518 | `(Number.isFinite(+n) ? +n : 0).toLocaleString()` | General number formatting. | Utility usage (ad-hoc). |
| `ner-calculator/js/app.js` | 796 | `n.toLocaleString(undefined, { style: 'currency', ... })` | Formats totals in UI. | Monthly/annual table render. |
| `ner-calculator/js/app.js` | 2312 | `rowDate.toLocaleString(undefined, { month: 'short' })` | Month label for schedule rows. | Monthly schedule loop. |
| `ner-calculator/js/app.js` | 2723 | `date.toLocaleString(undefined, { month: 'short', year: 'numeric' })` | Lease date display. | Lease summary. |
| `ner-calculator/js/app.js` | 2727 | `startDate.toLocaleString(undefined, {...})` | Lease start label. | Lease summary. |
| `ner-calculator/js/app.js` | 2731 | `endFallback.toLocaleString(undefined, {...})` | Lease end fallback label. | Lease summary. |
| `ner-calculator/js/app.js` | 3224 | `(Number(r.spaceSize || 0)).toLocaleString()` | Table column renderer. | Monthly table render. |
| `ner-calculator/js/app.js` | 3259 | `(Number(r.spaceSize || 0)).toLocaleString()` | Table column renderer (landlord view). | Monthly table render. |
| `ner-calculator/js/app.js` | 3503 | `(Number(aggRow.spaceSize || 0)).toLocaleString()` | Annual subtotal display. | Annual summary rows. |
| `ner-calculator/js/charts.js` | 23 | `n.toLocaleString(undefined, { style: 'currency', ... })` | Chart currency formatter. | Chart render. |
| `ner-calculator/js/exports/export-pdf.js` | 22 | `Number(v||0).toLocaleString(undefined,{...})` | PDF numeric formatting. | Export-time. |
| `ner-calculator/js/exports/export-pdf.js` | 411 | `d.toLocaleString(undefined,{ month:'short', year:'numeric'})` | PDF date formatting. | Export-time. |
| `ner-calculator/js/exports/export-pdf.js` | 520 | `now.toLocaleString()` | Timestamp in PDF metadata. | Export-time. |
| `ner-calculator/js/scenarios.js` | 91 | `n.toLocaleString(undefined, { style: 'currency', ... })` | Scenario summary currency. | Scenario render. |
| `ner-calculator/js/scenarios.js` | 95 | `Math.abs(n).toLocaleString(undefined, {...})` | Scenario delta formatting. | Scenario render. |
| `ner-calculator/js/scenarios.js` | 102 | `new Date(...).toLocaleString(undefined,{ month:'short', year:'numeric' })` | Scenario date label. | Scenario render. |
| `ner-calculator/js/scenarios.js` | 193 | `Math.abs(num).toLocaleString(undefined, { maximumFractionDigits: 0 })` | Scenario magnitude string. | Scenario render. |
| `ner-calculator/js/scenarios.js` | 252 | `date.toLocaleString(undefined, { month: 'short', year: 'numeric' })` | Timeline label. | Scenario render. |

## `Intl.NumberFormat`

| File | Line(s) | Snippet | Purpose | Frequency |
| --- | --- | --- | --- | --- |
| `ner-calculator/js/exports/export-pdf.js` | 21 | `new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(+v||0)` | PDF currency formatter (display-only). | Export-time. |

## `Math.round(...)`

| File | Line(s) | Snippet | Purpose | Frequency |
| --- | --- | --- | --- | --- |
| `ner-calculator/js/engine/rounding.js` | 1–2 | `Math.round((Number(n) + Number.EPSILON) * 100)` / `* 10000` | Core rounding helpers (calculation path). | Monthly schedule stage. |
| `ner-calculator/js/app.js` | 26,29 | `Math.round((Number(value) + Number.EPSILON) * 100)` etc. | Calculation fallback if helper missing. | Monthly schedule stage. |
| `ner-calculator/js/app.js` | 367 | `Math.round(n).toLocaleString()` | Input sanitization (display). | Ad-hoc input formatting. |
| `ner-calculator/js/app.js` | 1387–1388 | `Math.round(img.naturalWidth * scale)` | Image resizing math (calculation). | Per image upload. |
| `ner-calculator/js/scenarios.js` | 154 | `Math.round((pct ?? .5)*100)` | Scenario label (display). | Scenario render. |
| `ner-calculator/js/scenarios.js` | 206 | `Math.round(v)` | Scenario label (display). | Scenario render. |
| `ner-calculator/js/scenarios.js` | 1514 | `Math.round(value * dpr) / dpr` | Canvas snap for charts (calculation). | Chart render. |

## `Math.floor(...)`

| File | Line(s) | Snippet | Purpose | Frequency |
| --- | --- | --- | --- | --- |
| `ner-calculator/js/app.js` | 2042 | `Math.floor((m - 1) / 12)` | Determines annual escalation index (calculation). | Monthly schedule loop. |
| `ner-calculator/js/exports/export-excel.js` | 199 | `Math.floor(Number.isFinite(n) ? n : 4)` | Layout row clamp (calculation). | Export-time. |
| `ner-calculator/js/scenarios.js` | 1474 | `Math.floor((usableWidth - labelWidth) / 3)` | Scenario layout geometry (calculation). | Scenario render. |

## `Math.ceil(...)`

| File | Line(s) | Snippet | Purpose | Frequency |
| --- | --- | --- | --- | --- |
| `ner-calculator/js/exports/export-excel.js` | 232 | `Math.ceil(imgHeight / rowH)` | Excel image layout (calculation). | Export-time. |

