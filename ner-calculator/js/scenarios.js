/* =============================================================================
   Scenario Comparison (1–10)
   - Left: photo + toolbar + KPI chips
   - Right: horizontally-scrollable annual cash-flow table
   - Single source of truth: model.schedule[]
   ========================================================================== */

/* ---------- event helper -------------------------------------------------- */
function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/* ---------- staleness guard (use live model if pinned snapshot predates new fields) */
function isStaleModel(m) {
  const s = m?.schedule;
  if (!Array.isArray(s) || s.length === 0) return true;
  const r = s[0] || {};
  return (r.preBase$ == null || r.freeBase$ == null || r.recoveries$ == null || r.llOpex$ == null);
}

/* ---------- compare slots & storage -------------------------------------- */
const MAX_SLOTS = 10;
const COMPARE_COUNT_KEY = 'ner_compare_n';
const SCN_KEY = 'ner_scenarios_v2';

let _memStore = Array(MAX_SLOTS).fill(null);

function readStore() {
  try {
    const raw = localStorage.getItem(SCN_KEY);
    if (!raw) return _memStore;
    const arr = JSON.parse(raw);
    return Array.from({ length: MAX_SLOTS }, (_, i) => arr?.[i] || null);
  } catch {
    return _memStore;
  }
}
function writeStore(arr) {
  _memStore = Array.from({ length: MAX_SLOTS }, (_, i) => arr?.[i] || null);
  try { localStorage.setItem(SCN_KEY, JSON.stringify(_memStore)); } catch {}
}
function getStore() { return readStore(); }
function setStore(arr) { writeStore(arr); }

/* ---------- count select + title ----------------------------------------- */
function getCompareCount() {
  const sel = document.getElementById('compareCount');
  let n = sel ? parseInt(sel.value, 10) : NaN;
  if (!Number.isFinite(n)) {
    try { n = parseInt(localStorage.getItem(COMPARE_COUNT_KEY) || '', 10); } catch {}
  }
  if (!Number.isFinite(n)) n = 3;
  return Math.max(1, Math.min(MAX_SLOTS, n));
}
function updateCompareTitle(n) {
  const h = document.getElementById('scenarioCompareTitle');
  if (h) h.textContent = `Cash Flow Comparison (1—${n})`;
}
function buildCompareCountSelect() {
  const sel = document.getElementById('compareCount');
  if (!sel) return;
  sel.innerHTML = '';
  for (let i = 1; i <= MAX_SLOTS; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = String(i);
    sel.appendChild(opt);
  }
  let n = getCompareCount();
  sel.value = String(n);
  updateCompareTitle(n);
  sel.addEventListener('change', () => {
    const val = getCompareCount();
    try { localStorage.setItem(COMPARE_COUNT_KEY, String(val)); } catch {}
    updateCompareTitle(val);
    renderCompareGrid();
  });
}

/* ---------- helpers: format + small utils -------------------------------- */
const fmtUSD0 = (n) =>
  (isFinite(n) ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—');

const fmtUSD0p = (n) => { // parentheses for negatives
  if (!isFinite(n)) return '—';
  const s = Math.abs(n).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  });
  return n < 0 ? `(${s})` : s;
};

function ymToDateStr(isoYM) {
  try { return new Date(`${isoYM}-01`).toLocaleString(undefined, { month: 'short', year: 'numeric' }); }
  catch (_) { return '—'; }
}
function sumBy(arr, key) { let s = 0; for (const r of arr) s += (+r[key] || 0); return s; }
function monthsInYear(model, y) { return (model.schedule || []).filter(r => r.calYear === y).length || 0; }

function seriesTotalsByYear(series, schedule, allYears, y0) {
  const totals = Object.fromEntries(allYears.map(y => [y, 0]));
  if (!Array.isArray(series) || series.length === 0) return totals;

  const addToYear = (year, value) => {
    if (year == null) return;
    totals[year] = (totals[year] || 0) + Number(value || 0);
  };

  addToYear(y0, series[0] || 0);

  for (let i = 1; i < series.length; i++) {
    const row = schedule[i - 1];
    if (!row) continue;
    addToYear(row.calYear, series[i] || 0);
  }

  return totals;
}

/* ---------- KPIs for left card ------------------------------------------ */
function deriveKPIs(model) {
  const schedule = Array.isArray(model.schedule) ? model.schedule : [];
  const months = schedule.length || 1;
  const netSum   = sumBy(schedule, 'netTotal');
  const grossSum = sumBy(schedule, 'grossTotal');
  return {
    leaseStarts: ymToDateStr(model.leaseStartISO),
    leaseEnds:   ymToDateStr(model.leaseEndISO),
    nerPV:       model.nerPV,
    nerSimple:   model.simpleNet,
    avgNetMonthly:   netSum / months,
    avgGrossMonthly: grossSum / months,
    totalPaidNet:    netSum,
    totalPaidGross:  grossSum
  };
}

