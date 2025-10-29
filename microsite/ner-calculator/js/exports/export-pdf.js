/**
 * ANNOTATIONS for Lease Calculator (pre-refactor)
 * Annotated on 2025-10-17 17:31 — js/exports/export-pdf.js
 *  These notes are additive and do not change behavior.
 * 
 */


/*! export-pdf.v6.js | Lee & Associates | v1.6
   - Monthly & Monthly + Subtotals tables now show **annualized** PSF columns (match on-screen results)
   - Contract PSFs are displayed regardless of abatement; totals still reflect abatement
   - Annual table unchanged
*/
/** Print-to-PDF: modal UI and report generation (tables, KPIs, charts as PNG). */
(function(){
  const BRAND_PRIMARY = '#E31E24';

  // helpers
  const $  = (s, r)=> (r||document).querySelector(s);
  const $$ = (s, r)=> (r||document).querySelectorAll(s);
  const fmtUSD = v => new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(+v||0);
  const fmtNum = (v,d=2)=> Number(v||0).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});

  // === NEW: chart helpers ====================================================
  // Known canvas ids (include common fallbacks in case your markup varies)
  const CHART_ID_CANDIDATES = {
    cashflow:  ['chartCashflow','cashflowChart','chart-cashflow','cfChart'],
    waterfall: ['chartWaterfall','waterfallChart','chart-waterfall'],
    psf:       ['chartPSF','psfChart','chart-psf'],
    tornado:   ['chartSensitivity','tornadoChart','chart-tornado'],
    abate:     ['chartAbate','abatementChart','chart-abate']
  };
  const CHART_LABEL = {
    cashflow:  'Cash Flow by Month',
    waterfall: 'PV Waterfall (Tenant vs Landlord)',
    psf:       'Yearly PSF Trend',
    tornado:   'Sensitivity (Δ NER)',
    abate:     'Abatement Timeline'
  };

  
/** Resolve chart canvas for a given logical role (cashflow, waterfall, psf, tornado, abatement). */
function pickCanvas(idList){
    for (const id of idList){
      const el = document.getElementById(id);
      if (el && el.tagName.toLowerCase() === 'canvas') return el;
    }
    return null;
  }

  // Build an array of {key,label,src} for the selected charts
  
/** Gather selected chart dataURLs for print; resilient to cross-origin issues. */
function collectSelectedCharts(selection){
    const out = [];
    for (const key of Object.keys(selection)){
      if (!selection[key]) continue;
      const cv = pickCanvas(CHART_ID_CANDIDATES[key] || []);
      if (cv){
        try {
          out.push({ key, label: CHART_LABEL[key] || key, src: chartToImageForPrint(cv) });
        } catch(e){ /* ignore tainting issues */ }
      }
    }
    return out;
  }

  /* ---- Print-theme capture ---------------------------------------------------
    - Paints a white background behind the chart
    - Temporarily sets axis/grid/legend colors to dark ink for white paper
    - Restores original options afterwards
  ---------------------------------------------------------------------------- */
  
/** Paint white background & set dark ink colors before printing for contrast. */
function chartToImageForPrint(canvas){
    const getInst = (cv)=>{
      if (window.Chart && Chart.getChart) return Chart.getChart(cv);
      return cv && cv._chart ? cv._chart : null;
    };
    const ch = getInst(canvas);

    // Always ensure white background in the PNG
    const paintWhiteBG = (cv)=>{
      const ctx = cv.getContext('2d');
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.restore();
    };

    if (!ch){
      paintWhiteBG(canvas);
      return canvas.toDataURL('image/png', 1);
    }

    // Backup only the fields we touch
    const origLegendColor = ch.options?.plugins?.legend?.labels?.color;
    const backups = {};
    const scales = ch.options.scales || {};
    for (const k in scales){
      const s = scales[k];
      backups[k] = {
        ticks: s.ticks ? { color: s.ticks.color } : {},
        grid:  s.grid  ? { color: s.grid.color  } : {},
        title: s.title ? { color: s.title.color } : {}
      };
      if (s.ticks) s.ticks.color = '#111318';     // dark ink
      if (s.grid)  s.grid.color  = '#e5e7eb';     // light grid
      if (s.title) s.title.color = '#111318';
    }
    if (ch.options.plugins?.legend?.labels){
      ch.options.plugins.legend.labels.color = '#111318';
    }

    ch.update('none');
    paintWhiteBG(canvas);
    const src = canvas.toDataURL('image/png', 1);

    // Restore
    for (const k in backups){
      const s = scales[k], b = backups[k];
      if (s.ticks) s.ticks.color = b.ticks?.color;
      if (s.grid)  s.grid.color  = b.grid?.color;
      if (s.title) s.title.color = b.title?.color;
    }
    if (ch.options.plugins?.legend?.labels){
      ch.options.plugins.legend.labels.color = origLegendColor;
    }
    ch.update('none');

    return src;
  }

  
