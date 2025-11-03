# Exact-First Rounding Policy

The lease calculator follows an **exact-first** policy so that the economic
model never bakes in presentation rounding.

## Core Principles

- **Math uses full precision.** All rent, OpEx, fee, concession, and incentive
  calculations operate on raw `number` values without truncation.
- **Model storage stays exact.** The monthly schedule rows, running totals, and
  KPI aggregates store the precise numeric results produced by the engine—never
  strings and never pre-rounded decimals.
- **Display handles formatting.** UI renderers (tables, KPI cards, charts,
  tooltips, PDF/Excel exports, etc.) are responsible for applying rounding or
  localized number formatting. Formatting helpers return strings strictly for
  display and never write back into the model.

## Present Value

- **PV is computed from exact monthlies.** Discounted cash-flow metrics use the
  exact monthly cashflows and the exact monthly discount rate.

## Annual Totals

- **Annuals sum exact months.** Yearly totals come from summing the precise
  monthly values; rounding is applied only when displaying those totals.

## Display & Exports

- **UI formatting only.** Currency and PSF presentation uses dedicated
  formatting helpers that convert numbers to strings as late as possible.
- **Excel number formats.** Excel exports write the exact numeric values into
  cells and rely on `numFmt` for presentation.

This separation keeps the economic model deterministic and free from penny
drift while letting every surface format values as needed for users.
