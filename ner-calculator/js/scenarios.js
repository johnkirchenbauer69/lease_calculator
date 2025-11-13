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

function scenarioTitle(model, idx) {
  if (!model) return `Scenario ${idx + 1}`;
  const candidates = [model.name, model.title, model.address, model.propertyName, model.propertyLabel, model.address, model.propertyAddress];
  for (const cand of candidates) {
    if (typeof cand === 'string' && cand.trim()) return cand.trim();
  }
  return `Scenario ${idx + 1}`;
}

/* ---------- compare slots & storage -------------------------------------- */
const MAX_SLOTS = 10;
const SCN_KEY = 'ner_scenarios_v2';
const RING_INDEX_KEY = 'ner_compare_ring_idx';
const AUTO_ADD_STALE_MS = 4000;

let lastAutoAddTimestamp = null;

let _memStore = Array(MAX_SLOTS).fill(null);
let _lastAutoSlotIndex = (() => {
  try {
    const raw = parseInt(localStorage.getItem(RING_INDEX_KEY) || '', 10);
    if (Number.isFinite(raw) && raw >= 0 && raw < MAX_SLOTS) return raw;
  } catch {}
  return -1;
})();

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

function rememberAutoSlotIndex(i) {
  if (!Number.isFinite(i)) return;
  _lastAutoSlotIndex = Math.max(0, Math.min(MAX_SLOTS - 1, i));
  try { localStorage.setItem(RING_INDEX_KEY, String(_lastAutoSlotIndex)); } catch {}
}

function getRememberedAutoSlotIndex() {
  if (!Number.isFinite(_lastAutoSlotIndex) || _lastAutoSlotIndex < 0) return -1;
  return Math.min(MAX_SLOTS - 1, _lastAutoSlotIndex);
}

function pickNextSlot(store = getStore()) {
  const arr = Array.isArray(store) ? store : getStore();
  const emptyIdx = arr.findIndex(x => !x);
  if (emptyIdx !== -1) {
    rememberAutoSlotIndex(emptyIdx);
    return emptyIdx;
  }
  const prev = getRememberedAutoSlotIndex();
  const next = prev >= 0 ? ((prev + 1) % MAX_SLOTS) : 0;
  rememberAutoSlotIndex(next);
  return next;
}

function snapshotFromModel(model) {
  if (!model || typeof model !== 'object') return null;
  if (!Array.isArray(model.schedule) || model.schedule.length === 0) return null;
  let photo = model.photoDataURL;
  if (!photo) {
    photo = window.__ner_photo || null;
    if (!photo) {
      try { photo = localStorage.getItem('ner.photo') || null; }
      catch { photo = null; }
    }
  }
  const enriched = { ...model, photoDataURL: photo || null };
  const snap = JSON.parse(JSON.stringify(enriched));
  delete snap.perspective;
  return snap;
}

function autoAddScenarioFromModel(model) {
  const stamp = Number(model?.__inputs?.timestamp);
  if (!Number.isFinite(stamp) || stamp === lastAutoAddTimestamp) return null;
  const snap = snapshotFromModel(model);
  if (!snap) return null;
  const store = Array.from(getStore());
  const slot = pickNextSlot(store);
  store[slot] = snap;
  setStore(store);
  lastAutoAddTimestamp = stamp;
  renderCompareGrid();
  flashPinned(slot, 'Saved ✓');
  return slot;
}

function readAutoAddIntent() {
  const metaCandidates = [
    window.__ner_compare_auto_add_intent,
    window.__ner_compare_auto_add_request,
    window.__ner_compare_auto_add_click,
    window.__ner_compare_auto_add
  ];
  let meta = null;
  for (const candidate of metaCandidates) {
    if (candidate != null) { meta = candidate; break; }
  }

  const tsCandidates = [];
  const pushTs = (value) => {
    if (value == null) return;
    const num = Number(value);
    if (Number.isFinite(num)) tsCandidates.push(num);
  };

  pushTs(window.__ner_compare_auto_add_click_ts);
  pushTs(window.__ner_compare_auto_add_ts);

  if (meta != null) {
    if (typeof meta === 'number') {
      pushTs(meta);
    } else if (typeof meta === 'object') {
      ['ts', 'timestamp', 'time', 'at', 'clickedAt', 'clickTs']
        .forEach(prop => pushTs(meta[prop]));
    }
  }

  const ts = tsCandidates.length ? tsCandidates[0] : NaN;

  const programmaticCandidates = [];
  const pushProgrammatic = (value) => {
    if (typeof value === 'boolean') programmaticCandidates.push(value);
  };

  pushProgrammatic(window.__ner_compare_auto_add_programmatic);
  if (meta && typeof meta === 'object') {
    ['programmatic', 'isProgrammatic', 'auto', 'programmaticClick']
      .forEach(prop => pushProgrammatic(meta[prop]));
    if (typeof meta.manual === 'boolean') pushProgrammatic(!meta.manual);
  }

  const programmatic = programmaticCandidates.length ? programmaticCandidates[0] : false;
  const hasIntent = !!meta || tsCandidates.length > 0 || programmaticCandidates.some(v => v === true);
  return { ts, programmatic, hasIntent };
}

function resetAutoAddIntent() {
  const objKeys = [
    '__ner_compare_auto_add_intent',
    '__ner_compare_auto_add_request',
    '__ner_compare_auto_add_click',
    '__ner_compare_auto_add'
  ];
  const tsKeys = ['__ner_compare_auto_add_click_ts', '__ner_compare_auto_add_ts'];
  objKeys.forEach((key) => { if (key in window) window[key] = null; });
  tsKeys.forEach((key) => { if (key in window) window[key] = null; });
  if ('__ner_compare_auto_add_programmatic' in window) {
    window.__ner_compare_auto_add_programmatic = false;
  }
}

function resetAutoAddGuard() {
  lastAutoAddTimestamp = null;
}

