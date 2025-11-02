# Rounding Policy

The lease calculator now maintains full-precision math through intermediate calculations and applies rounding only when a monthly cash-flow line item is committed to the schedule. The policy ensures that:

- All intermediate math (rent escalation, recoveries, fees, TI amortization, etc.) is computed in floating point with full precision.
- At the point a monthly schedule row is finalized, every currency amount is rounded to the nearest cent via `round2(...)` and every $/SF metric is rounded to four decimals via `round4(...)`.
- Annual totals are the sum of these rounded monthly values—no alternate recomputation bypasses the rounded months.
- Present value (PV) calculations discount the rounded monthly cashflows.

The helpers live in `ner-calculator/js/engine/rounding.js` and are exposed both as ES module exports and on `window.rounding` for legacy scripts:

```js
round2(n);          // => cents rounding
round4(n);          // => $/SF precision
finalizeMonthlyCurrency(map); // normalizes & rounds currency fields in one pass
sumRounded(values);          // adds rounded months without penny drift
pvFromRounded(cashflows, r); // discounts rounded cashflows
```

## Implementation Highlights

- `ner-calculator/js/app.js` computes all monthly values using full precision and then calls `finalizeMonthlyCurrency(...)` before pushing a row into the schedule. The same rounded numbers feed totals, PV, KPIs, charts, scenarios, and exports.
- Custom OpEx items, management fees, and landlord OpEx shares are rounded per item, then aggregated.
- Annual contract PSF values are derived from rounded monthly PSF and stored with four-decimal precision.
- Rounding adjustments are captured per calendar year (`model.roundingAdjustments`). When the sum of rounded months differs from the raw annual recomputation by ≥ $0.01, a dev warning is emitted (`[RoundingGuard]`) so penny drift is visible during development.

## Examples

| Component | Calculation Stage | Rounding Applied |
| --- | --- | --- |
| Base rent | Escalation math uses full precision. When the monthly payment is added to the schedule, `round2` is applied. | Monthly cents. |
| OpEx recoveries | Stops & growth computed in full precision. Tenant and landlord monthly dollars are rounded before storage; annual PSF summaries use `round4`. | Monthly cents / annual $/SF(4). |
| Management fee | Fee basis (gross vs. net) calculated in full precision. The resulting tenant/landlord dollars are rounded per month and feed totals & PV. | Monthly cents. |
| TI amortization | Payment amount derived from precise annuity math. If amortized, the monthly inflow is rounded before inclusion in cashflows. | Monthly cents. |
| Commission (future) | Keep full precision for the basis and percent; round only when the monthly payment hits the schedule. | Monthly cents. |

## Display Formatting

- `toLocaleString`, `Intl.NumberFormat`, and similar APIs remain strictly presentation helpers—formatted strings never feed back into the model or calculations.
- Guardrails (`warnIfFormatted`) log a warning if a string slips into the schedule or KPI data during development (`window.NER_DEV_GUARDS !== false`).
- Duplicate DOM ids trigger a dev warning to help avoid rendering bugs tied to rounded inputs.

## Excel & PDF Exports

- Exports read the numeric model values directly. Excel sheets rely on cell formatting (`numFmt`) for presentation, so no additional rounding is performed in the export layer.
- Optional rounding adjustment rows can be surfaced later; currently the adjustments are logged in the console for visibility.

## Testing

- `npm test` runs Vitest specs in `tests/rounding.spec.js` covering helper behavior:
  - `finalizeMonthlyCurrency` returns numeric cents.
  - Annual totals equal the sum of rounded months (`sumRounded`).
  - `pvFromRounded` matches discounted rounded cashflows within $0.01.
  - `round4` preserves four-decimal PSF precision.

Use these tests whenever rounding code changes to guarantee the policy remains intact.