/* ---------- mini annual table (right side) ------------------------------- */
function buildMiniTableHTML(model) {
  const sched = Array.isArray(model.schedule) ? model.schedule : [];
  const yearsSet = new Set(sched.map(r => r.calYear));
  const years = [...yearsSet].sort((a,b)=>a-b);
  const hasOther = !!model.hasOtherOpEx;

  // Aggregate by calendar year (all dollars)
  const byY = new Map();
  for (const r of sched) {
    const y = r.calYear;
    const t = byY.get(y) || {
      basePre:0, freeBase:0, totalBase:0,
    
      // tenant-paid detail (recoveries)
      taxesT:0, camT:0, insT:0, otherT:0, mgmtT:0,
    
      // landlord-paid detail
      taxesLL:0, camLL:0, insLL:0, otherLL:0, mgmtLL:0,
    
      recoveries:0, gross:0, llOpex:0
    };
  
  // base/pre-abate/free
  t.basePre  += (+r.preBase$   || 0);
  t.freeBase += (+r.freeBase$  || 0);

  // tenant-paid Opex (prefer dollars, fall back to PSF × area × proration=1)
  const area = +model.area || 0;
  const cf   = +r.cashFactor || 1;
  const clampT = (dPSF) => (r.isGrossAbated ? 0 : (dPSF * area * cf));

  t.taxesT   += (Number.isFinite(+r.tenantTaxes$) ? +r.tenantTaxes$ : clampT(+r.taxesPSF   || 0));
  t.camT     += (Number.isFinite(+r.tenantCam$)   ? +r.tenantCam$   : clampT(+r.camPSF     || 0));
  t.insT     += (Number.isFinite(+r.tenantIns$)   ? +r.tenantIns$   : clampT(+r.insPSF     || 0));
  const otherTenantMo$ = Number.isFinite(+r.otherMonthly$Tenant)
    ? +r.otherMonthly$Tenant
    : ((r.tenPSF && Number.isFinite(+r.tenPSF.other)) ? ((+r.tenPSF.other || 0) / 12) * area * cf : 0);
  t.otherT   += (Number.isFinite(+r.tenantOther$)
    ? +r.tenantOther$
    : (r.isGrossAbated ? 0 : otherTenantMo$));
  // Management Fee dollars — prefer explicit dollars if present; else PSF path
  t.mgmtT  += (+r.tenantMgmt$ || clampT(+r.mgmtPSF || 0));
  t.mgmtLL += (+r.llMgmt$     || 0);

  // landlord-paid detail + totals
  t.taxesLL  += (+r.llTaxes$ || 0);
  t.camLL    += (+r.llCam$   || 0);
  t.insLL    += (+r.llIns$   || 0);
  t.otherLL += (+r.llOther$ || 0);
    // Management Fee dollars — prefer explicit dollars if present; else PSF path
  t.mgmtT  += (+r.tenantMgmt$ || clampT(+r.mgmtPSF || 0));
  t.mgmtLL += (+r.llMgmt$     || 0);


  t.recoveries += (+r.recoveries$ || Math.max(0, (+r.grossTotal||0) - (+r.netTotal||0)));
  t.gross      += (+r.grossTotal || 0);
  t.llOpex     += (+r.llOpex$    || 0);
  byY.set(y, t);
}
years.forEach(y => { const t = byY.get(y); t.totalBase = t.basePre - t.freeBase; });

const taxesT = {}, camT = {}, insT = {}, otherT = {}, mgmtT = {};
const taxesLL = {}, camLL = {}, insLL = {}, otherLL = {}, mgmtLL = {};
years.forEach(y => {
  const t = byY.get(y) || {};
  taxesT[y] = t.taxesT || 0;  camT[y] = t.camT || 0;  insT[y] = t.insT || 0;  otherT[y] = t.otherT || 0;  mgmtT[y] = t.mgmtT || 0;
  taxesLL[y]= t.taxesLL|| 0;  camLL[y]= t.camLL|| 0;  insLL[y]= t.insLL|| 0;  otherLL[y]= t.otherLL|| 0;  mgmtLL[y]= t.mgmtLL|| 0;
});

const recovSubtotal = {}; const llOpexSubtotal = {};
years.forEach(y => {
  recovSubtotal[y]  = (taxesT[y] + camT[y] + insT[y] + mgmtT[y] + (hasOther ? otherT[y] : 0));
  llOpexSubtotal[y] = (taxesLL[y] + camLL[y] + insLL[y] + mgmtLL[y] + (hasOther ? otherLL[y] : 0));
});

  // Extras from KPIs
  const kpis    = model.kpis || {};
  const firstY  = years[0];
  const y0 = firstY - 1;
  const allYears = [y0, ...years];
  const compareSeries = model.compareSeries || {};
  const landlordFreeSeries = Array.isArray(compareSeries.landlordFreeTI) ? compareSeries.landlordFreeTI : [];
  const freeTIAllowanceSeries = Array.isArray(compareSeries.freeTIAllowance) ? compareSeries.freeTIAllowance : landlordFreeSeries;
  const landlordFreeTotals = seriesTotalsByYear(landlordFreeSeries, sched, allYears, y0);
  const freeTIAllowanceTotals = seriesTotalsByYear(freeTIAllowanceSeries, sched, allYears, y0);

  const freeSeriesHasData = landlordFreeSeries.some(v => Math.abs(v || 0) > 1e-6);
  if (!freeSeriesHasData && (+kpis.llFreeTIY0 || 0)) {
    landlordFreeTotals[y0] = (landlordFreeTotals[y0] || 0) + (+kpis.llFreeTIY0 || 0);
  }

  const allowanceSeriesHasData = freeTIAllowanceSeries.some(v => Math.abs(v || 0) > 1e-6);
  if (!allowanceSeriesHasData && (+kpis.llFreeTIY0 || 0)) {
    freeTIAllowanceTotals[y0] = (freeTIAllowanceTotals[y0] || 0) + (+kpis.llFreeTIY0 || 0);
  }
  const tiPrinYr = {}, tiIntYr = {};
years.forEach(y => { tiPrinYr[y] = 0; tiIntYr[y] = 0; });

(function buildTiAmort() {
  // Inputs from kpis
  const P0   = (+kpis.llFinancedTIY0 || 0);      // amount financed by LL (Y0 outlay)
  const pmt  = (+kpis.tiAmortPmt || 0);          // monthly “Additional TI Rent” charge
  const r_m  = (+kpis.tiRateMonthly || 0);       // monthly rate (decimal)
  const Nmax = (+kpis.termMonths || 0);          // # payments (matches term months)
  if (!P0 || !pmt || !Nmax) return;

  // We’ll allocate by the live schedule’s calendar years and respect term months only
  const sched = Array.isArray(model.schedule) ? model.schedule : [];
  let bal = P0, n = 0;

  // Ensure these maps exist
  years.forEach(y => { tiPrinYr[y] = tiPrinYr[y] || 0; tiIntYr[y] = tiIntYr[y] || 0; });
  var addlTIYr = {};              // <-- full monthly payment (P+I) by year
  years.forEach(y => addlTIYr[y] = 0);

  for (const row of sched) {
    if (!row.isTermMonth) continue;
    if (n >= Nmax || bal <= 1e-8) break;

    const y = row.calYear;
    const interest = r_m > 0 ? bal * r_m : 0;
    let principal  = Math.max(0, pmt - interest);
    if (principal > bal) { principal = bal; } // final month clamp

    tiIntYr[y]  += interest;
    tiPrinYr[y] += principal;
    addlTIYr[y] += (principal + interest);

    bal -= principal;
    n++;
  }

  // stash for later rows
  window.__ner_ti_addl_by_year = addlTIYr;
})();

    // Precompute per-year items used by rows below
  const opxTotal = {}, tiFunding = {}, commYr = {}, allowYr = {}, tenantImprYr = {};

  allYears.forEach(y => {
    const t = byY.get(y) || {};
    // tenant-paid OpEx subtotal (0 for Y0 because maps default to 0)
    opxTotal[y] = (taxesT[y]||0) + (camT[y]||0) + (insT[y]||0) + (mgmtT[y]||0) + (hasOther ? (otherT[y]||0) : 0);

    const m = monthsInYear(model, y);
    const tiAmortPmt     = +kpis.tiAmortPmt || 0;
    const commUpfront    = +kpis.commissionNominal || 0;
    const llAllowFunded  = +kpis.llAllowanceApplied || 0;
    const tenantImpr     = +kpis.tenantContribution || 0;

    tiFunding[y]    = tiAmortPmt ? (tiAmortPmt * m) : 0;  // 0 for Y0 automatically
  });

  // one-time items at Y0
  commYr[y0]       = +kpis.commissionNominal || 0;
  allowYr[y0] = -((+kpis.llAllowanceOffered || +kpis.llAllowanceApplied) || 0);
  tenantImprYr[y0] = -(+kpis.tenantContribution || 0);     // Tenant outflow (used in tenant view)
  commYr[y0]       = +kpis.commissionNominal || 0;
  tenantImprYr[y0] = -(+kpis.tenantContribution || 0);

  const tiFundingSubtotal = {};
  allYears.forEach(y => {
    tiFundingSubtotal[y] = (tiPrinYr[y] || 0) + (tiIntYr[y] || 0) + (allowYr[y] || 0);
  });

  // Display-only: show Tenant Contribution as positive
const tenantImprDisplay = Object.fromEntries(
  allYears.map(y => [y, Math.abs(tenantImprYr[y] || 0)])
);

  // Head HTML
  const ths = ['<th></th>', ...allYears.map(y => `<th>${y === y0 ? 'Y0' : y}</th>`)].join('');

// Row helper (supports highlight + parentheses + child grouping + Y0 zero hiding)
const rowHTML = (label, values, options = {}) => {
  const { strong=false, highlight=false, paren=false, child=false, group='', hideZeroY0=false } = options;
  const cls = [highlight ? 'em-row' : '', child ? 'child-row' : '', group ? `child-of-${group}` : '']
    .filter(Boolean).join(' ');
  const lbl = strong ? `<strong>${label}</strong>` : label;

  const tds = allYears.map(y => {
    const raw = values[y] || 0;
    if (hideZeroY0 && y === y0 && Math.abs(raw) < 0.5) return `<td class="y0-blank">&nbsp;</td>`;
    return `<td>${paren ? fmtUSD0p(raw) : fmtUSD0(raw)}</td>`;
  }).join('');

  return `<tr${cls ? ` class="${cls}"` : ''}><th>${lbl}</th>${tds}</tr>`;
};

function expTotal(label, values, key, { strong=false, highlight=false, paren=false, hideZeroY0=false } = {}) {
  const cls = ['exp-row', highlight ? 'em-row' : ''].filter(Boolean).join(' ');
  const lbl = strong ? `<strong>${label}</strong>` : label;

  const tds = allYears.map(y => {
    const raw = values[y] || 0;
    if (hideZeroY0 && y === y0 && Math.abs(raw) < 0.5) return `<td class="y0-blank">&nbsp;</td>`;
    return `<td>${paren ? fmtUSD0p(raw) : fmtUSD0(raw)}</td>`;
  }).join('');

  if (!key) return `<tr class="${cls}"><th>${lbl}</th>${tds}</tr>`;
  const btn = `<button class="twisty subtotal-toggle expanded" data-exp="${key}" aria-expanded="true" aria-label="Collapse ${label} subtotal"><span class="chevron" aria-hidden="true">▾</span></button>`;
  return `<tr class="${cls}" data-exp="${key}">
    <th>${btn} ${lbl}</th>${tds}
  </tr>`;
}

const perspective = (localStorage.getItem('ner_perspective') || model.perspective || 'landlord');
  
  // Tenant view CapEx pieces
const allowYrTenant = {};
allYears.forEach(y => {
  allowYrTenant[y] = (y === y0) ? ((+kpis.llAllowanceOffered || +kpis.llAllowanceApplied) || 0) : 0;
});
const capexTotalTenant = {};
allYears.forEach(y => {
  capexTotalTenant[y] = (tenantImprYr[y] || 0);
});

  // Display-only: show CapEx subtotal as positive
  const capexTotalTenantDisplay = Object.fromEntries(
    allYears.map(y => [y, Math.abs(capexTotalTenant[y] || 0)])
  );

// ---------- Tenant view --------------------------------------------------
// ---------- Tenant view --------------------------------------------------
if (perspective === 'tenant') {
  // Helpers
  const negSeries = (obj) =>
    Object.fromEntries(allYears.map(y => [y, -(obj[y] || 0)]));

  // ── Upfront / Possession (Y0 only) ─────────────────────────────────────
  const totalCapex = +kpis.totalCapex || 0;              // Total Improvement Costs
  const freeTIY0   = +kpis.llFreeTIY0     || 0;          // landlord free TI in Y0
  const finTIY0    = +kpis.llFinancedTIY0 || 0;          // landlord financed TI in Y0

  const buildOutYr = Object.fromEntries(allYears.map(y => [y, (y === y0 ? -totalCapex : 0)])); // negative (tenant outflow)
  const freeTIYr   = Object.fromEntries(allYears.map(y => [y, landlordFreeTotals[y] || 0]));  // positive (LL covers)
  const finTIYr    = Object.fromEntries(allYears.map(y => [y, (y === y0 ?  finTIY0   : 0)]));  // positive (LL finances)

  const netDue = Object.fromEntries(allYears.map(y => [
    y, (buildOutYr[y] || 0) + (freeTIYr[y] || 0) + (finTIYr[y] || 0)
  ]));

  const upfrontBlock = [
    rowHTML('Build-Out Costs',              buildOutYr, { paren:true, child:true, group:'upfront' }),
    rowHTML('Landlord Free TI',             freeTIYr,   {              child:true, group:'upfront' }),
    rowHTML('Landlord Financed TI',         finTIYr,    {              child:true, group:'upfront' }),
    expTotal('Net Tenant Cash Due at Possession', netDue, 'upfront',
             { strong:true, highlight:true, paren:true })
  ];

  // ── Recurring Occupancy Cost (Years 1+) ────────────────────────────────
  // Base Rent (use Total Base, already net of free rent)
  const baseNeg = Object.fromEntries(allYears.map(y => [
    y, (y === y0 ? 0 : -((byY.get(y)?.totalBase) || 0))
  ]));

  // Amortized TI Payment = (Principal + Interest), negative to tenant; no Y0
  const tiAmortNeg = {};
  allYears.forEach(y => {
    const p = tiPrinYr[y] || 0;
    const i = tiIntYr[y]  || 0;
    tiAmortNeg[y] = (y === y0) ? 0 : -(p + i);
  });

  // Tenant-paid OpEx detail (negatives for tenant)
  const taxesNeg = negSeries(taxesT);
  const camNeg   = negSeries(camT);
  const insNeg   = negSeries(insT);
  const mgmtNeg  = negSeries(mgmtT);
  const otherNeg = hasOther ? negSeries(otherT) : null;

  // OpEx subtotal (tenant)
  const opxSubNeg = {};
  allYears.forEach(y => {
    opxSubNeg[y] =
      (taxesNeg[y] || 0) +
      (camNeg[y]   || 0) +
      (insNeg[y]   || 0) +
      (mgmtNeg[y]  || 0) +
      (hasOther ? (otherNeg[y] || 0) : 0);
    // Ensure Y0 subtotal is zero (no recurring costs in possession year)
    if (y === y0) opxSubNeg[y] = 0;
  });

  const opxDetail = [
    rowHTML('Taxes',     taxesNeg, { child:true, group:'opx', paren:true, hideZeroY0:true }),
    rowHTML('CAM',       camNeg,   { child:true, group:'opx', paren:true, hideZeroY0:true }),
    rowHTML('Insurance', insNeg,   { child:true, group:'opx', paren:true, hideZeroY0:true }),
    rowHTML('Mgmt Fee',  mgmtNeg,  { child:true, group:'opx', paren:true, hideZeroY0:true }),
    ...(hasOther ? [ rowHTML('Other OpEx', otherNeg, { child:true, group:'opx', paren:true, hideZeroY0:true }) ] : [])
  ];

  const opxBlock = [
    ...opxDetail,
    expTotal('NNN / OpEx', opxSubNeg, 'opx', { strong:true, highlight:true, paren:true, hideZeroY0:true })
  ];

  // Total Occupancy Cost (Years 1+): Base + Amortized TI + OpEx
  const occCost = {};
  allYears.forEach(y => {
    occCost[y] = (y === y0) ? 0 : (baseNeg[y] || 0) + (tiAmortNeg[y] || 0) + (opxSubNeg[y] || 0);
  });

  // Cumulative Occupancy Cost (exclude Y0 from running total)
  const cumOcc = {};
  let run = 0;
  allYears.forEach(y => {
    if (y !== y0) run += (occCost[y] || 0);
    cumOcc[y] = run;
  });

  // ── Assemble rows in the exact order required ──────────────────────────
  const lines = [
    // Upfront / Possession
    ...upfrontBlock,

    // Recurring
    rowHTML('Base Rent',              baseNeg,    { paren:true, hideZeroY0:true }),
    rowHTML('Amortized TI Payment',   tiAmortNeg, { paren:true, hideZeroY0:true }),
    ...opxBlock,
    expTotal('Total Occupancy Cost',  occCost,    'occ', { strong:true, highlight:true, paren:true }),

    // Cumulative
    rowHTML('Cumulative Occupancy Cost', cumOcc,  { strong:true, highlight:true, paren:true })
  ];

  return `<table class="cf-mini"><thead><tr>${ths}</tr></thead><tbody>${lines.join('')}</tbody></table>`;
}

// ---------- Landlord view -----------------------------------------------

// Helper to show negatives in parentheses when rendering
const negVals = (vals) => Object.fromEntries(allYears.map(y => [y, -Math.abs(vals[y] || 0)]));

// --- Additional TI Rent (P+I) by year (built earlier in buildTiAmort)
const addlTI = (window.__ner_ti_addl_by_year || {});

// --- Total base rent per year (already aggregated in byY)
const totalBaseYr = Object.fromEntries(
  allYears.map(y => [y, (byY.get(y)?.totalBase) || 0])
);

// --- Total Recoveries subtotal per year (already computed as recovSubtotal)
// taxesT, camT, insT, mgmtT, (otherT if present) are detail lines.

// --- Total Rent & Recoveries = Total Base + Additional TI Rent + Recoveries
const totalRentRec = {};
allYears.forEach(y => {
  totalRentRec[y] = (totalBaseYr[y] || 0)
                  + (addlTI[y]      || 0)
                  + (recovSubtotal[y] || 0);
});

// --- Landlord Operating Cost (Unrecoverable)
const llOpxNeg = negVals(llOpexSubtotal); // negative for display

// --- NOI = Total Rent & Recoveries – LL Operating Cost (unrecoverable)
const noi = {};
allYears.forEach(y => {
  noi[y] = (totalRentRec[y] || 0) - (llOpexSubtotal[y] || 0);
});

// --- Initial TI Outlay (Y0 only): split Free vs Financed using kpis
const financedTIY0 = (+kpis.llFinancedTIY0 || 0);

const initFree = Object.fromEntries(allYears.map(y => [y, -(freeTIAllowanceTotals[y] || 0)]));
const initFin  = Object.fromEntries(allYears.map(y => [y, (y === y0 ? -financedTIY0 : 0)]));
const initTI   = Object.fromEntries(allYears.map(y => [y, initFree[y] + initFin[y]]));

// --- Net Cash Flow (before debt)
// Y0:  NOI + Initial TI Outlay (negative) – Lease Commissions (if any)
// Y1+: NOI
const cash = {}, cum = {};
let running = 0;
allYears.forEach(y => {
  const c = (noi[y] || 0)
          + (initTI[y] || 0)
          - (y === y0 ? (+kpis.commissionNominal || 0) : 0);
  cash[y]   = c;
  running  += c;
  cum[y]    = running;
});

// ------------------- Detail groups --------------------

// Recoveries (tenant-paid detail)
const recovDetail = [
  rowHTML('Taxes',     taxesT, { child:true, group:'rec', hideZeroY0:true }),
  rowHTML('CAM',       camT,   { child:true, group:'rec', hideZeroY0:true }),
  rowHTML('Insurance', insT,   { child:true, group:'rec', hideZeroY0:true }),
  rowHTML('Mgmt Fee',  mgmtT,  { child:true, group:'rec', hideZeroY0:true }),
  ...(hasOther ? [ rowHTML('Other OpEx', otherT, { child:true, group:'rec', hideZeroY0:true }) ] : [] )
];

// LL Operating Cost (detail; shown as negatives)
const llOpxDetail = [
  rowHTML('Taxes',     negVals(taxesLL), { child:true, group:'llopx', paren:true, hideZeroY0:true }),
  rowHTML('CAM',       negVals(camLL),   { child:true, group:'llopx', paren:true, hideZeroY0:true }),
  rowHTML('Insurance', negVals(insLL),   { child:true, group:'llopx', paren:true, hideZeroY0:true }),
  rowHTML('Mgmt Fee',  negVals(mgmtLL),  { child:true, group:'llopx', paren:true, hideZeroY0:true }),
  ...(hasOther ? [ rowHTML('Other OpEx', negVals(otherLL), { child:true, group:'llopx', paren:true, hideZeroY0:true }) ] : [] ),
];

// ------------------- Rows (order per spec) --------------------
const lines = [
  // Base rent stack
  rowHTML('Base Rent',
    Object.fromEntries(allYears.map(y => [y, (byY.get(y)?.basePre) || 0])),
    { hideZeroY0:true }
  ),
  rowHTML('Free Rent',
    Object.fromEntries(allYears.map(y => [y, -((byY.get(y)?.freeBase) || 0)])),
    { paren:true, hideZeroY0:true }
  ),
  rowHTML('Total Base Rent', totalBaseYr, { strong:true, highlight:true, hideZeroY0:true }),

  // Additional TI Rent (top-line)
  rowHTML('Additional TI Rent', addlTI, { hideZeroY0:true }),

  // Recoveries (detail + subtotal)
  ...recovDetail,
  expTotal('Total Recoveries', recovSubtotal, 'rec', { strong:true, highlight:true, hideZeroY0:true }),

  // Total rent + recoveries
  rowHTML('Total Rent & Recoveries', totalRentRec, { strong:true, highlight:true, hideZeroY0:true }),

  // Unrecoverable LL Opex and NOI
  ...llOpxDetail,
  expTotal('Landlord Operating Cost (Unrecoverable)', llOpxNeg, 'llopx',
    { strong:true, highlight:true, paren:true, hideZeroY0:true }),
  rowHTML('Net Operating Income (NOI)', noi, { strong:true, highlight:true, hideZeroY0:true }),

  // Initial TI Outlay block (Y0 only)
  rowHTML('Free TI / Improvement Allowance', initFree, { paren:true }),
  rowHTML('Financed TI Funded by Landlord',  initFin,  { paren:true }),
  rowHTML('Total Initial TI Outlay',         initTI,   { paren:true, strong:true, highlight:true }),

  // Optional: show commissions (kept separate for transparency)
  ...( (+kpis.commissionNominal||0)
      ? [ rowHTML('Lease Commissions',
                  Object.fromEntries(allYears.map(y => [y, (y === y0 ? -(+kpis.commissionNominal||0) : 0)])),
                  { paren:true }) ]
      : [] ),

  // Cash flows
  rowHTML('Net Cash Flow (before debt)', cash, { strong:true, highlight:true, paren:true }),
  rowHTML('Cumulative Cash Flow',        cum,  { strong:true, highlight:true, paren:true })
];

return `<table class="cf-mini"><thead><tr>${ths}</tr></thead><tbody>${lines.join('')}</tbody></table>`;

}