/* ---------- count helpers + title ---------------------------------------- */
function deriveVisibleSlotCount(store = getStore()) {
  const arr = Array.isArray(store) ? store : getStore();
  const highest = arr.reduce((max, item, idx) => (item ? Math.max(max, idx + 1) : max), 0);
  const filled = arr.filter(Boolean).length;
  const desired = Math.max(highest, filled);
  return Math.max(1, Math.min(MAX_SLOTS, desired));
}
function updateCompareTitle(n) {
  const h = document.getElementById('scenarioCompareTitle');
  if (h) h.textContent = `Cash Flow Comparison (1—${n})`;
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

const formattingAPI = window.NERFormatting || {};
const displayCurrency = typeof formattingAPI.formatCurrency === 'function'
  ? formattingAPI.formatCurrency
  : (value) => (Number.isFinite(Number(value))
    ? Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—');
const displayPSF = typeof formattingAPI.formatPSF === 'function'
  ? formattingAPI.formatPSF
  : (value) => (Number.isFinite(Number(value))
    ? `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/SF`
    : '—');

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

// ---- Cashflow helpers (lightweight; no refactor)
const CF_CORE_KEYS = new Set([
  'base_rent','total_base','rent_recoveries_total','noi',
  'tenant_nnn_opex','total_occupancy_cost','cumulative_cash_flow'
]);

function cfSum(obj) { return Object.values(obj || {}).reduce((a,b)=>a + (+b || 0), 0); }

function cfShouldHideRow(row, showHidden) {
  if (showHidden) return false;
  if (row.isSubtotal) return false;
  if (CF_CORE_KEYS.has(row.key)) return false;
  return Math.abs(cfSum(row.amountsByYear)) < 1e-8;
}

// resp: 'tenant' | 'landlord' | 'split'
function cfRoute(view, resp) {
  if (resp === 'tenant')   return view === 'tenant'   ? 'show' : 'hide';
  if (resp === 'landlord') return view === 'landlord' ? 'show' : 'hide';
  if (resp === 'split')    return 'split';
  return 'show';
}

function cfBadgeText(resp, pct) {
  if (resp === 'tenant')   return 'Tenant-paid';
  if (resp === 'landlord') return 'LL-paid';
  if (resp === 'split')    return `Split ${Math.round((pct ?? .5)*100)}%`;
  return '';
}

// amountsByYear: { [year]: number }, share: 0..1
function cfShare(amountsByYear, share) {
  const out = {};
  for (const [y,v] of Object.entries(amountsByYear || {})) out[y] = (+v||0) * (share ?? .5);
  return out;
}

function cfSetTooltip(td, unit, note) {
  if (!td) return;
  if (unit) td.dataset.unit = unit;
  if (note) {
    try {
      const decoded = decodeURIComponent(note);
      td.title = decoded;
      td.dataset.note = decoded;
    } catch (_) {
      td.title = note;
      td.dataset.note = note;
    }
  }
}

function tiTreatment(model){
  const raw = (model?.buildout?.treatment || model?.ti?.treatment || model?.tiTreatment || '').toLowerCase();
  if (raw.includes('cash')) return 'cash';
  if (raw.includes('amort')) return 'amortized';
  if (raw.includes('financ')) return 'amortized';
  return 'cash';
}

// ====== FORMATTER FALLBACKS (use existing if they exist) ======
const _fmtMoney = (typeof fmtMoney === 'function') ? fmtMoney : (v) => displayCurrency(v);
const _fmtPSF = (typeof fmtPSF === 'function') ? fmtPSF : (v) => displayPSF(v);
const _fmtPct = (typeof fmtPct === 'function') ? fmtPct : (v) => {
  if (v == null || Number.isNaN(v)) return '—';
  return `${Number(v).toFixed(1)}%`;
};
const _fmtInt = (v) => {
  if (v == null || Number.isNaN(v)) return '—';
  return String(Math.round(v));
};

function fmtDate(d) {
  if (!d) return '—';
  const date = d instanceof Date ? new Date(d.getTime()) : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yy = date.getFullYear();
  return `${mm}/${dd}/${yy}`;
}

// ====== BEST-IN-ROW EVAL ======
function pickBest(values, better = 'lower') {
  const arr = values.map(v => {
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  });
  let bestIdx = -1;
  let bestVal = null;
  arr.forEach((val, idx) => {
    if (val == null) return;
    if (bestIdx === -1) { bestIdx = idx; bestVal = val; return; }
    if (better === 'higher') {
      if (val > bestVal) { bestIdx = idx; bestVal = val; }
    } else if (better === 'abs-lower') {
      if (Math.abs(val) < Math.abs(bestVal)) { bestIdx = idx; bestVal = val; }
    } else {
      if (val < bestVal) { bestIdx = idx; bestVal = val; }
    }
  });
  return bestIdx;
}

/* ---------- KPIs for left card ------------------------------------------ */
function deriveKPIs(model) {
  const schedule = Array.isArray(model.schedule) ? model.schedule : [];
  const months = schedule.length || 1;
  const netSum   = sumBy(schedule, 'netTotal');
  const grossSum = sumBy(schedule, 'grossTotal');
  const timing = (typeof window.getLeaseTimingSummary === 'function')
    ? window.getLeaseTimingSummary(model)
    : null;
  const fmtLeaseDate = (date, fallbackIso) => {
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date.toLocaleString(undefined, { month: 'short', year: 'numeric' });
    }
    return ymToDateStr(fallbackIso);
  };
  return {
    leaseStarts: fmtLeaseDate(timing?.startDate, model.leaseStartISO),
    leaseEnds:   fmtLeaseDate(timing?.endDate, model.leaseEndISO),
    nerPV:       model.nerPV,
    nerSimple:   model.simpleNet,
    avgNetMonthly:   netSum / months,
    avgGrossMonthly: grossSum / months,
    totalPaidNet:    netSum,
    totalPaidGross:  grossSum
  };
}

/* ---------- mini annual table (right side) ------------------------------- */
function buildMiniTableHTML(model, opts = {}) {
  const sched = Array.isArray(model.schedule) ? model.schedule : [];
  const hasOther = !!model.hasOtherOpEx;
  const showHidden = document.getElementById('showHiddenRows')?.checked;
  const renderedRowKeys = new Set();

  // ---- ensure years are known BEFORE any use
  // Try several sources; take the first non-empty; then sort ascending.
  const yearsFromModel =
    (model?.years && Object.keys(model.years)) ||
    (model?.annualYears && [...model.annualYears]) ||
    (model?.headers?.years && [...model.headers.years]) ||
    (model?.scheduleAnnual && Object.keys(model.scheduleAnnual)) ||
    null;

  // We also allow the caller to pass a years list via opts if present.
  const yearsFromOpts = (opts && Array.isArray(opts.years) && opts.years.length ? [...opts.years] : null);

  // Fallback: infer from known series if everything else is empty
  function keysIf(obj) { return obj ? Object.keys(obj) : []; }
  const yearsFromSeries = (
    keysIf(model?.baseRentByYear).length ? keysIf(model.baseRentByYear) :
    keysIf(model?.taxesByYear).length ? keysIf(model.taxesByYear) :
    keysIf(model?.camByYear).length ? keysIf(model.camByYear) :
    keysIf(model?.insuranceByYear).length ? keysIf(model.insuranceByYear) :
    keysIf(model?.mgmtFeeByYear).length ? keysIf(model.mgmtFeeByYear) :
    []
  );

  // Choose the winner and normalize to sorted numeric-ish strings
  let allYearCandidates = (yearsFromOpts || yearsFromModel || yearsFromSeries || []).map(String);
  allYearCandidates = [...new Set(allYearCandidates)].sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));

  // Guard: if still empty, derive a single start year so downstream code won’t crash
  if (allYearCandidates.length === 0) {
    const start = (model?.startYear) || new Date().getFullYear();
    allYearCandidates = [String(start)];
  }

  const scheduleYears = [...new Set(sched.map(r => r.calYear).filter(y => y != null))].sort((a, b) => a - b);
  let years = scheduleYears.slice();
  if (!years.length) {
    years = allYearCandidates
      .map(y => parseInt(y, 10))
      .filter(n => Number.isFinite(n));
    years = [...new Set(years)].sort((a, b) => a - b);
  }

  const fallbackYear = Number.isFinite(years[0]) ? years[0] : parseInt(allYearCandidates[0], 10);
  const resolvedFirstYear = Number.isFinite(fallbackYear) ? fallbackYear : new Date().getFullYear();
  const y0 = resolvedFirstYear - 1;
  years = years.length ? years : [resolvedFirstYear];
  let allYears = [y0, ...years];

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

const totalTaxesAll = Object.fromEntries(allYears.map(y => [y, (taxesT[y] || 0) + (taxesLL[y] || 0)]));
const totalCamAll   = Object.fromEntries(allYears.map(y => [y, (camT[y]   || 0) + (camLL[y]   || 0)]));
const totalInsAll   = Object.fromEntries(allYears.map(y => [y, (insT[y]   || 0) + (insLL[y]   || 0)]));
const totalMgmtAll  = Object.fromEntries(allYears.map(y => [y, (mgmtT[y]  || 0) + (mgmtLL[y]  || 0)]));
const totalOtherAll = Object.fromEntries(allYears.map(y => [y, (otherT?.[y] || 0) + (otherLL?.[y] || 0)]));