/** Ensure data is present; triggers calculate() if needed. */
  function ensureData(){
    if (!window.__ner_last || !window.__ner_last.schedule){
      const form = document.querySelector('#ner-form');
      if (form){
        const evt = new Event('submit',{cancelable:true});
        form.dispatchEvent(evt);
      }
    }
    return window.__ner_last || null;
  }

  
/** Build / show export dialog with switches for tables/KPIs/charts. */
function openDialog(){
    document.getElementById('exportPdfModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'exportPdfModal';
    modal.innerHTML = `
      <div class="pdf-backdrop"></div>
      <div class="pdf-modal" role="dialog" aria-modal="true" aria-labelledby="pdfTitle">
        <div class="pdf-modal-header">
          <h3 id="pdfTitle">Export Report (PDF)</h3>
          <button type="button" class="pdf-close" aria-label="Close">&times;</button>
        </div>

        <div class="pdf-modal-body">
          <div class="pdf-row">
            <label>Client Logo (optional)
              <input type="file" id="pdfLogo" accept="image/*">
            </label>
            <label>Report Title
              <input type="text" id="pdfReportTitle" placeholder="Lease Analysis">
            </label>
          </div>

          <div class="pdf-row">
            <label>Orientation
              <select id="pdfOrientation">
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>

            <div>
              <label class="group-title with-toggle">
                <span>Include Tables</span>
                <input type="checkbox" id="pdfIncludeTables" checked>
              </label>
              <div class="pdf-checks tables">
                <label class="check-item"><span>Monthly</span><input type="checkbox" id="pdfIncMonthly" checked></label>
                <label class="check-item"><span>Annual</span><input type="checkbox" id="pdfIncAnnual" checked></label>
                <label class="check-item"><span>Monthly + Subtotals</span><input type="checkbox" id="pdfIncMonthlySub" checked></label>
              </div>
            </div>
          </div>
          
          <div class="pdf-row">
            <div>
              <label class="group-title with-toggle">
                <span>Include Charts</span>
                <input type="checkbox" id="pdfIncludeCharts" checked>
              </label>
              <div class="pdf-checks charts">
                <label class="check-item"><span>Cash Flow by Month</span><input type="checkbox" id="pdfIncCashflow" checked></label>
                <label class="check-item"><span>PV Waterfall</span><input type="checkbox" id="pdfIncWaterfall" checked></label>
                <label class="check-item"><span>Yearly PSF Trend</span><input type="checkbox" id="pdfIncPSF" checked></label>
                <label class="check-item"><span>Sensitivity (Δ NER)</span><input type="checkbox" id="pdfIncTornado" checked></label>
                <label class="check-item"><span>Abatement Timeline</span><input type="checkbox" id="pdfIncAbate" checked></label>
              </div>
            </div>
          </div>

          <!-- KPIs block full width -->
          <div class="pdf-row pdf-row-kpis">
            <div>
              <label class="group-title with-toggle">
                <span>Include KPIs</span>
                <input type="checkbox" id="pdfIncludeKpis" checked>
              </label>
              <div class="pdf-checks kpis">
                <label class="check-item"><span>Lease Starts</span><input type="checkbox" data-kpi="leaseStart" checked></label>
                <label class="check-item"><span>Lease Ends</span><input type="checkbox" data-kpi="leaseEnd" checked></label>
                <label class="check-item"><span>Avg Monthly Net</span><input type="checkbox" data-kpi="avgNetMonthly" checked></label>
                <label class="check-item"><span>Avg Monthly Gross</span><input type="checkbox" data-kpi="avgGrossMonthly" checked></label>
                <label class="check-item"><span>NER (PV)</span><input type="checkbox" data-kpi="nerPV" checked></label>
                <label class="check-item"><span>NER (non-PV)</span><input type="checkbox" data-kpi="nerSimple" checked></label>
                <label class="check-item"><span>Total Net Rent</span><input type="checkbox" data-kpi="totalNet" checked></label>
                <label class="check-item"><span>Total Gross Rent</span><input type="checkbox" data-kpi="totalGross" checked></label>
                <label class="check-item"><span>Total Gross Commission (GCI)</span><input type="checkbox" data-kpi="gciTotal" checked></label>
              </div>
            </div>
          </div>
        </div>

        <div class="pdf-modal-footer">
          <button type="button" class="pdf-btn" id="pdfGenerate">Generate PDF</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // styles
    const style = document.createElement('style');
    style.textContent = `
      #exportPdfModal{ position:fixed; inset:0; z-index:9999; }
      .pdf-backdrop{ position:absolute; inset:0; background:rgba(0,0,0,.45); }

      /* Key changes: max-height + flex column + scrollable body */
      .pdf-modal{
        position:relative;
        margin:5vh auto;
        width:min(900px, 92vw);
        max-height:90vh;
        background:#1b1f24;
        color:#eaeef2;
        border-radius:14px;
        box-shadow:0 10px 30px rgba(0,0,0,.35);
        display:flex;
        flex-direction:column;
        overflow:hidden;
      }
      .pdf-modal-header{ display:flex; justify-content:space-between; align-items:center; padding:16px 18px; border-bottom:1px solid #2a2f36; }
      .pdf-modal-header h3{ margin:0; font-size:18px; letter-spacing:.2px; }
      .pdf-close{ background:transparent; color:#aab3bd; border:none; font-size:28px; line-height:1; cursor:pointer; }

      /* Scroll lives here */
      .pdf-modal-body{
        padding:16px 18px;
        display:grid;
        gap:14px;
        overflow:auto;
        flex:1 1 auto;
      }

      .pdf-row{ display:grid; grid-template-columns: 1fr 1fr; gap:14px; align-items:start; }
      .pdf-row-kpis{ grid-template-columns: 1fr; }
      .group-title.with-toggle{ display:flex; justify-content:space-between; align-items:center; font-weight:600; margin:6px 0 8px; }
      .pdf-checks{ display:flex; flex-wrap:wrap; gap:10px 14px; }
      .pdf-checks .check-item{
        display:flex; align-items:center; gap:10px;
        border:1px solid #2b3139; background:#0f1216; border-radius:10px; padding:8px 10px;
        width:calc(50% - 7px);
      }
      .pdf-checks.tables .check-item{ width:auto; }
      .pdf-checks .check-item input[type="checkbox"]{ margin-left:auto; appearance:checkbox; width:16px; height:16px; }
      .pdf-modal-body label{ display:flex; flex-direction:column; gap:6px; font-size:13px; color:#c6ced8; }
      .pdf-modal-body input[type="text"], .pdf-modal-body select, .pdf-modal-body input[type="file"]{
        background:#0f1216; color:#e8edf3; border:1px solid #2b3139; border-radius:10px; padding:10px 12px;
      }

      /* Footer sticks to bottom of modal while body scrolls */
      .pdf-modal-footer{
        position:sticky; bottom:0;
        padding:14px 18px 18px;
        border-top:1px solid #2a2f36;
        background:#1b1f24;
        display:flex; justify-content:flex-end;
      }
      .pdf-btn{ background:#E31E24; color:white; border:none; border-radius:999px; padding:10px 16px; font-weight:600; cursor:pointer; }
      .pdf-btn:hover{ filter:brightness(1.05); }

      /* Small screens: single column + full-width check items */
      @media (max-width: 720px){
        .pdf-row{ grid-template-columns:1fr; }
        .pdf-checks .check-item{ width:100%; }
      }
    `;
    document.head.appendChild(style);


    // Master toggles
    const tablesMaster = $('#pdfIncludeTables', modal);
    const kpisMaster   = $('#pdfIncludeKpis', modal);
    const tableChecks  = $$('.pdf-checks.tables input[type="checkbox"]', modal);
    const kpiChecks    = $$('.pdf-checks.kpis   input[type="checkbox"]', modal);
    const chartsMaster = $('#pdfIncludeCharts', modal);
    const chartChecks  = $$('.pdf-checks.charts input[type="checkbox"]', modal);
    const setDisabled = (list, disabled)=> list.forEach(cb => cb.disabled = disabled);

    tablesMaster.onchange = ()=> setDisabled(tableChecks, !tablesMaster.checked);
    kpisMaster.onchange   = ()=> setDisabled(kpiChecks,   !kpisMaster.checked);
    chartsMaster.onchange = ()=> setDisabled(chartChecks, !chartsMaster.checked);


    $('.pdf-close', modal).onclick = ()=> modal.remove();
    $('#pdfGenerate', modal).onclick = async ()=>{
      const data = ensureData(); if (!data){ alert('Please Calculate first.'); return; }
      const title  = $('#pdfReportTitle', modal).value || 'Lease Analysis';
      const orient = $('#pdfOrientation', modal).value || 'landscape';
      const file   = $('#pdfLogo', modal).files[0];
      let logoURL  = '';
      if (file){
        logoURL = await new Promise(res=>{
          const fr = new FileReader(); fr.onload = e=> res(e.target.result); fr.readAsDataURL(file);
        });
      }

      const useTables = tablesMaster.checked;
      const useKpis   = kpisMaster.checked;
      const useCharts = chartsMaster.checked;

      // tables
      const incMonthly     = useTables && $('#pdfIncMonthly', modal).checked;
      const incAnnual      = useTables && $('#pdfIncAnnual', modal).checked;
      const incMonthlySub  = useTables && $('#pdfIncMonthlySub', modal).checked;

      // KPIs
      const kpisToShow = useKpis ? Array.from(kpiChecks).filter(c=>c.checked).map(c=>c.getAttribute('data-kpi')) : [];

      // charts (collect canvas → PNG only for selected)
      const chartSelection = {
        cashflow:  useCharts && $('#pdfIncCashflow',  modal).checked,
        waterfall: useCharts && $('#pdfIncWaterfall', modal).checked,
        psf:       useCharts && $('#pdfIncPSF',       modal).checked,
        tornado:   useCharts && $('#pdfIncTornado',   modal).checked,
        abate:     useCharts && $('#pdfIncAbate',     modal).checked,
      };
      const charts = useCharts ? collectSelectedCharts(chartSelection) : [];

      let w = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=800');
      const payload = {data, title, orient, logoURL, kpisToShow, useKpis, incMonthly, incAnnual, incMonthlySub, charts};
      if (w){
        w.document.write('<!doctype html><title>Preparing PDF…</title><body style="font:14px system-ui;padding:24px">Preparing PDF…</body>');
        w.document.close();
        renderToWindow(payload, w);
      } else {
        renderToIframe(payload);
      }
      modal.remove();
    };
  }

  // build html
  
/** Construct HTML for the report body. */
function buildDoc(opts){
    const {data, title, orient, logoURL, kpisToShow, useKpis, incMonthly, incAnnual, incMonthlySub, charts} = opts;
    const styles = `
      <style>
        @page{ size: A4 ${orient}; margin: 18mm; }
        :root{ --brand:${BRAND_PRIMARY}; --ink:#111318; --paper:#fff; --muted:#475569; }
        body{ font: 12pt/1.4 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:var(--ink); }
        .header{ display:flex; align-items:center; gap:16px; border-bottom:3px solid var(--brand); padding-bottom:10px; margin-bottom:16px; }
        .brand{ font-weight:800; font-size:22pt; letter-spacing:.3px; color:var(--brand); }
        .meta{ margin-left:auto; text-align:right; font-size:10pt; color:#64748b; }
        .kpis{ display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin:12px 0 10px; }
        .kpi{ border:1px solid #e5e7eb; border-radius:10px; padding:10px 12px; }
        .kpi .label{ font-size:9pt; color:#6b7280; }
        .kpi .value{ font-size:16pt; font-weight:700; margin-top:2px; }
        .charts-grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:12px; }
        .chart-card { margin:0; }
        .chart-card img { width:100%; height:auto; background:#fff; border:1px solid #e5e7eb; border-radius:8px; }
        .chart-card figcaption { margin-top:6px; font-size:10pt; color:#334155; }
        h2{ font-size:12pt; color:#0f172a; margin:12px 0 6px; border-left:4px solid var(--brand); padding-left:8px; }
        table{ width:100%; border-collapse:collapse; margin:6px 0 12px; }
        th, td{ border:1px solid #e5e7eb; padding:6px 8px; font-size:9pt; }
        th{ background:#f8fafc; text-align:left; }
        .logo{ height:36px; object-fit:contain; }
        .footer{ margin-top:10px; display:flex; justify-content:space-between; color:#64748b; font-size:9pt; }
        @media print{ .page-break{ page-break-before: always; } }
        @media print { .charts-grid { grid-template-columns: repeat(2, 1fr); } }
      </style>
    `;

    // Headers
    const headerMonthly = ['Year','Month','Space Size (SF)','TI ($/SF)','Net Rent ($/SF/yr)','Taxes ($/SF/yr)','CAM ($/SF/yr)','Insurance ($/SF/yr)','Gross Rent ($/SF/yr)','Net Rent (Total)','Gross Rent (Total)'];
    const thsMonthly = headerMonthly.map(h=>`<th>${h}</th>`).join('');

    const headerAnnual = ['Year','Months','Space Size (SF)','TI ($/SF)','Net Rent ($/SF)','Taxes ($/SF)','CAM ($/SF)','Insurance ($/SF)','Gross Rent ($/SF)','Monthly Net Rent','Total Net Rent','Monthly Gross Rent','Total Gross Rent'];
    const thsAnnual = headerAnnual.map(h=>`<th>${h}</th>`).join('');

    // KPIs
    const leaseStart = data.leaseStartISO ? new Date(data.leaseStartISO+'-01') : null;
    const leaseEnd   = data.leaseEndISO ? new Date(data.leaseEndISO+'-01') : null;
    const dtfmt = d => d ? d.toLocaleString(undefined,{month:'short',year:'numeric'}) : '—';
    const KPI_MAP = {
      leaseStart: ['Lease Starts', dtfmt(leaseStart)],
      leaseEnd: ['Lease Ends', dtfmt(leaseEnd)],
      avgNetMonthly: ['Avg Monthly Net Rent', fmtUSD(data.avgNetMonthly || 0)],
      avgGrossMonthly: ['Avg Monthly Gross Rent', fmtUSD(data.avgGrossMonthly || 0)],
      nerPV: ['NER (PV)', fmtUSD(data.nerPV || 0) + ' /SF/yr'],
      nerSimple: ['NER (non-PV)', fmtUSD((data.simpleNet!=null?data.simpleNet:data.nerSimple) || 0) + ' /SF/yr'],
      totalNet: ['Total Net Rent', fmtUSD(data.totalPaidNet || data.totalNet || 0)],
      totalGross: ['Total Gross Rent', fmtUSD(data.totalPaidGross || data.totalGross || 0)],
      gciTotal: ['Total Gross Commission (GCI)', fmtUSD(data.commissionTotal || 0)]
    };
    const kpiHtml = (useKpis? (kpisToShow||[]) : []).map(key=>{
      const i = KPI_MAP[key]; return i ? `<div class="kpi"><div class="label">${i[0]}</div><div class="value">${i[1]}</div></div>` : '';
    }).join('');

    const rows = data.schedule;

    // Monthly table rows (ANNUALIZED PSFs — contract rates of record)
    const monthlyRows = rows.map(r=>{
      const netPSF   = r.contractNetAnnualPSF;
      const taxPSF   = r.contractTaxesAnnualPSF;
      const camPSF   = r.contractCamAnnualPSF;
      const insPSF   = r.contractInsAnnualPSF;
      const grossPSF = netPSF + taxPSF + camPSF + insPSF;
      return `
      <tr>
        <td>${r.calYear}</td><td>${r.month}</td><td>${fmtNum(r.area,0)}</td><td>${fmtNum(r.ti,2)}</td>
        <td>${fmtNum(netPSF,2)}</td>
        <td>${fmtNum(taxPSF,2)}</td>
        <td>${fmtNum(camPSF,2)}</td>
        <td>${fmtNum(insPSF,2)}</td>
        <td>${fmtNum(grossPSF,2)}</td>
        <td>${fmtUSD(r.netTotal)}</td><td>${fmtUSD(r.grossTotal)}</td>
      </tr>`;
    }).join('');

    // Group helper
    function groupByYear(rows){
      const by = new Map(); rows.forEach(r=>{ if(!by.has(r.calYear)) by.set(r.calYear,[]); by.get(r.calYear).push(r); }); return by;
    }
    const by = groupByYear(rows);

    // Annual summary rows (unchanged)
    const annualRows = Array.from(by.entries()).map(([yr, arr])=>{
      const months = arr.length, area = arr[0].area, ti = arr[0].ti;
      const wNet = arr.reduce((s,r)=> s + r.contractNetAnnualPSF,0)/months;
      const wTax = arr.reduce((s,r)=> s + r.contractTaxesAnnualPSF,0)/months;
      const wCam = arr.reduce((s,r)=> s + r.contractCamAnnualPSF,0)/months;
      const wIns = arr.reduce((s,r)=> s + r.contractInsAnnualPSF,0)/months;
      const wGross = wNet+wTax+wCam+wIns;
      const mNet = arr.reduce((s,r)=> s+r.netTotal,0)/months;
      const totNet = arr.reduce((s,r)=> s+r.netTotal,0);
      const mGross = arr.reduce((s,r)=> s+r.grossTotal,0)/months;
      const totGross = arr.reduce((s,r)=> s+r.grossTotal,0);
      return `<tr>
        <td>${yr}</td><td>${months}</td><td>${fmtNum(area,0)}</td><td>${fmtNum(ti,2)}</td>
        <td>${fmtNum(wNet,2)}</td><td>${fmtNum(wTax,2)}</td><td>${fmtNum(wCam,2)}</td><td>${fmtNum(wIns,2)}</td>
        <td>${fmtNum(wGross,2)}</td><td>${fmtUSD(mNet)}</td><td>${fmtUSD(totNet)}</td>
        <td>${fmtUSD(mGross)}</td><td>${fmtUSD(totGross)}</td>
      </tr>`;
    }).join('');

    // Monthly + Subtotals (monthly rows annualized PSFs + per-year subtotal)
    const monthlySubRows = Array.from(by.entries()).map(([yr, arr])=>{
      const body = arr.map(r=>{
        const netPSF   = r.contractNetAnnualPSF;
        const taxPSF   = r.contractTaxesAnnualPSF;
        const camPSF   = r.contractCamAnnualPSF;
        const insPSF   = r.contractInsAnnualPSF;
        const grossPSF = netPSF + taxPSF + camPSF + insPSF;
        return `
        <tr>
          <td>${r.calYear}</td><td>${r.month}</td><td>${fmtNum(r.area,0)}</td><td>${fmtNum(r.ti,2)}</td>
          <td>${fmtNum(netPSF,2)}</td>
          <td>${fmtNum(taxPSF,2)}</td>
          <td>${fmtNum(camPSF,2)}</td>
          <td>${fmtNum(insPSF,2)}</td>
          <td>${fmtNum(grossPSF,2)}</td>
          <td>${fmtUSD(r.netTotal)}</td><td>${fmtUSD(r.grossTotal)}</td>
        </tr>`;
      }).join('');

      const months = arr.length;
      const wNet = arr.reduce((s,r)=> s + r.contractNetAnnualPSF,0)/months;
      const wTax = arr.reduce((s,r)=> s + r.contractTaxesAnnualPSF,0)/months;
      const wCam = arr.reduce((s,r)=> s + r.contractCamAnnualPSF,0)/months;
      const wIns = arr.reduce((s,r)=> s + r.contractInsAnnualPSF,0)/months;
      const wGross = wNet+wTax+wCam+wIns;
      const mNet = arr.reduce((s,r)=> s+r.netTotal,0)/months;
      const totNet = arr.reduce((s,r)=> s+r.netTotal,0);
      const mGross = arr.reduce((s,r)=> s+r.grossTotal,0)/months;
      const totGross = arr.reduce((s,r)=> s+r.grossTotal,0);

      const sub = `<tr>
        <td><b>${yr} Subtotal</b></td><td></td><td>${fmtNum(arr[0].area,0)}</td><td>${fmtNum(arr[0].ti,2)}</td>
        <td><b>${fmtNum(wNet,2)}</b></td><td><b>${fmtNum(wTax,2)}</b></td><td><b>${fmtNum(wCam,2)}</b></td><td><b>${fmtNum(wIns,2)}</b></td>
        <td><b>${fmtNum(wGross,2)}</b></td><td><b>${fmtUSD(mNet)}</b></td><td><b>${fmtUSD(totNet)}</b></td>
      </tr>`;

      return body + sub;
    }).join('');

    // Assemble
    const now = new Date();
    const head = `
      <div class="header">
        ${logoURL ? `<img class="logo" src="${logoURL}" alt="logo">` : ''}
        <div class="brand">Lee &amp; Associates</div>
        <div class="meta"><div>${title}</div><div>${now.toLocaleString()}</div></div>
      </div>`;

    const kpiSection = useKpis && kpisToShow.length ? `<h2>Key Metrics</h2><div class="kpis">${kpiHtml}</div>` : '';
    const chartsSection = (charts && charts.length)
      ? `<h2 class="${(useKpis && kpisToShow?.length) ? '' : 'page-break'}">Charts</h2>
         <div class="charts-grid">
           ${charts.map(c => `
             <figure class="chart-card">
               <img src="${c.src}" alt="${c.label}">
               <figcaption>${c.label}</figcaption>
             </figure>
           `).join('')}
         </div>`
      : '';

    const sections = `
      ${incMonthly ? `<h2 class="page-break">Monthly</h2><table><thead><tr>${thsMonthly}</tr></thead><tbody>${monthlyRows}</tbody></table>` : ''}
      ${incAnnual ? `<h2 class="${incMonthly ? '' : 'page-break'}">Annual</h2><table><thead><tr>${thsAnnual}</tr></thead><tbody>${annualRows}</tbody></table>` : ''}
      ${incMonthlySub ? `<h2 class="${(incMonthly||incAnnual) ? '' : 'page-break'}">Monthly + Subtotals</h2><table><thead><tr>${thsMonthly}</tr></thead><tbody>${monthlySubRows}</tbody></table>` : ''}
    `;

    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${styles}</head>
      <body>
        ${head}
        ${kpiSection}
        ${chartsSection}
        ${sections}
        <div class="footer"><span>Generated by Lease NER Calculator</span><span>© ${new Date().getFullYear()} Lee &amp; Associates</span></div>
        <script>
        (function () {
          function printWhenImagesReady() {
            const imgs = Array.from(document.querySelectorAll('img'));
            if (imgs.length === 0) {
              // Nothing to wait for
              setTimeout(() => window.print(), 50);
              return;
            }
            let remaining = imgs.length;
            const done = () => { if (--remaining <= 0) setTimeout(() => window.print(), 50); };

            imgs.forEach(img => {
              if (img.complete && img.naturalWidth > 0) {
                // Already decoded
                done();
              } else {
                img.addEventListener('load', done,  { once: true });
                img.addEventListener('error', done, { once: true });
              }
            });
          }
          window.addEventListener('load', printWhenImagesReady);
        })();
        <\/script>
      </body></html>`;
    return doc;
  }

  
/** Render report into a new window and call print after images load. */
function renderToWindow(opts, w){
    const doc = buildDoc(opts);
    w.document.open(); w.document.write(doc); w.document.close();
  }
  
/** Hidden iframe fallback for print. */
function renderToIframe(opts){
    const doc = buildDoc(opts);
    const iframe = document.createElement('iframe');
    iframe.style.position='fixed'; iframe.style.right='0'; iframe.style.bottom='0';
    iframe.style.width='0'; iframe.style.height='0'; iframe.style.border='0';
    document.body.appendChild(iframe);
    iframe.onload = () => { setTimeout(()=>{ iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(()=> iframe.remove(), 400); }, 150); };
    iframe.contentWindow.document.open();
    iframe.contentWindow.document.write(doc);
    iframe.contentWindow.document.close();
  }

  window.ExportPDF = { openDialog };
})();
