/**
 * ANNOTATIONS for Lease Calculator (pre-refactor)
 * Annotated on 2025-10-17 17:31 — js/charts.js
 *  These notes are additive and do not change behavior.
 * 
 */

/* charts.js  — Chart.js dashboards for the Lease NER Calculator
 *
 * Expected model: window.__ner_last created by calculate()
 *  - area, term (months), discount (annual %), perspective, type
 *  - schedule: [{ isoYM, calYear, year, month, monthIndex, isAbated, isGrossAbated,
 *                 netTotal, grossTotal, netPSF, taxesPSF, camPSF, insPSF,
 *                 contractNetAnnualPSF, contractTaxesAnnualPSF, contractCamAnnualPSF, contractInsAnnualPSF }]
 *  - pvRent, pvLLOpex, pvTIValue (TI*area), commissionTotal, concessionsPV
 *
 * This file is UI-agnostic: call charts.update(window.__ner_last) after calculate().
 */

/** Chart pack expects window.__ner_last; renders 5 analysis charts and provides PNG capture. */
(function () {
  // ---- Helpers -------------------------------------------------------------
  const fmtUSD = n => (isFinite(n) ? n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }) : "—");
  const clamp  = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const by    = (k) => (a,b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0);

  
/** Convert annual % to effective monthly rate for PV math. */
function annPctToMonthly(rAnnual) {
    const r = +rAnnual || 0;
    return Math.pow(1 + r, 1/12) - 1;
  }

  