const recovSubtotal = {}; const llOpexSubtotal = {};
years.forEach(y => {
  recovSubtotal[y]  = (taxesT[y] + camT[y] + insT[y] + mgmtT[y] + (hasOther ? otherT[y] : 0));
  llOpexSubtotal[y] = (taxesLL[y] + camLL[y] + insLL[y] + mgmtLL[y] + (hasOther ? otherLL[y] : 0));
});

  // Extras from KPIs
  const kpis    = model.kpis || {};
  // Derive TI total if only PSF given
  const tiPSF   = model?.tiAllowancePSF || 0;
  const sizeSF  = model?.spaceSize || 0;
  const tiCash  = model?.tiAllowanceTotal ?? (tiPSF * sizeSF);
  const treatmentType = tiTreatment(model);
  const isAmortizedLike = treatmentType === 'amortized';
  const perspectivePref = (localStorage.getItem('ner_perspective') || model.perspective || 'landlord');

  const compareSeries = model.compareSeries || {};
  const landlordFreeSeries = Array.isArray(compareSeries.landlordFreeTI) ? compareSeries.landlordFreeTI : [];
  const freeTIAllowanceSeries = Array.isArray(compareSeries.freeTIAllowance) ? compareSeries.freeTIAllowance : landlordFreeSeries;
  let landlordFreeTotals = seriesTotalsByYear(landlordFreeSeries, sched, allYears, y0);
  let freeTIAllowanceTotals = seriesTotalsByYear(freeTIAllowanceSeries, sched, allYears, y0);

  const financedPrincipal = Math.max(0, +kpis.llFinancedTIY0 || 0);
  const kpiFreeTIY0 = Math.max(0, +kpis.llFreeTIY0 || 0);
  const totalAllowance = Math.max(0, tiCash || 0);
  let freeAllowanceY0 = isAmortizedLike ? Math.max(0, totalAllowance - financedPrincipal) : totalAllowance;
  if (!freeAllowanceY0 && kpiFreeTIY0) freeAllowanceY0 = kpiFreeTIY0;

  landlordFreeTotals = Object.fromEntries(allYears.map(y => [y, 0]));
  freeTIAllowanceTotals = Object.fromEntries(allYears.map(y => [y, 0]));
  landlordFreeTotals[y0] = freeAllowanceY0;
  freeTIAllowanceTotals[y0] = freeAllowanceY0;
  const tiPrinYr = {}, tiIntYr = {};
  years.forEach(y => { tiPrinYr[y] = 0; tiIntYr[y] = 0; });

(function buildTiAmort() {
  const zeroSchedule = Object.fromEntries(allYears.map(y => [y, 0]));
  window.__ner_ti_addl_by_year = zeroSchedule;
  if (!isAmortizedLike) return;

  // Inputs from kpis
  const P0   = financedPrincipal;                // amount financed by LL (Y0 outlay)
  const pmt  = (+kpis.tiAmortPmt || 0);          // monthly “Additional TI Rent” charge
  const r_m  = (+kpis.tiRateMonthly || 0);       // monthly rate (decimal)
  const Nmax = (+kpis.termMonths || 0);          // # payments (matches term months)
  if (!P0 || !pmt || !Nmax) return;

  // We’ll allocate by the live schedule’s calendar years and respect term months only
  const sched = Array.isArray(model.schedule) ? model.schedule : [];
  let bal = P0, n = 0;

  // Ensure these maps exist
  years.forEach(y => { tiPrinYr[y] = tiPrinYr[y] || 0; tiIntYr[y] = tiIntYr[y] || 0; });
  const addlTIYr = { ...zeroSchedule };              // <-- full monthly payment (P+I) by year

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

    tiFunding[y]    = (isAmortizedLike && tiAmortPmt) ? (tiAmortPmt * m) : 0;  // 0 for Y0 automatically
  });

  // one-time items at Y0
  commYr[y0]       = +kpis.commissionNominal || 0;
  allowYr[y0] = -freeAllowanceY0;
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
  const {
    strong=false,
    highlight=false,
    paren=false,
    child=false,
    group='',
    hideZeroY0=false,
    key,
    meta=null,
    isSubtotal=false,
    isCore=false
  } = options;

  const rowMeta = meta || {};
  const rowKey = key || label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const row = {
    key: rowKey,
    label,
    group,
    isSubtotal,
    isCore: isCore || CF_CORE_KEYS.has(rowKey),
    amountsByYear: values,
    responsibility: rowMeta.resp || null,
    meta: rowMeta
  };

  if (cfShouldHideRow(row, showHidden)) return '';
  renderedRowKeys.add(rowKey);

  const cls = [highlight ? 'em-row' : '', child ? 'child-row' : '', group ? `child-of-${group}` : '']
    .filter(Boolean).join(' ');
  let lbl = strong ? `<strong>${label}</strong>` : label;
  if (rowMeta.resp) {
    const badge = cfBadgeText(rowMeta.resp, rowMeta.sharePct);
    if (badge) lbl += ` <span class="pill pill-muted">${badge}</span>`;
  }

  const unitAttr = rowMeta.unit ? ` data-unit="${rowMeta.unit}"` : '';
  const noteAttr = rowMeta.calcNote ? ` data-note="${encodeURIComponent(rowMeta.calcNote)}"` : '';

  const tds = allYears.map(y => {
    const raw = +values[y] || 0;
    const isZero = Math.abs(raw) < 1e-8;
    const display = isZero ? '—' : (paren ? fmtUSD0p(raw) : fmtUSD0(raw));
    const classes = [];
    if (isZero) classes.push('muted');
    if (hideZeroY0 && y === y0 && isZero) classes.push('y0-blank');
    const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
    return `<td${classAttr}${unitAttr}${noteAttr}>${display}</td>`;
  }).join('');

  const rowAttr = cls ? ` class="${cls}"` : '';
  return `<tr${rowAttr} data-row-key="${rowKey}"><th>${lbl}</th>${tds}</tr>`;
};

function expTotal(label, values, key, { strong=false, highlight=false, paren=false, hideZeroY0=false, meta=null, isCore=false } = {}) {
  const rowKey = key || label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const rowMeta = meta || {};
  const row = {
    key: rowKey,
    label,
    isSubtotal: true,
    isCore: isCore || CF_CORE_KEYS.has(rowKey),
    amountsByYear: values,
    responsibility: rowMeta.resp || null,
    meta: rowMeta
  };

  if (cfShouldHideRow(row, showHidden)) return '';
  renderedRowKeys.add(rowKey);

  const cls = ['exp-row', highlight ? 'em-row' : ''].filter(Boolean).join(' ');
  const lbl = strong ? `<strong>${label}</strong>` : label;
  const unitAttr = rowMeta.unit ? ` data-unit="${rowMeta.unit}"` : '';
  const noteAttr = rowMeta.calcNote ? ` data-note="${encodeURIComponent(rowMeta.calcNote)}"` : '';

  const tds = allYears.map(y => {
    const raw = +values[y] || 0;
    const isZero = Math.abs(raw) < 1e-8;
    const display = isZero ? '—' : (paren ? fmtUSD0p(raw) : fmtUSD0(raw));
    const classes = [];
    if (isZero) classes.push('muted');
    if (hideZeroY0 && y === y0 && isZero) classes.push('y0-blank');
    const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
    return `<td${classAttr}${unitAttr}${noteAttr}>${display}</td>`;
  }).join('');

  if (!key) return `<tr class="${cls}" data-row-key="${rowKey}"><th>${lbl}</th>${tds}</tr>`;
  const btn = `<button class="twisty subtotal-toggle expanded" data-exp="${key}" aria-expanded="true" aria-label="Collapse ${label} subtotal"><span class="chevron" aria-hidden="true">▾</span></button>`;
  return `<tr class="${cls}" data-exp="${key}" data-row-key="${rowKey}">
    <th>${btn} ${lbl}</th>${tds}
  </tr>`;
}

const perspective = perspectivePref;

const normalizeRespGlobal = (resp, fallback) => {
  if (typeof resp === 'string') return resp.toLowerCase();
  return fallback;
};
const normalizeShareGlobal = (val) => {
  let num = (typeof val === 'string') ? parseFloat(val) : val;
  if (!Number.isFinite(num)) num = 0.5;
  if (num > 1) num = num / 100;
  if (num < 0) num = 0;
  if (num > 1) num = 1;
  return num;
};
const zeroMapGlobal = (yearsArr) => Object.fromEntries(yearsArr.map(y => [y, 0]));
const addToMapGlobal = (target, source, yearsArr) => {
  yearsArr.forEach(y => {
    target[y] = (target[y] || 0) + (+source[y] || 0);
  });
};

  // Tenant view CapEx pieces