/* ---------- KPI chip (left side) ----------------------------------------- */
function kpiChip(label, value) {
  return `<div class="kpi-chip"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

/* ---------- one scenario row --------------------------------------------- */
const ACCENTS = ['#7dd3fc','#86efac','#fca5a5','#fde68a','#c4b5fd','#f9a8d4','#93c5fd','#f97316','#34d399','#e5e7eb'];
const accentFor = (i) => ACCENTS[i % ACCENTS.length];

function renderScenarioRow(slotIndex, model) {
  const kpi = deriveKPIs(model);
  const photo = model.photoDataURL || '';
  const leftHTML = `
    <div class="scenario-left">
      <div class="scenario-badge"><span>Scenario</span><span class="num">${slotIndex + 1}</span></div>
      ${photo ? `<img class="photo" alt="" src="${photo}">` : `<div class="photo" style="display:grid;place-items:center;color:var(--text-3);">No photo</div>`}
      <div class="scenario-toolbar">
        <button class="btn small" data-scn="${slotIndex}" data-act="load">Load</button>
        <button class="btn small" data-scn="${slotIndex}" data-act="dup">Duplicate</button>
        <button class="btn small ghost" data-scn="${slotIndex}" data-act="clear">Clear</button>
        <button class="pin-btn" data-scn="${slotIndex}" data-act="pin"><span class="dot"></span>Pin current → ${slotIndex + 1}</button>
      </div>
      <div class="kpi-grid">
        ${kpiChip('Lease Starts', kpi.leaseStarts)}
        ${kpiChip('Lease Ends',   kpi.leaseEnds)}
        ${kpiChip('NER (PV)',     kpi.nerPV != null ? fmtUSD0(kpi.nerPV) : '—')}
        ${kpiChip('NER (non-PV)', kpi.nerSimple != null ? fmtUSD0(kpi.nerSimple) : '—')}
        ${kpiChip('Avg Monthly Net',   fmtUSD0(kpi.avgNetMonthly))}
        ${kpiChip('Avg Monthly Gross', fmtUSD0(kpi.avgGrossMonthly))}
        ${kpiChip('Total Net Rent',    fmtUSD0(kpi.totalPaidNet))}
        ${kpiChip('Total Gross Rent',  fmtUSD0(kpi.totalPaidGross))}
      </div>
    </div>`;
  const rightHTML = `<div class="scenario-right">${buildMiniTableHTML(model)}</div>`;
  return `<div class="scenario-row" data-scn="${slotIndex}" style="--accent:${accentFor(slotIndex)}">${leftHTML}${rightHTML}</div>`;
}

function renderEmptyRow(slotIndex) {
  return `
  <div class="scenario-row" data-scn="${slotIndex}" style="--accent:${accentFor(slotIndex)}">
    <div class="scenario-left">
      <div class="scenario-badge"><span>Scenario</span><span class="num">${slotIndex + 1}</span></div>
      <div class="scenario-toolbar">
        <button class="btn small" data-scn="${slotIndex}" data-act="load">Load</button>
        <button class="btn small" data-scn="${slotIndex}" data-act="dup">Duplicate</button>
        <button class="btn small ghost" data-scn="${slotIndex}" data-act="clear">Clear</button>
        <button class="pin-btn" data-scn="${slotIndex}" data-act="pin"><span class="dot"></span>Pin current → ${slotIndex + 1}</button>
      </div>
      <div class="kpi-grid">${kpiChip('No scenario pinned', '—')}</div>
    </div>
    <div class="scenario-right">
      <table class="cf-mini"><thead><tr><th></th><th>—</th></tr></thead><tbody>
        <tr><th>Total Rent</th><td>$0</td></tr>
      </tbody></table>
    </div>
  </div>`;
}

/* ---------- toolbar actions ---------------------------------------------- */
function onToolbarClick(e) {
  const btn = e.currentTarget;
  const slot = parseInt(btn.dataset.scn, 10);
  const act  = btn.dataset.act;
  if (!isFinite(slot)) return;
  if (act === 'pin')   return pinCurrentIntoSlot(slot);
  if (act === 'load')  return loadScenarioSlot(slot);
  if (act === 'dup')   return duplicateScenarioSlot(slot);
  if (act === 'clear') return clearScenarioSlot(slot);
}

function pinCurrentIntoSlot(i) {
  const curr = window.__ner_last;
  if (!curr || !Array.isArray(curr.schedule)) return;

  const enriched = {
    ...curr,
    photoDataURL: curr.photoDataURL ?? (window.__ner_photo || localStorage.getItem('ner.photo') || null)
  };
  const snap = JSON.parse(JSON.stringify(enriched));
  delete snap.perspective;   // follow global toggle
  const s = getStore(); s[i] = snap; setStore(s);
  renderCompareGrid();
  flashPinned(i);
}

function loadScenarioSlot(i) {
  const m = getStore()[i]; if (!m) return;
  emit('ner:scenario-load', { model: m, slot: i });
  window.__ner_last = JSON.parse(JSON.stringify(m));
}
function duplicateScenarioSlot(i) {
  const s = getStore(), m = s[i]; if (!m) return;
  let target = s.findIndex(x => !x); if (target === -1) target = (i + 1) % MAX_SLOTS;
  s[target] = JSON.parse(JSON.stringify(m)); setStore(s); renderCompareGrid();
}
function clearScenarioSlot(i) {
  const s = getStore(); s[i] = null; setStore(s); renderCompareGrid();
}

/* ---------- pin feedback + accents --------------------------------------- */
function flashPinned(slotIndex, text = 'Pinned ✓') {
  const row  = document.querySelector(`.scenario-row[data-scn="${slotIndex}"]`);
  const btn  = row?.querySelector('.pin-btn'); if (!btn) return;
  const original = `Pin current → ${slotIndex + 1}`;
  btn.classList.add('pinned', 'pulse');
  btn.textContent = text;
  setTimeout(() => { btn.classList.remove('pulse'); btn.textContent = original; }, 1100);
}

/* ---------- grid renderer ------------------------------------------------ */
function renderCompareGrid() {
  const host = document.getElementById('compareGrid');
  if (!host) return;

  const store = getStore();
  const count = getCompareCount();
  updateCompareTitle(count);

  let html = '';
  for (let i = 0; i < count; i++) {
    let m = store[i];
    if (!m || isStaleModel(m)) m = window.__ner_last || m; // prefer live model if stale
    html += m ? renderScenarioRow(i, m) : renderEmptyRow(i);
  }
  host.innerHTML = html;

  // Wire expand/collapse (the subtotal row controls its child group)
  host.querySelectorAll('.scenario-right .twisty').forEach(btn => {
    const key = btn.dataset.exp;
    const initiallyExpanded = btn.getAttribute('aria-expanded') !== 'false';
    btn.classList.toggle('expanded', initiallyExpanded);
    btn.addEventListener('click', () => {
      const isExpanded = btn.getAttribute('aria-expanded') !== 'false';
      const next = !isExpanded;
      btn.setAttribute('aria-expanded', String(next));
      btn.classList.toggle('expanded', next);
      host.querySelectorAll(`.scenario-right tr.child-of-${key}`).forEach(tr => {
        tr.style.display = next ? '' : 'none';
      });
    });
  });

  // Wire toolbar
  host.querySelectorAll('.scenario-toolbar .btn, .scenario-toolbar .pin-btn')
      .forEach(btn => btn.addEventListener('click', onToolbarClick));
}

/* ---------- boot ---------------------------------------------------------- */
function bootScenarios() {
  buildCompareCountSelect();
  renderCompareGrid();
  window.addEventListener('ner:calculated', (ev) => {
    window.__ner_last = ev.detail?.model || window.__ner_last;
  });

  // Expand all before printing / exporting PDF to ensure details show
  window.addEventListener('beforeprint', () => {
    document.querySelectorAll('#compareGrid .scenario-right .twisty').forEach(btn => {
      if (btn.getAttribute('aria-expanded') === 'false') btn.click();
    });
  });
}

// Expose for other modules
window.renderCompareGrid = renderCompareGrid;

// DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootScenarios);
} else {
  bootScenarios();
}