/** PV of a dollar series given monthly discount rate. */
function calcPVFromSeries(values, rMonthly) {
    // values: array of dollars per month (index 0 = month 1)
    let pv = 0;
    const rm = +rMonthly || 0;
    for (let i = 0; i < values.length; i++) {
      pv += values[i] / Math.pow(1+rm, i);
    }
    return pv;
  }
      function hexA(color, a = 1) {
    if (!color) return `rgba(0,0,0,${a})`;
    const c = color.trim();

    // #RGB or #RRGGBB
    if (c[0] === '#') {
        const to255 = (s) => parseInt(s, 16);
        const r = c.length === 4 ? to255(c[1] + c[1]) : to255(c.slice(1, 3));
        const g = c.length === 4 ? to255(c[2] + c[2]) : to255(c.slice(3, 5));
        const b = c.length === 4 ? to255(c[3] + c[3]) : to255(c.slice(5, 7));
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    // rgb(...) or rgba(...)
    const m = c.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
        const [r, g, b] = m[1].split(',').map(s => s.trim());
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    // named color or css var -> let the browser resolve to rgb(...)
    const probe = document.createElement('span');
    probe.style.color = c;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color; // e.g. "rgb(59, 130, 246)"
    document.body.removeChild(probe);
    const mm = resolved.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    return mm ? `rgba(${mm[1]}, ${mm[2]}, ${mm[3]}, ${a})` : color;
    }

    // "2025-07" -> "07-25"
    function fmtMMYY(isoYM) {
    if (!isoYM) return "";
    const [yyyy, mm] = isoYM.split("-");
    return `${mm}-${yyyy.slice(-2)}`;
    }

    function getTheme() {
    const s = getComputedStyle(document.documentElement);
    const val = k => (s.getPropertyValue(k) || '').trim();
    return {
        text:  val('--text-1')  || '#e8eef7',
        grid:  val('--grid-1')  || 'rgba(255,255,255,.10)',
        base:  val('--accent-blue')  || '#3b82f6',
        taxes: val('--accent-gold')  || '#f59e0b',
        cam:   val('--accent-green') || '#22c55e',
        ins:   val('--accent-rose')  || '#f43f5e',
        slate: val('--accent-slate') || '#93c5fd',
        line:  val('--text-2') || '#a0acba'
    };
    }

    // Plugin to shade abated months behind a chart
    const ShadeAbatementPlugin = {
    id: 'shadeAbatement',
    beforeDatasetsDraw(chart, args, opts) {
        try {
        const { ctx, chartArea, scales } = chart;
        const idxs = (opts && opts.indices) || [];
        if (!idxs.length) return;

        const scale = scales.x;
        if (!scale) return;

        // derive a safe bar width
        let step = 0;
        if (typeof scale.getPixelForValue === 'function') {
            step = scale.getPixelForValue(1) - scale.getPixelForValue(0);
        }
        if (!isFinite(step) || step <= 0) {
            if (typeof scale.getPixelForTick === 'function') {
            step = scale.getPixelForTick(1) - scale.getPixelForTick(0);
            }
        }
        if (!isFinite(step) || step <= 0) return; // nothing to shade yet

        ctx.save();
        ctx.fillStyle = (opts && opts.color) || 'rgba(255,255,255,0.08)';
        idxs.forEach(i => {
            const cx = scale.getPixelForValue(i);
            const x  = cx - step / 2;
            ctx.fillRect(x, chartArea.top, step, chartArea.bottom - chartArea.top);
        });
        ctx.restore();
        } catch (_) {
        /* swallow – never block the chart */
        }
    }
    };

  // ---- Main class ----------------------------------------------------------
  
/** Caches Chart.js instances; adapts to dark theme via CSS variables. */
class NERCharts {
    /**
     * @param {Object} opts
     * @param {string} opts.cashflowId        canvas id for cash-flow chart
     * @param {string} opts.waterfallId       canvas id for pv waterfall
     * @param {string} opts.psfTrendId        canvas id for yearly psf trend
     * @param {string} opts.tornadoId         canvas id for tornado sensitivity
     * @param {string} opts.abatementId       canvas id for abatement timeline
     * @param {'gross'|'net'} [opts.cashTotalMode='gross']  overlay line on cashflow
     */
    constructor(opts = {}) {
      this.ids = {
        cashflow:  opts.cashflowId   || 'cfChart',
        waterfall: opts.waterfallId  || 'pvWaterfallChart',
        psfTrend:  opts.psfTrendId   || 'psfTrendChart',
        tornado:   opts.tornadoId    || 'tornadoChart',
        abatement: opts.abatementId  || 'abatementChart',
      };
      this.cashTotalMode = opts.cashTotalMode || 'gross';

      // register plugin once
      if (!Chart.registry.plugins.get('shadeAbatement')) {
        Chart.register(ShadeAbatementPlugin);
      }
        // THEME
        this.theme = getTheme();
        Chart.defaults.color = this.theme.text;
        Chart.defaults.borderColor = this.theme.grid;
      this._charts = {}; // keep instances to update instead of recreate
    }

    setCashTotalMode(mode) {
      this.cashTotalMode = (mode === 'net') ? 'net' : 'gross';
      if (this._model) this.
/** Cashflow (stacked Net/Taxes/CAM/Ins) with total overlay and abatement bands. */
_renderCashflow(this._model);
    }

    update(model) {
      if (!model || !model.schedule || !model.schedule.length) return;
      this._model = model;

      // Auto-pick the cash overlay based on perspective
      const isTenant = ((model.perspective || 'tenant') === 'tenant');
      this.setCashTotalMode(isTenant ? 'net' : 'gross');
      
      // sort by month index to be safe
      model.schedule.sort(by('monthIndex'));

      this._renderCashflow(model);
      this.
/** PV waterfall contrasting Tenant vs Landlord conventions. */
_renderWaterfall(model);
      this.
/** Yearly contract PSF trend, fallback to tenant-paid PSFs×12 if needed. */
_renderPSFTrend(model);
      this.
/** Sensitivity: ± FR, TI, Esc %, Discount, OpEx growth → ΔNER. */
_renderTornado(model);
      this.
/** Abatement timeline (Net vs Gross tracks). */
_renderAbatement(model);
    }

    // ---------- Cash-flow timeline (stacked) --------------------------------
    _renderCashflow(model) {
      const ctx = document.getElementById(this.ids.cashflow);
      if (!ctx) return;

      const area = +model.area || 0;
      const labels = model.schedule.map(r => fmtMMYY(r.isoYM));
      const base$  = model.schedule.map(s => +s.netTotal || 0);
      const taxes$ = model.schedule.map(s => (+(s.taxesPSF||0) * area));
      const cam$   = model.schedule.map(s => (+(s.camPSF||0)   * area));
      const ins$   = model.schedule.map(s => (+(s.insPSF||0)   * area));

      const totalLine = (this.cashTotalMode === 'net')
        ? base$
        : base$.map((b,i) => b + taxes$[i] + cam$[i] + ins$[i]);

      const abatedIdx = model.schedule
        .map((s,i) => (s.isAbated ? i : -1))
        .filter(i => i >= 0);

      const data = {
        labels,
        datasets: [
        { type:'bar', label:'Base',      data: base$,  backgroundColor: hexA(this.theme.base, .65),  stack:'cf' },
        { type:'bar', label:'Taxes',     data: taxes$, backgroundColor: hexA(this.theme.taxes,.65),  stack:'cf' },
        { type:'bar', label:'CAM',       data: cam$,   backgroundColor: hexA(this.theme.cam,  .65),  stack:'cf' },
        { type:'bar', label:'Insurance', data: ins$,   backgroundColor: hexA(this.theme.ins,  .65),  stack:'cf' },
        { type:'line', label:(this.cashTotalMode==='net'?'Total (Net)':'Total (Gross)'),
            data: totalLine, borderColor: this.theme.line, borderWidth: 2, pointRadius: 0, tension: .2, yAxisID:'y' }
        ]
      };

      const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtUSD(ctx.parsed.y)}` } },
          shadeAbatement: { indices: abatedIdx, color: 'rgba(255,255,255,0.08)' }
        },
        scales: {
          x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true } },
          y: { stacked: true, beginAtZero: true, ticks: { callback: v => fmtUSD(v) } }
        }
      };

      this._upsertChart('cashflow', ctx, data, options);
    }

    // ---------- PV Waterfall (Tenant vs Landlord) ---------------------------
    _renderWaterfall(model) {
      const ctx = document.getElementById(this.ids.waterfall);
      if (!ctx) return;

      const pvGross  = +model.pvRent || 0;
      const pvLLOpex = +model.pvLLOpex || 0;
      const pvTI     = +model.pvTIValue || ((+model.ti || 0) * (+model.area || 0));
      const pvComm   = +model.commissionTotal || 0;
      const showComm = !!model.includeBrokerComm;
      const isTenant = ((model.perspective || 'tenant') === 'tenant');
      // --- NEW: PV of tenant-paid OpEx from schedule ---
      const area     = +model.area || 0;
      const rMonthly = annPctToMonthly(+model.discount || 0);  // helper is already in this file
      const taxes$   = model.schedule.map(s => (+(s.taxesPSF||0) * area));
      const cam$     = model.schedule.map(s => (+(s.camPSF||0)   * area));
      const ins$     = model.schedule.map(s => (+(s.insPSF||0)   * area));
      const tenOpEx$ = taxes$.map((v,i) => v + cam$[i] + ins$[i]);
      const pvTenOpEx = calcPVFromSeries(tenOpEx$, rMonthly);

      // Build labels and steps in lockstep so both datasets align
      let labels, tenantSteps, landlordSteps;

      if (showComm) {
        labels = ['PV Gross Receipts', '− OpEx', '− TI', '− Commission', 'PV after concessions'];
        tenantSteps   = [ pvGross, -pvTenOpEx, -pvTI, 0, (pvGross - pvTenOpEx - pvTI) ];
        landlordSteps = [ pvGross, -pvLLOpex, -pvTI, -pvComm, (pvGross - pvLLOpex - pvTI - pvComm) ];
      } else {
        labels = ['PV Gross Receipts', '− OpEx', '− TI', 'PV after concessions'];
        tenantSteps   = [ pvGross, -pvTenOpEx, -pvTI, (pvGross - pvTenOpEx - pvTI) ];
        landlordSteps = [ pvGross, -pvLLOpex, -pvTI, (pvGross - pvLLOpex - pvTI) ];
      }

      // ONE color per series (matches legend). No per-bar arrays.
      const data = {
        labels,
        datasets: [
          {
            label: isTenant ? 'Tenant (active)' : 'Tenant',
            data: tenantSteps,
            backgroundColor: hexA(this.theme.base,  isTenant ? 0.95 : 0.35),
            borderColor:     hexA(this.theme.base,  isTenant ? 1.00 : 0.50),
            borderWidth: 1
          },
          {
            label: !isTenant ? 'Landlord (active)' : 'Landlord',
            data: landlordSteps,
            backgroundColor: hexA(this.theme.slate, !isTenant ? 0.95 : 0.35),
            borderColor:     hexA(this.theme.slate, !isTenant ? 1.00 : 0.50),
            borderWidth: 1
          }
        ]
      };

        const options = {
          responsive: true,
          maintainAspectRatio: false,

          // IMPORTANT: use index mode + no intersect so the tooltip always has an index
          interaction: { mode: 'index', intersect: false },

          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              // Only show the active perspective in the tooltip
              filter: (item) => {
                const activeLabel = isTenant ? 'Tenant' : 'Landlord';
                const dsLabel = (item && item.dataset && item.dataset.label) ? String(item.dataset.label) : '';
                return dsLabel.startsWith(activeLabel);
              },
              callbacks: {
                // Safe: handle empty items array after filtering
                title: (items) => {
                  if (!items || !items.length) return '';
                  const i = (items[0].dataIndex ?? items[0].parsed?.x ?? 0);
                  return labels[i] ?? '';
                },
                label: (c) => {
                  const lbl = c?.dataset?.label ?? '';
                  const y   = c?.parsed?.y ?? 0;
                  return `${lbl}: ${fmtUSD(y)}`;
                }
              }
            }
          },

          // side-by-side bars per label (not stacked)
          scales: {
            x: { stacked: false },
            y: { stacked: false, beginAtZero: true, ticks: { callback: v => fmtUSD(v) } }
          }
        };
      this._upsertChart('waterfall', ctx, data, options);
    }

// ---------- Yearly PSF trend -------------------------------------------
_renderPSFTrend(model) {
  const ctx = document.getElementById(this.ids.psfTrend);
  if (!ctx) return;
  const isTenant = ((model.perspective || 'tenant') === 'tenant');

  // Aggregate by calYear; take the first month's values in that year
  const byYear = new Map();
  model.schedule.forEach(s => {
    if (!byYear.has(s.calYear)) byYear.set(s.calYear, s);
  });
  const years = Array.from(byYear.keys()).sort();

  // Contract PSFs (rates of record)
  const pickAnnualContract = (k) => years.map(y => +(byYear.get(y)[k] || 0));
  let netPSF = pickAnnualContract('contractNetAnnualPSF');
  let txPSF  = pickAnnualContract('contractTaxesAnnualPSF');
  let camPSF = pickAnnualContract('contractCamAnnualPSF');
  let insPSF = pickAnnualContract('contractInsAnnualPSF');

  // Fallback: if all contract components are zero, use tenant-paid PSFs * 12
  const allZero = arr => arr.every(v => !isFinite(v) || v === 0);
  if (allZero(txPSF) && allZero(camPSF) && allZero(insPSF)) {
    const pickMonthly = (k) => years.map(y => 12 * (+byYear.get(y)[k] || 0));
    netPSF = pickMonthly('netPSF');
    txPSF  = pickMonthly('taxesPSF');
    camPSF = pickMonthly('camPSF');
    insPSF = pickMonthly('insPSF');
  }

  const data = {
    labels: years.map(String),
    datasets: [
      { label:'Net',
        data: netPSF,
        borderColor: hexA(this.theme.base,  isTenant ? 1.0 : 0.35),
        backgroundColor:'transparent',
        borderWidth: isTenant ? 3 : 1.25,
        tension:.15
      },
      { label:'Taxes',
        data: txPSF,
        borderColor: hexA(this.theme.taxes, !isTenant ? 1.0 : 0.35),
        backgroundColor:'transparent',
        borderWidth: !isTenant ? 3 : 1.25,
        tension:.15
      },
      { label:'CAM',
        data: camPSF,
        borderColor: hexA(this.theme.cam,   !isTenant ? 1.0 : 0.35),
        backgroundColor:'transparent',
        borderWidth: !isTenant ? 3 : 1.25,
        tension:.15
      },
      { label:'Insurance',
        data: insPSF,
        borderColor: hexA(this.theme.ins,   !isTenant ? 1.0 : 0.35),
        backgroundColor:'transparent',
        borderWidth: !isTenant ? 3 : 1.25,
        tension:.15
      },
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
    scales: { y: { beginAtZero: true } }
  };

  this._upsertChart('psfTrend', ctx, data, options);
}

    // ---------- Tornado sensitivity (approximate) ---------------------------
    _renderTornado(model) {
      const ctx = document.getElementById(this.ids.tornado);
      if (!ctx) return;

      const area = +model.area || 1;
      const years = (+model.term || 0) / 12 || (model.schedule.length / 12);
      const rmBase = annPctToMonthly(+model.discount || 0);

      // Helper: recompute NER PV from an altered PV-of-gross estimate & concessions
      const nerFromPV = (pvGross, pvLLOpex, concessions) => {
        const pvBasis = pvGross - (pvLLOpex || 0);
        return (pvBasis - concessions) / area / years; // $/SF/yr
      };

      // Base values
      const pvGrossBase = +model.pvRent || 0;
      const pvLLOpexBase = +model.pvLLOpex || 0;
      const concessionsBase = +model.concessionsPV || ((+model.pvTIValue || 0) + (+model.commissionTotal || 0));
      const nerBase = nerFromPV(pvGrossBase, pvLLOpexBase, concessionsBase);

      // Build monthly arrays for PV recomputation
      const net$   = model.schedule.map(s => +s.netTotal || 0);
      const taxes$ = model.schedule.map(s => (+(s.taxesPSF||0) * area));
      const cam$   = model.schedule.map(s => (+(s.camPSF||0)   * area));
      const ins$   = model.schedule.map(s => (+(s.insPSF||0)   * area));
      const gross$ = net$.map((b,i)=> b + taxes$[i] + cam$[i] + ins$[i]);

      // Year index (0,1,2,...) per month
      const startYear = model.schedule[0]?.calYear || 0;
      const yIdx = model.schedule.map(s => (s.calYear - startYear)|0);

      // 1) Free Rent ±1 month (approx): add/remove earliest abated/paid month
      const firstPaidIdx = model.schedule.findIndex(s => !s.isAbated);
      const firstAbatedIdx = model.schedule.findIndex(s => s.isAbated);

      // Respect abatement type: if net-only free rent, remove base only; if gross, remove all
      const useGrossZero = (i) => model.schedule[i]?.isGrossAbated;

      const deltaFRplus  = (firstPaidIdx >= 0)
        ? (useGrossZero(firstPaidIdx) ? gross$[firstPaidIdx] : net$[firstPaidIdx])
        : 0;
      const deltaFRminus = (firstAbatedIdx >= 0)
        ? (useGrossZero(firstAbatedIdx) ? gross$[firstAbatedIdx] : net$[firstAbatedIdx])
        : 0;

      const pvFRplus  = pvGrossBase - (deltaFRplus  / Math.pow(1+rmBase, firstPaidIdx));  // +1 more free → remove one payment
      const pvFRminus = pvGrossBase + (deltaFRminus / Math.pow(1+rmBase, firstAbatedIdx)); // −1 free → add one payment

      const nerFRplus  = nerFromPV(pvFRplus,  pvLLOpexBase, concessionsBase);
      const nerFRminus = nerFromPV(pvFRminus, pvLLOpexBase, concessionsBase);
      const effectFR   = Math.max(Math.abs(nerFRplus - nerBase), Math.abs(nerFRminus - nerBase));

      // 2) TI ± $1/SF — exact on NER: ΔNER = -ΔTI / years
      const deltaTI = 1.0; // $/SF
      const nerTIplus  = nerBase - (deltaTI / years);
      const nerTIminus = nerBase + (deltaTI / years);
      const effectTI   = Math.max(Math.abs(nerTIplus - nerBase), Math.abs(nerTIminus - nerBase));

      // 3) Escalation +100 bps (approx): scale base (net) by factor (1+0.01)^(yearIndex)
      const escBps = 0.01;
      const netBump$ = net$.map((v,i)=> v * (Math.pow(1+escBps, yIdx[i]) - 1));
      const pvEscUp = pvGrossBase + calcPVFromSeries(netBump$, rmBase);
      const nerEscUp = nerFromPV(pvEscUp, pvLLOpexBase, concessionsBase);
      const effectEsc = Math.abs(nerEscUp - nerBase);

      // 4) Discount ±50 bps: re-PV gross series only (LL OpEx left as small-error approx)
      const drBps = 0.005;
      const pvDiscUp   = calcPVFromSeries(gross$, annPctToMonthly((+model.discount||0) + drBps));
      const pvDiscDown = calcPVFromSeries(gross$, annPctToMonthly((+model.discount||0) - drBps));
      const nerDiscUp   = nerFromPV(pvDiscUp,   pvLLOpexBase, concessionsBase);
      const nerDiscDown = nerFromPV(pvDiscDown, pvLLOpexBase, concessionsBase);
      const effectDisc  = Math.max(Math.abs(nerDiscUp - nerBase), Math.abs(nerDiscDown - nerBase));

      // 5) OpEx growth +50 bps (approx): scale taxes+cam+ins by (1+0.005)^(yearIndex)
      const opexBps = 0.005;
      const bumpFactor = (i) => Math.pow(1+opexBps, yIdx[i]) - 1;
      const opexBump$ = gross$.map((v,i)=> (taxes$[i]+cam$[i]+ins$[i]) * bumpFactor(i));
      const pvOpexUp = pvGrossBase + calcPVFromSeries(opexBump$, rmBase);
      const nerOpexUp = nerFromPV(pvOpexUp, pvLLOpexBase, concessionsBase);
      const effectOpex = Math.abs(nerOpexUp - nerBase);

      // Assemble tornado bars
      const labels = [
        'Free Rent (±1 month)',
        'TI (±$1/SF)',
        'Escalation (+100 bps)',
        'Discount (±50 bps)',
        'OpEx Growth (+50 bps)'
      ];
      const effects = [effectFR, effectTI, effectEsc, effectDisc, effectOpex];

      // Sort by magnitude descending
      const pairs = labels.map((l,i)=>({l, e: effects[i]})).sort((a,b)=> b.e - a.e);

      const data = {
        labels: pairs.map(p=>p.l),
        datasets:[{ label:'Δ NER (PV)  $/SF/yr', data: pairs.map(p=>+p.e.toFixed(2)), backgroundColor: this.theme.base }]
      };

      const options = {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => `± ${c.parsed.x.toFixed(2)} $/SF/yr` } }
        },
        scales: {
          x: { beginAtZero: true },
          y: { ticks: { autoSkip: false } }
        }
      };

      this._upsertChart('tornado', ctx, data, options);
    }

    // ---------- Abatement timeline (Gantt-style) ----------------------------
    _renderAbatement(model) {
      const ctx = document.getElementById(this.ids.abatement);
      if (!ctx) return;

      const labels = model.schedule.map(r => fmtMMYY(r.isoYM));
      const netAbate = model.schedule.map(s => (s.isAbated ? 1 : 0));
      const grossAbate = model.schedule.map(s => (s.isGrossAbated ? 1 : 0));

      const data = {
        labels,
        datasets: [
        { label:'Net Abatement',   data: netAbate,   backgroundColor: hexA(this.theme.base,.50),   borderWidth:0, barPercentage:1, categoryPercentage:1 },
        { label:'Gross Abatement', data: grossAbate, backgroundColor: hexA(this.theme.ins,.50),    borderWidth:0, barPercentage:1, categoryPercentage:1 }
        ]
      };

      const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: {
            label: ctx => (ctx.parsed.y ? `${ctx.dataset.label} in ${ctx.label}` : '')
          } }
        },
        scales: {
          x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true } },
          y: { stacked: true, beginAtZero: true, max: 1, ticks: { display: false }, grid: { display: false } }
        }
      };

      this._upsertChart('abatement', ctx, data, options);
    }

    // ---------- Upsert helper ----------------------------------------------
    _upsertChart(key, canvas, data, options) {
      if (this._charts[key]) {
        this._charts[key].data = data;
        this._charts[key].options = options;
        this._charts[key].update();
        return;
      }
      this._charts[key] = new Chart(canvas.getContext('2d'), { type: (key==='psfTrend' ? 'line':'bar'), data, options });
    }

    // Return base64 PNGs of each chart that currently exists
    getPNGs() {
      const keys = ['cashflow', 'waterfall', 'psfTrend', 'tornado', 'abatement'];
      const out  = {};
      for (const k of keys) {
        const inst = this._charts[k];
        // Prefer the live chart’s canvas; fall back to the id-based element
        const el = inst?.canvas || document.getElementById(this.ids[k]);
        out[k] = (el && typeof el.toDataURL === 'function') ? el.toDataURL('image/png') : '';
      }
      return out;
    }
  }

  // Expose globally
  window.NERCharts = NERCharts;
})();