const allowYrTenant = {};
allYears.forEach(y => {
  allowYrTenant[y] = (y === y0) ? freeAllowanceY0 : 0;
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
  const finTIY0    = financedPrincipal;                  // landlord financed TI in Y0

  const buildOutYr = Object.fromEntries(allYears.map(y => [y, (y === y0 ? -totalCapex : 0)])); // negative (tenant outflow)
  const freeTIYr   = Object.fromEntries(allYears.map(y => [y, landlordFreeTotals[y] || 0]));  // positive (LL covers)
  const finTIYr    = Object.fromEntries(allYears.map(y => [y, (y === y0 ?  finTIY0   : 0)]));  // positive (LL finances)

  if (perspective === 'tenant' && tiCash > 0 && Math.abs(freeTIYr[tiYearKey] || 0) < 1e-8) {
    freeTIYr[tiYearKey] = tiCash;
  }

  const netDue = Object.fromEntries(allYears.map(y => [
    y, (buildOutYr[y] || 0) + (freeTIYr[y] || 0) + (finTIYr[y] || 0)
  ]));

  const upfrontBlock = [
    rowHTML('Build-Out Costs',              buildOutYr, { paren:true, child:true, group:'upfront' }),
    rowHTML('Landlord Free TI',             freeTIYr,   { key:'tenant_free_ti', child:true, group:'upfront', isCore:true, meta:{ calcNote: tiCash > 0 ? 'Allowance shown regardless of itemized budget' : undefined } }),
    rowHTML('Landlord Financed TI',         finTIYr,    { key:'tenant_financed_ti', child:true, group:'upfront' }),
    expTotal('Net Tenant Cash Due at Possession', netDue, 'upfront',
             { strong:true, highlight:true, paren:true })
  ].filter(Boolean);

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

  const zeroMap = () => zeroMapGlobal(allYears);
  const addToMap = (target, source) => addToMapGlobal(target, source, allYears);

  const tenantOpexContribution = zeroMap();
  const opxDetail = [];
  const pushTenantOpexRow = ({ key, label, total, respField, shareField }) => {
    const resp = normalizeRespGlobal(model?.[respField], 'tenant') || 'tenant';
    const route = cfRoute('tenant', resp);
    if (route === 'hide') return;
    const sharePct = normalizeShareGlobal(model?.[shareField]);
    const share = route === 'split' ? sharePct : 1;
    const shareAmounts = cfShare(total, share);
    const negValsTenant = negSeries(shareAmounts);
    addToMap(tenantOpexContribution, negValsTenant);
    const meta = { unit: '$/SF/yr', resp, sharePct: route === 'split' ? sharePct : undefined };
    const html = rowHTML(label, negValsTenant, { key, child:true, group:'opx', paren:true, hideZeroY0:true, meta });
    if (html) opxDetail.push(html);
  };

  pushTenantOpexRow({ key: 'taxes', label: 'Taxes', total: totalTaxesAll, respField: 'taxesResp', shareField: 'taxesSharePct' });
  pushTenantOpexRow({ key: 'cam', label: 'CAM', total: totalCamAll, respField: 'camResp', shareField: 'camSharePct' });
  pushTenantOpexRow({ key: 'insurance', label: 'Insurance', total: totalInsAll, respField: 'insResp', shareField: 'insSharePct' });
  pushTenantOpexRow({ key: 'mgmt_fee', label: 'Mgmt Fee', total: totalMgmtAll, respField: 'mgmtFeeResp', shareField: 'mgmtFeeSharePct' });
  if (hasOther) {
    pushTenantOpexRow({ key: 'other_opex', label: 'Other OpEx', total: totalOtherAll, respField: 'otherOpExResp', shareField: 'otherOpExSharePct' });
  }

  const opxSubNeg = {};
  allYears.forEach(y => {
    opxSubNeg[y] = tenantOpexContribution[y] || 0;
    if (y === y0) opxSubNeg[y] = 0;
  });

  const opxBlock = [
    ...opxDetail,
    expTotal('NNN / OpEx', opxSubNeg, 'opx', { strong:true, highlight:true, paren:true, hideZeroY0:true, isCore:true })
  ].filter(Boolean);

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
    rowHTML('Base Rent',              baseNeg,    { key:'base_rent', paren:true, hideZeroY0:true, isCore:true }),
    rowHTML('Amortized TI Payment',   tiAmortNeg, { key:'amortized_ti_payment', paren:true, hideZeroY0:true }),
    ...opxBlock,
    expTotal('Total Occupancy Cost',  occCost,    null, { strong:true, highlight:true, paren:true, isCore:true }),

    // Cumulative
    rowHTML('Cumulative Occupancy Cost', cumOcc,  { key:'cumulative_cash_flow', strong:true, highlight:true, paren:true, isCore:true })
  ].filter(Boolean);

  if ((model.tiAllowanceTotal ?? 0) > 0 || (model.tiAllowancePSF ?? 0) > 0) {
    console.assert(renderedRowKeys.has('tenant_free_ti') || renderedRowKeys.has('free_ti_allowance'),
      'TI row should be visible when TI>0');
  }
  if (model.taxesResp === 'tenant') {
    console.assert(renderedRowKeys.has('taxes'), 'Taxes should appear in tenant view when tenant-paid');
  }
  if (model.taxesResp === 'landlord') {
    console.assert(!renderedRowKeys.has('taxes'), 'Taxes should be hidden in tenant view when LL-paid');
  }
  if (model.taxesResp === 'split') {
    console.assert(renderedRowKeys.has('taxes'), 'Taxes should appear in both views when split');
  }

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
const financedTIY0 = financedPrincipal;

const initFree = Object.fromEntries(allYears.map(y => [y, -(freeTIAllowanceTotals[y] || 0)]));
const initFin  = Object.fromEntries(allYears.map(y => [y, (y === y0 ? -financedTIY0 : 0)]));
if (perspective === 'landlord' && tiCash > 0 && Math.abs(initFree[tiYearKey] || 0) < 1e-8) {
  initFree[tiYearKey] = -tiCash;
}
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
const recovDetail = [];
const pushRecoveryRow = ({ key, label, values, respField, shareField }) => {
  const resp = normalizeRespGlobal(model?.[respField], 'tenant') || 'tenant';
  const route = cfRoute('landlord', resp);
  if (route === 'hide' || resp === 'landlord') return;
  const sharePct = normalizeShareGlobal(model?.[shareField]);
  const meta = { unit: '$/SF/yr', resp, sharePct: route === 'split' ? sharePct : undefined };
  const html = rowHTML(label, values, { key, child:true, group:'rec', hideZeroY0:true, meta });
  if (html) recovDetail.push(html);
};

pushRecoveryRow({ key: 'taxes', label: 'Taxes', values: taxesT, respField: 'taxesResp', shareField: 'taxesSharePct' });
pushRecoveryRow({ key: 'cam', label: 'CAM', values: camT, respField: 'camResp', shareField: 'camSharePct' });
pushRecoveryRow({ key: 'insurance', label: 'Insurance', values: insT, respField: 'insResp', shareField: 'insSharePct' });
pushRecoveryRow({ key: 'mgmt_fee', label: 'Mgmt Fee', values: mgmtT, respField: 'mgmtFeeResp', shareField: 'mgmtFeeSharePct' });
if (hasOther) {
  pushRecoveryRow({ key: 'other_opex', label: 'Other OpEx', values: otherT, respField: 'otherOpExResp', shareField: 'otherOpExSharePct' });
}

// LL Operating Cost (detail; shown as negatives)
const llOpxDetail = [];
const pushLLOpexRow = ({ key, label, values, respField, shareField }) => {
  const resp = normalizeRespGlobal(model?.[respField], 'tenant') || 'tenant';
  const route = cfRoute('landlord', resp);
  if (route === 'hide') return;
  const sharePct = normalizeShareGlobal(model?.[shareField]);
  const meta = { unit: '$/SF/yr', resp, sharePct: route === 'split' ? (1 - sharePct) : undefined };
  const html = rowHTML(label, negVals(values), { key, child:true, group:'llopx', paren:true, hideZeroY0:true, meta });
  if (html) llOpxDetail.push(html);
};

pushLLOpexRow({ key: 'taxes', label: 'Taxes', values: taxesLL, respField: 'taxesResp', shareField: 'taxesSharePct' });
pushLLOpexRow({ key: 'cam', label: 'CAM', values: camLL, respField: 'camResp', shareField: 'camSharePct' });
pushLLOpexRow({ key: 'insurance', label: 'Insurance', values: insLL, respField: 'insResp', shareField: 'insSharePct' });
pushLLOpexRow({ key: 'mgmt_fee', label: 'Mgmt Fee', values: mgmtLL, respField: 'mgmtFeeResp', shareField: 'mgmtFeeSharePct' });
if (hasOther) {
  pushLLOpexRow({ key: 'other_opex', label: 'Other OpEx', values: otherLL, respField: 'otherOpExResp', shareField: 'otherOpExSharePct' });
}

// ------------------- Rows (order per spec) --------------------
const lines = [
  // Base rent stack
  rowHTML('Base Rent',
    Object.fromEntries(allYears.map(y => [y, (byY.get(y)?.basePre) || 0])),
    { key:'base_rent', hideZeroY0:true, isCore:true }
  ),
  rowHTML('Free Rent',
    Object.fromEntries(allYears.map(y => [y, -((byY.get(y)?.freeBase) || 0)])),
    { paren:true, hideZeroY0:true }
  ),
  rowHTML('Total Base Rent', totalBaseYr, { key:'total_base', strong:true, highlight:true, hideZeroY0:true, isCore:true }),

  // Additional TI Rent (top-line)
  rowHTML('Additional TI Rent', addlTI, { key:'addl_ti_rent', hideZeroY0:true }),

  // Recoveries (detail + subtotal)
  ...recovDetail,
  expTotal('Total Recoveries', recovSubtotal, 'rec', { strong:true, highlight:true, hideZeroY0:true }),

  // Total rent + recoveries
  rowHTML('Total Rent & Recoveries', totalRentRec, { key:'rent_recoveries_total', strong:true, highlight:true, hideZeroY0:true, isCore:true }),

  // Unrecoverable LL Opex and NOI
  ...llOpxDetail,
  expTotal('Landlord Operating Cost (Unrecoverable)', llOpxNeg, 'llopx',
    { strong:true, highlight:true, paren:true, hideZeroY0:true }),
  rowHTML('Net Operating Income (NOI)', noi, { key:'noi', strong:true, highlight:true, hideZeroY0:true, isCore:true }),

  // Initial TI Outlay block (Y0 only)
  rowHTML('Free TI / Improvement Allowance', initFree, { key:'free_ti_allowance', paren:true, isCore:true, meta:{ calcNote: tiCash > 0 ? 'Allowance shown regardless of itemized budget' : undefined } }),
  rowHTML('Financed TI Funded by Landlord',  initFin,  { key:'ll_financed_ti', paren:true }),
  rowHTML('Total Initial TI Outlay',         initTI,   { paren:true, strong:true, highlight:true }),

  // Optional: show commissions (kept separate for transparency)
  ...( (+kpis.commissionNominal||0)
      ? [ rowHTML('Lease Commissions',
                  Object.fromEntries(allYears.map(y => [y, (y === y0 ? -(+kpis.commissionNominal||0) : 0)])),
                  { paren:true }) ]
      : [] ),

  // Cash flows
    rowHTML('Net Cash Flow (before debt)', cash, { key:'net_cash_flow', strong:true, highlight:true, paren:true, isCore:true }),
  rowHTML('Cumulative Cash Flow',        cum,  { key:'cumulative_cash_flow', strong:true, highlight:true, paren:true, isCore:true })
].filter(Boolean);

if ((model.tiAllowanceTotal ?? 0) > 0 || (model.tiAllowancePSF ?? 0) > 0) {
  console.assert(renderedRowKeys.has('free_ti_allowance') || renderedRowKeys.has('tenant_free_ti'),
    'TI row should be visible when TI>0');
}
if (model.taxesResp === 'tenant') {
  console.assert(!renderedRowKeys.has('taxes'), 'Taxes should be hidden in landlord view when tenant-paid');
}
if (model.taxesResp === 'landlord') {
  console.assert(renderedRowKeys.has('taxes'), 'Taxes should appear in landlord view when LL-paid');
}
if (model.taxesResp === 'split') {
  console.assert(renderedRowKeys.has('taxes'), 'Taxes should appear in both views when split');
}

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
  const stored = getStore()[i];
  if (!stored) return;

  const scenario = JSON.parse(JSON.stringify(stored));
  emit('ner:scenario-load', { model: scenario, slot: i });

  const applied = typeof window.applyModelToForm === 'function'
    ? window.applyModelToForm(scenario)
    : false;

  if (applied && typeof window.calculate === 'function') {
    window.calculate();
  } else {
    window.__ner_last = scenario;
  }
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
  const count = deriveVisibleSlotCount(store);
  updateCompareTitle(count);

  const compareModels = [];
  let html = '';
  for (let i = 0; i < count; i++) {
    let m = store[i];
    if (!m || isStaleModel(m)) m = window.__ner_last || m; // prefer live model if stale
    if (m && Array.isArray(m.schedule) && m.schedule.length) {
      compareModels.push({
        model: m,
        title: scenarioTitle(m, i),
        photoUrl: m.photoDataURL || null,
        slot: i,
        kpi: m.kpis || null
      });
    }
    html += m ? renderScenarioRow(i, m) : renderEmptyRow(i);
  }
  host.innerHTML = html;

  window.__compareModels = compareModels;
  const summaryToggle = document.getElementById('toggleHiddenRows');
  if (typeof window.renderComparisonSummary === 'function') {
    window.renderComparisonSummary({ showHidden: !!summaryToggle?.checked });
  }

  host.querySelectorAll('td[data-unit], td[data-note]').forEach(td => {
    cfSetTooltip(td, td.dataset.unit, td.dataset.note);
  });

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

// ====== COMPARISON SUMMARY ======
(function(){
  function _getCompareModels() {
    return Array.isArray(window.__compareModels) ? window.__compareModels : [];
  }

  function currentPerspective() {
    try {
      const stored = localStorage.getItem('ner_perspective');
      return stored === 'tenant' ? 'tenant' : 'landlord';
    } catch (_) {
      return 'landlord';
    }
  }

  const escapeHtml = (str = '') => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const stripTags = (str = '') => String(str).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const chip = (txt, cls = '') => `<span class="chip ${cls}">${escapeHtml(txt)}</span>`;
  const photo = (url) => {
    const safeUrl = url ? escapeHtml(url) : '';
    const img = safeUrl
      ? `<img src="${safeUrl}" alt="Scenario photo" onerror="this.style.display='none'">`
      : '';
    const stateClass = safeUrl ? '' : ' placeholder';
    const fallback = safeUrl ? '' : '<span class="photo-placeholder">No photo</span>';
    return `<div class="summary-card-photo${stateClass}">${img || fallback}</div>`;
  };

  function formatPlacementText(raw) {
    if (!raw) return '';
    const lower = String(raw).toLowerCase();
    if (lower === 'outside') return 'outside the term';
    if (lower === 'inside') return 'inside the term';
    return raw;
  }

  function computeKpisForModel(modelLike, meta) {
    const model = modelLike || {};
    const raw = model.kpis || {};
    const timing = (typeof window.getLeaseTimingSummary === 'function')
      ? window.getLeaseTimingSummary(model)
      : null;

    const toNumber = (val) => {
      const num = Number(val);
      return Number.isFinite(num) ? num : null;
    };

    const termMonths = toNumber(raw.termMonths ?? timing?.termMonths ?? model.termMonths);
    const freeMonths = toNumber(raw.freeMonths ?? timing?.freeMonths ?? 0);
    const freePlacement = (raw.freePlacement || timing?.freePlacement || '').toLowerCase() || null;
    const startNet = toNumber(raw.startNetAnnualPSF ?? model.startNetAnnualPSF);
    const escalationPct = toNumber(raw.escalationPct);
    const totalBaseRent = toNumber(raw.totalBaseRentNominal ?? model.totalPaidNet);
    const freeRentValue = toNumber(raw.freeRentValueNominal ?? raw.freeGrossNominal);
    const avgMonthlyNet = toNumber(raw.avgMonthlyNet ?? model.avgNetMonthly);
    const opexStartPSF = toNumber(raw.opexStartPSF);
    const opexEscPct = toNumber(raw.opexEscalationPct);
    const tiAllowance = toNumber(raw.tiAllowanceTotal);
    const netTenantCashAtPos = toNumber(raw.netTenantCashAtPos);
    const nerPVVal = toNumber(raw.nerPV ?? model.nerPV);
    const nerNonPVVal = toNumber(raw.nerNonPV ?? model.simpleNet);
    const firstMonthRent = toNumber(raw.firstMonthRent);
    const lastMonthRent = toNumber(raw.lastMonthRent);
    const peakMonthly = toNumber(raw.peakMonthly);
    const chipsRaw = Array.isArray(raw.summaryChips) && raw.summaryChips.length
      ? raw.summaryChips
      : (timing?.chips || []);
    const startDate = timing?.startDate || raw.startDate || model.startDate || model.commencementDate || null;
    const endDate = timing?.endDate || raw.endDate || model.endDate || null;

    return {
      termMonths,
      freeMonths,
      freePlacement,
      startNet,
      escalationPct,
      totalBaseRent,
      freeRentValue,
      avgMonthlyNet,
      opexStartPSF,
      opexEscPct,
      tiAllowance,
      netTenantCashAtPos,
      nerPV: nerPVVal,
      nerNonPV: nerNonPVVal,
      firstMonthRent,
      lastMonthRent,
      peakMonthly,
      chips: chipsRaw,
      startDate,
      endDate,
      title: meta?.title || scenarioTitle(model, meta?.slot ?? 0),
      photoUrl: meta?.photoUrl || model.photoDataURL || null,
      slot: meta?.slot
    };
  }

  const METRICS = [
    { key: 'term', group: 'Deal Basics', label: 'Term (months)',
      better: { tenant: 'lower', landlord: 'lower' },
      calc: ({ kpi }) => kpi.termMonths,
      fmt: (v, ctx) => {
        const monthsText = _fmtInt(v);
        const safeMonths = escapeHtml(monthsText);
        const start = fmtDate(ctx?.kpi?.startDate);
        const end = fmtDate(ctx?.kpi?.endDate);
        const hasRange = start !== '—' && end !== '—';
        let rangeHtml = '';
        if (hasRange) {
          const range = `${start} – ${end}`;
          const safeRange = escapeHtml(range);
          rangeHtml = `<span class="chip summary-term-range" title="${safeRange}">${safeRange}</span>`;
        }
        return `<span class="summary-term-cell"><span class="summary-term-value">${safeMonths}</span>${rangeHtml}</span>`;
      }
    },
    { key: 'freeMonths', group: 'Deal Basics', label: 'Free Months (inside/outside)',
      better: { tenant: 'higher', landlord: 'lower' },
      calc: ({ kpi }) => kpi.freeMonths,
      fmt: (v, ctx) => {
        const base = _fmtInt(v);
        if (base === '—') return base;
        const placement = ctx.kpi.freePlacement
          ? chip(formatPlacementText(ctx.kpi.freePlacement), ctx.kpi.freePlacement === 'outside' ? 'red' : '')
          : '';
        return placement ? `${base} ${placement}` : base;
      }
    },
    { key: 'startRate', group: 'Deal Basics', label: 'Start Net Rate ($/SF/yr)',
      better: { tenant: 'lower', landlord: 'higher' },
      calc: ({ kpi }) => kpi.startNet,
      fmt: _fmtPSF
    },
    { key: 'escalation', group: 'Deal Basics', label: 'Escalation',
      better: { tenant: 'lower', landlord: 'lower' },
      calc: ({ kpi }) => kpi.escalationPct,
      fmt: _fmtPct
    },
    { key: 'totalBase', group: 'Rent Totals', label: 'Total Base Rent ($)',
      better: { tenant: 'lower', landlord: 'higher' },
      calc: ({ kpi }) => kpi.totalBaseRent,
      fmt: _fmtMoney
    },
    { key: 'freeVal', group: 'Rent Totals', label: 'Free Rent Value ($)',
      better: { tenant: 'higher', landlord: 'higher' },
      calc: ({ kpi, perspective }) => {
        const val = kpi.freeRentValue || 0;
        return perspective === 'landlord' ? -val : val;
      },
      fmt: _fmtMoney
    },
    { key: 'avgNet', group: 'Rent Totals', label: 'Avg Monthly Net ($)',
      better: { tenant: 'lower', landlord: 'higher' },
      calc: ({ kpi }) => kpi.avgMonthlyNet,
      fmt: _fmtMoney
    },
    { key: 'opexStart', group: 'OpEx / Recoveries', label: 'OpEx Start ($/SF/yr)',
      better: { tenant: 'lower', landlord: 'lower' },
      calc: ({ kpi }) => kpi.opexStartPSF,
      fmt: _fmtPSF
    },
    { key: 'opexEsc', group: 'OpEx / Recoveries', label: 'OpEx Escalation',
      better: { tenant: 'lower', landlord: 'lower' },
      calc: ({ kpi }) => kpi.opexEscPct,
      fmt: _fmtPct
    },
    { key: 'tiAllowance', group: 'TI & Cash at Possession', label: 'TI Allowance (Free TI) ($)',
      better: { tenant: 'higher', landlord: 'higher' },
      calc: ({ kpi, perspective }) => {
        const val = kpi.tiAllowance || 0;
        return perspective === 'landlord' ? -val : val;
      },
      fmt: _fmtMoney
    },
    { key: 'tenantCash', group: 'TI & Cash at Possession', label: 'Net Tenant Cash Due at Possession ($)',
      better: { tenant: 'abs-lower', landlord: 'abs-lower' },
      calc: ({ kpi, perspective }) => {
        const val = kpi.netTenantCashAtPos || 0;
        return perspective === 'landlord' ? -val : val;
      },
      fmt: _fmtMoney
    },
    { key: 'nerPV', group: 'Effective Economics', label: 'NER (PV) ($/SF/yr)',
      better: { tenant: 'lower', landlord: 'higher' },
      calc: ({ kpi }) => kpi.nerPV,
      fmt: _fmtPSF
    },
    { key: 'ner', group: 'Effective Economics', label: 'NER (non-PV) ($/SF/yr)',
      better: { tenant: 'lower', landlord: 'higher' },
      calc: ({ kpi }) => kpi.nerNonPV,
      fmt: _fmtPSF
    },
    { key: 'first', group: 'First / Last / Peak', label: "First Month's Rent ($)",
      better: { tenant: 'lower', landlord: 'higher' },
      calc: ({ kpi }) => kpi.firstMonthRent,
      fmt: _fmtMoney
    },
    { key: 'last', group: 'First / Last / Peak', label: "Last Month's Rent ($)",
      better: { tenant: 'lower', landlord: 'higher' },
      calc: ({ kpi }) => kpi.lastMonthRent,
      fmt: _fmtMoney
    },
    { key: 'peak', group: 'First / Last / Peak', label: 'Peak Monthly Obligation ($)',
      better: { tenant: 'lower', landlord: 'higher' },
      calc: ({ kpi }) => kpi.peakMonthly,
      fmt: _fmtMoney
    }
  ];

  function shouldHideRow(values) {
    return values.every(v => {
      if (v == null) return true;
      if (typeof v === 'string') return v.trim().length === 0;
      if (typeof v === 'object') return false;
      const num = Number(v);
      if (!Number.isFinite(num)) return true;
      return Math.abs(num) < 1e-6;
    });
  }

  function resolveBetter(metric, perspective) {
    if (!metric) return 'lower';
    if (metric.better === 'none') return 'none';
    if (!metric.better) return 'lower';
    if (typeof metric.better === 'string') return metric.better;
    return metric.better[perspective] || metric.better.landlord || 'lower';
  }

  function toSortValue(val, better, desc) {
    if (val == null || !Number.isFinite(Number(val))) {
      return desc ? -Infinity : Infinity;
    }
    const num = Number(val);
    if (better === 'abs-lower') return Math.abs(num);
    return num;
  }

  function buildSummaryTable(entries, { showHidden = false, perspective }) {
    const theadCols = entries.map(({ kpi }) => {
      const termValue = Number(kpi.termMonths);
      const freeValue = Number(kpi.freeMonths);
      const termChip = Number.isFinite(termValue) && termValue >= 0
        ? chip(`Term ${_fmtInt(termValue)} mo`)
        : '';
      const freeChip = Number.isFinite(freeValue) && freeValue >= 0
        ? chip(`${_fmtInt(freeValue)} mo free`)
        : '';
      const placementChip = kpi.freePlacement
        ? chip(formatPlacementText(kpi.freePlacement), kpi.freePlacement === 'outside' ? 'red' : '')
        : '';
      const chipHtml = [termChip, freeChip, placementChip].filter(Boolean).join(' ');
      const safeTitle = escapeHtml(kpi.title || 'Scenario');
      const chipsTitle = chipHtml ? stripTags(chipHtml) : '';
      return `
        <th class="col-card">
          <div class="summary-card" role="group" aria-label="${safeTitle}">
            ${photo(kpi.photoUrl)}
            <div class="summary-card-title" title="${safeTitle}">${safeTitle}</div>
            <div class="summary-card-chips"${chipsTitle ? ` title="${escapeHtml(chipsTitle)}"` : ''}>${chipHtml}</div>
          </div>
        </th>`;
    }).join('');

    const groups = [...new Set(METRICS.map(m => m.group))];
    let tbodyHTML = '';

    groups.forEach(group => {
      const safeGroup = escapeHtml(group);
      tbodyHTML += `
        <tr class="group-row">
          <td colspan="${entries.length + 1}">
            <div class="section-header-bar" role="heading" aria-level="3">
              <span class="section-header-label">${safeGroup}</span>
            </div>
          </td>
        </tr>`;
      METRICS.filter(m => m.group === group).forEach(metric => {
        const rawVals = entries.map(entry => metric.calc({ kpi: entry.kpi, model: entry.model, perspective }));
        const hidden = shouldHideRow(rawVals);
        if (hidden && !showHidden) return;
        const better = resolveBetter(metric, perspective);
        const bestIdx = better === 'none' ? -1 : pickBest(rawVals, better);
        const sortableClass = metric.sortable === false ? '' : ' sortable';
        const labelTitle = escapeHtml(metric.label);
        const labelCell = `<td class="metric-col${sortableClass}" data-metric="${metric.key}" title="${labelTitle}">${metric.label}</td>`;
        const cells = rawVals.map((val, idx) => {
          const ctx = entries[idx];
          const formatted = metric.fmt ? metric.fmt(val, { kpi: ctx.kpi, model: ctx.model, perspective }) : (val ?? '—');
          const numeric = Number(val);
          const isNumeric = Number.isFinite(numeric);
          const numericHasValue = isNumeric && Math.abs(numeric) >= 1e-6;
          let textualHasValue = false;
          if (!isNumeric) {
            if (val == null) {
              textualHasValue = false;
            } else if (typeof val === 'object') {
              textualHasValue = true;
            } else {
              textualHasValue = String(val).trim().length > 0;
            }
          }
          const hasDisplayValue = numericHasValue || textualHasValue;
          const bestClass = (idx === bestIdx && numericHasValue) ? 'best' : '';
          const dimClass = hasDisplayValue ? '' : 'dim';
          const cellTitle = stripTags(formatted);
          const titleAttr = cellTitle ? ` title="${escapeHtml(cellTitle)}"` : '';
          return `<td class="${bestClass} ${dimClass}"${titleAttr}>${formatted}</td>`;
        }).join('');
        tbodyHTML += `<tr data-row="${metric.key}">${labelCell}${cells}</tr>`;
      });
    });

    return `
      <div class="summary-grid">
        <table>
          <thead>
            <tr>
              <th class="metric-col"></th>
              ${theadCols}
            </tr>
          </thead>
          <tbody>${tbodyHTML}</tbody>
        </table>
      </div>`;
  }

  let summaryUnderlayRaf = null;

  const summaryViewportState = {
    grid: null,
    columnCount: 0
  };

  function scheduleSummaryUnderlayUpdate() {
    if (summaryUnderlayRaf != null) {
      cancelAnimationFrame(summaryUnderlayRaf);
    }
    summaryUnderlayRaf = requestAnimationFrame(() => {
      summaryUnderlayRaf = null;
      updateSummaryUnderlays();
    });
  }

  function ensureUnderlayHost(grid) {
    if (!grid) return null;
    let host = grid.querySelector('.summary-col-underlays');
    if (!host) {
      host = document.createElement('div');
      host.className = 'summary-col-underlays';
      // host sits under the scrollable table so column backgrounds remain in one layer
      grid.insertAdjacentElement('afterbegin', host);
    }
    return host;
  }

  function configureSummaryViewport(grid, columnCount) {
    if (!grid) return;

    const table = grid.querySelector('table');
    if (!table) return;

    const computed = getComputedStyle(grid);
    const parse = (value) => {
      const num = Number.parseFloat(value);
      return Number.isFinite(num) ? num : 0;
    };

    const padding = parse(computed.paddingLeft) + parse(computed.paddingRight);
    const border = parse(computed.borderLeftWidth) + parse(computed.borderRightWidth);
    const usableWidth = Math.max(0, grid.clientWidth - padding - border);
    const labelWidth = parse(computed.getPropertyValue('--summary-label-width')) || 260;
    const cardWidth = Math.max(280, Math.floor((usableWidth - labelWidth) / 3));
    const visible = Math.max(1, Math.min(columnCount, 3));
    const overflow = columnCount > visible;

    grid.style.setProperty('--summary-card-width', `${cardWidth}px`);
    grid.style.setProperty('--summary-visible-count', String(visible));
    grid.style.setProperty('--summary-overflow', overflow ? '1' : '0');

    if (overflow) {
      grid.classList.add('summary-overflow');
      grid.setAttribute('data-summary-overflow', 'true');
      grid.style.setProperty('--summary-scroll-pad-end', '0px');
    } else {
      grid.classList.remove('summary-overflow');
      grid.removeAttribute('data-summary-overflow');
      grid.style.removeProperty('--summary-scroll-pad-end');
    }

    const totalWidth = labelWidth + 3 * cardWidth;
    table.style.minWidth = `${totalWidth}px`;
    table.style.maxWidth = `${totalWidth}px`;
  }

  function refreshSummaryViewport() {
    const { grid, columnCount } = summaryViewportState;
    if (!grid || !grid.isConnected) return;
    configureSummaryViewport(grid, columnCount);
  }

  function updateSummaryUnderlays() {
    const mount = document.getElementById('comparisonSummary');
    if (!mount) return;
    const wrap = mount.querySelector('.summary-wrap');
    const grid = wrap?.querySelector('.summary-grid');
    const table = grid?.querySelector('table');
    if (!wrap || !grid || !table) return;

    const headers = table.querySelectorAll('thead th.col-card');
    if (!headers.length) return;

    const dataRows = Array.from(table.querySelectorAll('tbody tr[data-row]'));
    const rows = dataRows.length ? dataRows : Array.from(table.querySelectorAll('tbody tr'));
    if (!rows.length) return;

    const host = ensureUnderlayHost(grid);
    if (!host) return;

    const gridRect = grid.getBoundingClientRect();
    const scrollLeft = grid.scrollLeft;
    const scrollTop = grid.scrollTop;

    const dpr = window.devicePixelRatio || 1;
    const snap = (value) => Math.round(value * dpr) / dpr;

    const headerRect = headers[0].getBoundingClientRect();
    const firstRect = rows[0].getBoundingClientRect();
    const lastRect = rows[rows.length - 1].getBoundingClientRect();

    const top = snap(Math.min(headerRect.top, firstRect.top) - gridRect.top + scrollTop);
    const bottom = snap(Math.max(lastRect.bottom, headerRect.bottom) - gridRect.top + scrollTop);
    const height = Math.max(0, bottom - top);

    const existing = Array.from(host.children);
    const needed = headers.length;

    if (existing.length > needed) {
      existing.slice(needed).forEach(node => node.remove());
    }

    while (host.children.length < needed) {
      const bg = document.createElement('div');
      bg.className = 'summary-col-bg';
      host.appendChild(bg);
    }

    let leaderIdx = -1;
    const sortState = window.__summarySort;
    if (sortState?.metric) {
      const metricRow = rows.find(row => row.dataset?.row === sortState.metric);
      if (metricRow) {
        const cells = Array.from(metricRow.querySelectorAll('td'));
        const bestCell = cells.find(cell => cell.classList.contains('best'));
        if (bestCell) {
          const cellIdx = cells.indexOf(bestCell);
          if (cellIdx > 0) {
            leaderIdx = cellIdx - 1;
          }
        }
      }
    }

    Array.from(host.children).forEach((node, idx) => {
      const header = headers[idx];
      const rect = header.getBoundingClientRect();
      const left = snap(rect.left - gridRect.left + scrollLeft);
      const width = snap(rect.width);
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.style.width = `${width}px`;
      node.style.height = `${height}px`;
      node.classList.toggle('is-leader', idx === leaderIdx);
    });
  }

  window.renderComparisonSummary = function renderComparisonSummary({ showHidden = false } = {}) {
    const mount = document.getElementById('comparisonSummary');
    if (!mount) return;

    const models = _getCompareModels();
    if (!models.length) {
      mount.innerHTML = '<div class="summary-wrap"><div class="summary-grid"><div class="note" style="padding:16px;">Pin scenarios to compare.</div></div></div>';
      const grid = mount.querySelector('.summary-grid');
      summaryViewportState.grid = grid || null;
      summaryViewportState.columnCount = 0;
      if (grid) {
        configureSummaryViewport(grid, 0);
      }
      scheduleSummaryUnderlayUpdate();
      return;
    }

    const perspective = currentPerspective();
    const entries = models.map((meta, idx) => {
      const model = meta.model || meta;
      const kpi = computeKpisForModel(model, meta);
      return { model, kpi: { ...kpi, title: kpi.title || scenarioTitle(model, meta.slot ?? idx), photoUrl: kpi.photoUrl }, meta };
    });

    const sortState = window.__summarySort || { metric: null, desc: false };
    const metricDef = sortState.metric ? METRICS.find(m => m.key === sortState.metric) : null;
    let ordered = entries.slice();
    if (metricDef) {
      const better = resolveBetter(metricDef, perspective);
      ordered.sort((a, b) => {
        const va = metricDef.calc({ kpi: a.kpi, model: a.model, perspective });
        const vb = metricDef.calc({ kpi: b.kpi, model: b.model, perspective });
        const svA = toSortValue(va, better, sortState.desc);
        const svB = toSortValue(vb, better, sortState.desc);
        return sortState.desc ? (svB - svA) : (svA - svB);
      });
    }

    const columnCount = ordered.length;
    const html = buildSummaryTable(ordered, { showHidden, perspective });
    mount.innerHTML = `<div class="summary-wrap">${html}</div>`;

    mount.querySelectorAll('.metric-col.sortable').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.metric;
        if (!key) return;
        const state = window.__summarySort || { metric: null, desc: false };
        if (state.metric === key) {
          state.desc = !state.desc;
        } else {
          state.metric = key;
          state.desc = false;
        }
        window.__summarySort = state;
        const toggle = document.getElementById('toggleHiddenRows');
        window.renderComparisonSummary({ showHidden: !!toggle?.checked });
      });
    });

    const grid = mount.querySelector('.summary-grid');
    summaryViewportState.grid = grid || null;
    summaryViewportState.columnCount = grid ? columnCount : 0;

    if (grid) {
      configureSummaryViewport(grid, columnCount);
      scheduleSummaryUnderlayUpdate();

      if (!grid.hasAttribute('tabindex')) {
        grid.setAttribute('tabindex', '0');
        grid.setAttribute('role', 'region');
        grid.setAttribute('aria-label', 'Comparison summary scroll area');
      }
      grid.addEventListener('scroll', scheduleSummaryUnderlayUpdate, { passive: true });

      const wrap = mount.querySelector('.summary-wrap');
      if (window.__summaryResizeObserver) {
        window.__summaryResizeObserver.disconnect();
      }
      if (wrap) {
        const ro = new ResizeObserver(() => {
          configureSummaryViewport(grid, columnCount);
          scheduleSummaryUnderlayUpdate();
        });
        ro.observe(wrap);
        window.__summaryResizeObserver = ro;
      }

      requestAnimationFrame(() => {
        if (!grid.isConnected) return;
        configureSummaryViewport(grid, columnCount);
        scheduleSummaryUnderlayUpdate();
      });
    }
    if (!grid) {
      scheduleSummaryUnderlayUpdate();
    }
  };

  if (!window.__summaryUnderlayResizeBound) {
    window.addEventListener('resize', () => {
      refreshSummaryViewport();
      scheduleSummaryUnderlayUpdate();
    });
    window.__summaryUnderlayResizeBound = true;
  }
})();

/* ---------- boot ---------------------------------------------------------- */
function bootScenarios() {
  renderCompareGrid();
  window.addEventListener('ner:calculated', (ev) => {
    const detail = ev.detail || {};
    const model = detail.model;
    if (model) {
      window.__ner_last = model;
    }

    const intent = readAutoAddIntent();
    if (!intent.hasIntent) return;

    const isFresh = Number.isFinite(intent.ts) && (Date.now() - intent.ts) <= AUTO_ADD_STALE_MS;
    if (model && isFresh && !intent.programmatic) {
      autoAddScenarioFromModel(model);
    }

    resetAutoAddIntent();
  });

  const showHiddenToggle = document.getElementById('showHiddenRows');
  if (showHiddenToggle) {
    showHiddenToggle.addEventListener('change', renderCompareGrid);
  }

  // Expand all before printing / exporting PDF to ensure details show
  window.addEventListener('beforeprint', () => {
    document.querySelectorAll('#compareGrid .scenario-right .twisty').forEach(btn => {
      if (btn.getAttribute('aria-expanded') === 'false') btn.click();
    });
  });
}

// Expose for other modules
window.renderCompareGrid = renderCompareGrid;
window.__ner_resetAutoAddGuard = resetAutoAddGuard;

// DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootScenarios);
} else {
  bootScenarios();
}
