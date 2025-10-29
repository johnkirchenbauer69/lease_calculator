/* =======================================================================
   NER Calculator — unified controller
   Drop-in replacement for app.js
   ======================================================================= */

(() => {
  // ------------------------------- Config / State -------------------------------
  let activeView = "monthly";            // "monthly" | "annual" | "monthly+subtotals"
  let activePerspective = "landlord";    // "landlord" | "tenant"

  // A tiny USD formatter (falls back if you have a global formatCurrency)
  const fmtUSD = (n) =>
    (typeof window.formatCurrency === "function")
      ? window.formatCurrency(n)
      : (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

  const $id = (s) => document.getElementById(s);
  const setText = (id, txt) => { const el = $id(id); if (el) el.textContent = txt; };
  const fmt$ = (n) => (Number.isFinite(n) ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }) : '—');
  const fmt$0 = (n) => (Number.isFinite(n) ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—');
  const fmtPct = (n) => (Number.isFinite(n) ? (n * 100).toFixed(1) + '%' : '—');

  // ------------------------------- Small helpers -------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function rawNumberFromInput(input) {
    if (!input) return 0;
    const val = String(input.value || "").replace(/[^0-9.\-]/g, "");
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : 0;
  }

  // Reads a % input like "6" or "6.0%" and returns 0.06
  function rawPercentFromInput(elOrId) {
    const el = (typeof elOrId === 'string') ? document.getElementById(elOrId) : elOrId;
    if (!el) return 0;
    const s = (el.value || '').toString().replace(/[^\d.-]/g, ''); // strip %, commas, spaces
    const n = parseFloat(s);
    return Number.isFinite(n) ? n / 100 : 0;
  }

  function fmtPSF(v) { return (isFinite(v) ? `$${v.toFixed(2)}/SF` : '$0.00/SF'); }

  // -- Commissions & NPV chip (define once, top-level) -------------------------
  function updateCommNpvChip() {
    const pct = (rawPercentFromInput('brokerCommission') || 0) * 100; // 0..100
    const basis = document.getElementById('brokerCommBasis')?.value || 'gross';
    const dr = (rawPercentFromInput('discount') || 0) * 100;

    const parts = [];
    if (pct > 0) parts.push(`${pct.toFixed(1)}% ${basis === 'net' ? 'Net' : 'Gross'}`);
    if (dr > 0) parts.push(`DR ${dr.toFixed(1)}%`);

    const chip = document.getElementById('commnpvChip');
    if (chip) chip.textContent = parts.length ? parts.join(' • ') : '—';
  }

  function formatOnBlur(e) {
    const el = e.target;
    const kind = el.dataset.format;
    const n = rawNumberFromInput(el);
    if (kind === "int") el.value = n ? Math.round(n).toLocaleString() : "";
    else if (kind === "money") el.value = n ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
    else if (kind === "percent") el.value = n ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";
  }

  function parseDateInput(val) {
    if (!val) {
      const d = new Date();
      d.setDate(1);
      return d;
    }
    // Accepts mm/dd/yyyy or yyyy-mm-dd
    if (val.includes("/")) {
      const [m, d, y] = val.split("/").map(Number);
      return new Date(y || 0, (m || 1) - 1, d || 1);
    }
    const [y, m, day] = val.split("-").map(Number);
    return new Date(y, (m || 1) - 1, day || 1);
  }
  // Recalculate when commission/discount inputs change
  ['brokerCommission', 'discount'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('input', calculate); // text/number fields
    el?.addEventListener('change', calculate); // some browsers fire change only
  });
  
  const commnpvDetails = document.getElementById('commnpvDetails');
  if (localStorage.getItem('commnpv_open') === '1') commnpvDetails.setAttribute('open', '');
  commnpvDetails?.addEventListener('toggle', () => {
    localStorage.setItem('commnpv_open', commnpvDetails.open ? '1' : '0');
  });

  
  ['brokerCommission', 'brokerCommBasis', 'discount'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('input', updateCommNpvChip);
    el?.addEventListener('change', updateCommNpvChip);
  });
  updateCommNpvChip(); // initial


  // Basis is a <select>
  document.getElementById('brokerCommBasis')
    ?.addEventListener('change', calculate);

  // Read Additional Operating Expenses from #customExpList
  // Each row: .cx-row with .cx-label, .cx-val, .cx-growth, .cx-growthUnit, .cx-mode, .cx-base
  function readAdditionalOpEx() {
    const list = document.getElementById('customExpList');
    if (!list) return [];

    const rows = Array.from(list.querySelectorAll('.cx-row'));
    const toNum = (el) => {
      const v = (el?.value ?? '').toString().replace(/[^0-9.\-]/g, '');
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };

    return rows.map(row => {
      const label = (row.querySelector('.cx-label')?.value || 'Other').trim();
      const rate = toNum(row.querySelector('.cx-val'));          // Year-1 $/SF/yr
      const growth = toNum(row.querySelector('.cx-growth'));       // % or $ depending on unit
      const unit = (row.querySelector('.cx-growthUnit')?.value === 'flat') ? 'flat' : 'pct';
      const mode = (row.querySelector('.cx-mode')?.value || 'tenant').toLowerCase(); // tenant|stop|landlord
      let base = toNum(row.querySelector('.cx-base'));         // optional, only for stop

      // If stop mode and base is blank, default to Year-1 value
      if (mode === 'stop' && !base) base = rate;

      return { label, rate, growth, unit, mode, base };
    }).filter(r => r.rate > 0);
  }

  // Put near the top of app.js (after DOM is ready or in a module scope)
  const EM_DASH = '\u2014';

  // When you render KPIs:
  function renderLeaseDates(startStr, endStr) {
    const leaseStartEl = document.getElementById('leaseStart');
    const leaseEndEl = document.getElementById('leaseEnd');
    if (leaseStartEl) leaseStartEl.textContent = startStr || EM_DASH;
    if (leaseEndEl) leaseEndEl.textContent = endStr || EM_DASH;
  }
  // --- KPI / date element refs (used in calculate) ---
  const nerPVEl = document.getElementById('nerPV');
  const nerSimpleEl = document.getElementById('nerSimple');
  const avgNetMonthlyEl = document.getElementById('avgNetMonthly');
  const avgGrossMonthlyEl = document.getElementById('avgGrossMonthly');
  const totalNetEl = document.getElementById('totalNet');
  const totalGrossEl = document.getElementById('totalGross');
  const leaseStartEl = document.getElementById('leaseStart');
  const leaseEndEl = document.getElementById('leaseEnd');
  // Formatting helpers (fallbacks if you don't already have them)
  const formatUSD = (n) =>
    (Number.isFinite(+n) ? +n : 0).toLocaleString(undefined, {
      style: 'currency', currency: 'USD', maximumFractionDigits: 2
    });
  const formatNumber = (n) => (Number.isFinite(+n) ? +n : 0).toLocaleString();

  // Helper to read the escalation mode without relying on a closed-over const
  function getEscMode() {
    return document.getElementById('escUnit')?.value || 'pct';
  }

  // ---------- helpers you already have ----------
  const money = (s) => {
    const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const percent = (s) => {
    const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n / 100 : 0;
  };

  // ---------- show/hide the “Custom expenses” section when serviceType changes
  const serviceTypeEl = document.getElementById('serviceType');
  const customSection = document.getElementById('customExpSection');
  function toggleCustomUI() {
    const isCustom = serviceTypeEl?.value === 'custom';
    customSection?.classList.toggle('hidden', !isCustom);
    // You likely already show Taxes/CAM/Ins for MG/NNN; for Custom keep them visible
  }
  serviceTypeEl?.addEventListener('change', toggleCustomUI);
  toggleCustomUI(); // initial

  // Toggle "Advanced" panels
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-adv-toggle]');
    if (!t) return;
    const key = t.getAttribute('data-adv-toggle');
    const panel = document.querySelector(`.opx-adv[data-for="${key}"]`);
    if (panel) panel.hidden = !panel.hidden;
  });

  // Show base-year policy only when that line is in stop mode
  function syncBaseYearVisibility(prefix, isStop) {
    const group = document.querySelector(`.opx-adv[data-for="${prefix}"] [data-show-when-stop="true"]`);
    if (group) group.style.display = isStop ? '' : 'none';
    const policy = document.getElementById(`${prefix}BasePolicy`);
    const year = document.getElementById(`${prefix}BaseYear`);
    if (policy && year) {
      const toggleYear = () => { year.hidden = (policy.value !== 'explicit'); };
      policy.addEventListener('change', toggleYear); toggleYear();
    }
  }

  // ---------- custom row add/remove/label flipping
  const customList = document.getElementById('customExpList');
  const rowTpl = document.getElementById('tplCustomExpRow');
  let customRowSeq = 0;

  function addCustomRow(prefill = {}) {
    if (!rowTpl || !customList) return;
    const node = rowTpl.content.firstElementChild.cloneNode(true);
    node.dataset.idx = (++customRowSeq).toString();

    // prefill
    node.querySelector('.cx-label').value = prefill.label ?? '';
    node.querySelector('.cx-val').value = prefill.value != null ? prefill.value : '';
    node.querySelector('.cx-growth').value = (prefill.growth != null && prefill.growthUnit === 'pct')
      ? (prefill.growth * 100).toFixed(2) : (prefill.growth ?? '');
    node.querySelector('.cx-growthUnit').value = prefill.growthUnit ?? 'pct';
    node.querySelector('.cx-mode').value = prefill.mode ?? 'tenant';
    node.querySelector('.cx-base').value = prefill.base != null ? prefill.base : '';

    // if stop, show base + year-1 kicker
    updateCustomRowModeUI(node);
    customList.appendChild(node);
  }

  function updateCustomRowModeUI(rowEl) {
    const modeSel = rowEl.querySelector('.cx-mode');
    const baseWrap = rowEl.querySelector('.cx-base-wrap');
    const kicker = rowEl.querySelector('.cx-kicker');
    const isStop = modeSel?.value === 'stop';
    if (baseWrap) baseWrap.style.display = isStop ? '' : 'none';
    if (kicker) kicker.hidden = !isStop;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Perspective (Landlord/Tenant) UI + KPI re-ordering / relabel
  // ─────────────────────────────────────────────────────────────────────────────

  // IDs of the KPI *value* elements already in your HTML
  const KPI_IDS = {
    leaseStart: 'leaseStart',
    leaseEnd: 'leaseEnd',
    avgNet: 'avgNetMonthly',
    avgGross: 'avgGrossMonthly',
    totalNet: 'totalNet',
    totalGross: 'totalGross',
    nerPV: 'nerPV',
    nerSimple: 'nerSimple'
  };

  // New KPI value element IDs (these are the *value* spans/divs inside each card)
  const EXTRA_KPI_IDS = {
    // Value of Free Rent (PV)
    freePV: 'kpiFreePV',
    freeNominal: 'kpiFreeNominal',
    abatedPct: 'kpiAbatedPct',

    // Gross ↔ Net Spread + Recovery chip
    spread: 'kpiSpread',
    recovery: 'kpiRecovery',

    // LL Cash Outlay (PV)
    llCashPV: 'kpiLLCashPV',

    // All-in Occupancy Cost ($/SF/mo)
    occPSFmo: 'kpiOccPSFmo',

    // Total Incentive Value (PV)
    incentivePV: 'kpiIncentivePV',
  };


  // Helper: find the “card” wrapper for a KPI value id
  function cardOf(id) {
    return document.getElementById(id)?.closest('.card') || null;
  }

  // Helper: generic title setter for a KPI card
  function setCardTitle(id, newTitle) {
    const card = cardOf(id);
    if (!card) return;
    // try a few common title selectors
    const titleEl = card.querySelector('.card-title, .kpi-title, .stat-title, h3, h4, header, .title');
    if (titleEl) titleEl.textContent = newTitle;
  }

  // Reorder the cards inside the .cards container
  function orderCards(order) {
    const wrap = document.querySelector('.cards');
    if (!wrap) return;
    order
      .map(id => cardOf(id))
      .filter(Boolean)
      .forEach(card => wrap.appendChild(card)); // append = move
  }

  // Show/hide a whole KPI card by its value element id
  function showCard(id, show) {
    const card = cardOf(id);
    if (card) card.style.display = show ? '' : 'none';
  }

  // Show/hide a single chip/value element (e.g., the Recovery chip)
  function showChip(id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  }

  // Make small info chips next to NER when Landlord view is active
  function updateLandlordNerChips() {
    const nerCard = cardOf(KPI_IDS.nerPV);
    if (!nerCard) return;

    // ensure a container exists
    let chips = nerCard.querySelector('.kpi-meta');
    if (!chips) {
      chips = document.createElement('div');
      chips.className = 'kpi-meta';
      chips.style.marginTop = '6px';
      chips.style.display = 'flex';
      chips.style.flexWrap = 'wrap';
      chips.style.gap = '8px';
      nerCard.appendChild(chips);
    }
    chips.innerHTML = ''; // refresh

    const model = window.__ner_last || {};
    const fmt = (n) => (isFinite(n)
      ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
      : '—');

    const pvLL = Number(model?.pvLLOpex) || 0;
    const commPV = Number(model?.kpis?.commissionPV ?? model?.commissionTotal) || 0;
    const showComm = !!model?.includeBrokerComm && commPV > 0;

    const mk = (label, val) => {
      const tag = document.createElement('span');
      tag.className = 'chip';
      tag.style.padding = '2px 8px';
      tag.style.borderRadius = '10px';
      tag.style.fontSize = '12px';
      tag.style.background = 'var(--pill-bg, rgba(255,255,255,.07))';
      tag.style.border = '1px solid var(--pill-br, rgba(255,255,255,.10))';
      tag.textContent = `${label}: ${fmt(val)}`;
      return tag;
    };

    chips.appendChild(mk('LL OpEx (PV)', pvLL));
    if (showComm) chips.appendChild(mk('Broker Commissions (PV)', commPV));
  }

  // Remove the chips in Tenant view
  function clearLandlordNerChips() {
    const nerCard = cardOf(KPI_IDS.nerPV);
    nerCard?.querySelector('.kpi-meta')?.remove();
  }

  // Apply perspective → reorder, relabel, remember, and refresh charts
  function applyPerspective(p) {
    const perspective = (p === 'tenant') ? 'tenant' : 'landlord';
    try { localStorage.setItem('ner_perspective', perspective); } catch { }
  
    // If Compare view is visible, redraw it for the new perspective
    const compareVisible = !document.getElementById('compareSection')?.classList.contains('hidden');
    if (compareVisible && typeof window.renderCompareGrid === 'function') {
      window.renderCompareGrid();
    }

    // Toggle active state on the pills
    document.querySelectorAll('#perspectiveToggles .perspective-toggle').forEach(b => {
      b.classList.toggle('active', b.dataset.perspective === perspective);
    });

    // Reorder & relabel KPIs
    if (perspective === 'tenant') {
      // Tenant: lead with Gross KPIs, present NER as “Effective Occupancy Cost”
      orderCards([
        KPI_IDS.leaseStart, KPI_IDS.leaseEnd, KPI_IDS.avgGross, KPI_IDS.totalGross,
        KPI_IDS.nerPV, KPI_IDS.nerSimple, KPI_IDS.avgNet, KPI_IDS.totalNet,
        EXTRA_KPI_IDS.freePV, EXTRA_KPI_IDS.spread, EXTRA_KPI_IDS.occPSFmo,
        EXTRA_KPI_IDS.incentivePV
        // note: LL Cash Outlay intentionally NOT ordered here
      ]);
      setCardTitle(KPI_IDS.nerPV, 'Effective Occupancy Cost (PV)');
      setCardTitle(KPI_IDS.nerSimple, 'Effective Occupancy Cost (non-PV)');
      setCardTitle(KPI_IDS.avgGross, 'Avg Monthly Gross Rent');
      setCardTitle(KPI_IDS.totalGross, 'Total Gross Rent');
      setCardTitle(EXTRA_KPI_IDS.freePV, 'Value of Free Rent (PV)');
      setCardTitle(EXTRA_KPI_IDS.spread, 'Gross–Net Spread');
      setCardTitle(EXTRA_KPI_IDS.occPSFmo, 'All-in Occupancy Cost ($/SF/mo)');
      setCardTitle(EXTRA_KPI_IDS.incentivePV, 'Total Incentive Value (PV)');

      // Show/hide specific cards
      showCard(EXTRA_KPI_IDS.llCashPV, false);
      showCard(EXTRA_KPI_IDS.freePV, true);
      showCard(EXTRA_KPI_IDS.occPSFmo, true);
      showCard(EXTRA_KPI_IDS.incentivePV, true);

      // Hide Recovery chip in Tenant view
      showChip(EXTRA_KPI_IDS.recovery, false);

      clearLandlordNerChips();

    } else {
      // Landlord: lead with Net KPIs and surface LL economics
      orderCards([
        KPI_IDS.leaseStart, KPI_IDS.leaseEnd, KPI_IDS.avgNet, KPI_IDS.totalNet,
        KPI_IDS.nerPV, KPI_IDS.nerSimple, KPI_IDS.avgGross, KPI_IDS.totalGross,
        EXTRA_KPI_IDS.llCashPV, EXTRA_KPI_IDS.spread
        // note: no freePV / occPSFmo / incentivePV in LL order
      ]);
      setCardTitle(KPI_IDS.nerPV, 'NER (PV)');
      setCardTitle(KPI_IDS.nerSimple, 'NER (non-PV)');
      setCardTitle(KPI_IDS.avgNet, 'Avg Monthly Net to LL');
      setCardTitle(KPI_IDS.totalNet, 'Total Net to LL');
      setCardTitle(EXTRA_KPI_IDS.llCashPV, 'LL Cash Outlay (PV)');
      setCardTitle(EXTRA_KPI_IDS.spread, 'Gross–Net Spread');

      // Show/hide specific cards
      showCard(EXTRA_KPI_IDS.llCashPV, true);
      showCard(EXTRA_KPI_IDS.freePV, false);
      showCard(EXTRA_KPI_IDS.occPSFmo, false);
      showCard(EXTRA_KPI_IDS.incentivePV, false);

      // Show Recovery chip in LL view
      showChip(EXTRA_KPI_IDS.recovery, true);

      updateLandlordNerChips();
    }
  
    // Feed perspective into the live model and refresh charts (if present)
    if (window.__ner_last) {
      window.__ner_last.perspective = perspective;
      if (window.charts && typeof window.charts.update === 'function') {
        window.charts.update(window.__ner_last);
      }
    }
  }

  // Wire the toggle buttons once
  (function bootPerspective() {
    const remembered = (() => { try { return localStorage.getItem('ner_perspective') } catch { } })() || 'landlord';
    document.querySelectorAll('#perspectiveToggles .perspective-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        applyPerspective(btn.dataset.perspective);
      });
    });
    // initial
    applyPerspective(remembered);
  })();

  // --- Commissions & NPV expander
  (function wireCommNPVExpander() {
    const btn = document.getElementById('commnpvToggle');
    const body = document.getElementById('commnpvBody');
    if (!btn || !body) return;

    // restore last state
    const open = localStorage.getItem('ner_commnpv_open') === '1';
    body.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? '▾' : '▸';

    btn.addEventListener('click', (e) => {
      e.preventDefault();           // stop form submit
      e.stopPropagation();          // no bubbling side-effects
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      const next = !isOpen;
      btn.setAttribute('aria-expanded', String(next));
      body.classList.toggle('hidden', !next);
      btn.textContent = next ? '▾' : '▸';
      localStorage.setItem('ner_commnpv_open', next ? '1' : '0');
    });
  })();


  // OPTIONAL: ensure calculate() stores perspective onto the model each run.
  // Add the following one-liner **inside** calculate(), right before you assign
  // window.__ner_last = model (or right before charts.update(...)):
  //    model.perspective = (localStorage.getItem('ner_perspective') || 'landlord');

  // Delegated handlers
  customList?.addEventListener('click', (e) => {
    const btn = e.target.closest('.cx-delete');
    if (!btn) return;
    const row = btn.closest('.cx-row');
    row?.remove();
  });
  customList?.addEventListener('change', (e) => {
    const sel = e.target.closest('.cx-mode');
    if (!sel) return;
    const row = sel.closest('.cx-row');
    if (row) updateCustomRowModeUI(row);
  });

  // New: always calendar
  const opxBasis = 'calendar';


  // optional starter row hint for UX
  // addCustomRow({ label: 'Utilities', value: '0.50', growth: 0, growthUnit: 'pct', mode: 'tenant' });
  // ---------- read rows into a clean array
  function readCustomRows() {
    if (!customList) return [];
    const rows = [];
    customList.querySelectorAll('.cx-row').forEach(row => {
      const label = row.querySelector('.cx-label')?.value?.trim() || 'Expense';
      const val = money(row.querySelector('.cx-val')?.value);
      const gUnit = row.querySelector('.cx-growthUnit')?.value || 'pct';
      const gRaw = row.querySelector('.cx-growth')?.value;
      const growth = gUnit === 'pct' ? percent(gRaw) : money(gRaw);
      const mode = row.querySelector('.cx-mode')?.value || 'tenant';
      const base = money(row.querySelector('.cx-base')?.value);

      rows.push({
        label,
        value: val,           // Year-1 PSF if mode=stop, otherwise “current” PSF
        growth,
        growthUnit: gUnit,    // 'pct' | 'flat'
        mode,                 // 'tenant' | 'stop' | 'landlord'
        base: Number.isFinite(base) && base > 0 ? base : null
      });
    });
    return rows;
  }

  // Parse "1-3, 10, 25-27" → Set of 1-based month numbers (clamps to maxHint if provided)
  function parseCustomMonths(spec, maxHint = 0) {
    const out = new Set();
    if (!spec) return out;
    for (const token of spec.split(",").map(s => s.trim()).filter(Boolean)) {
      const m = token.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        let a = +m[1], b = +m[2];
        if (a > b) [a, b] = [b, a];
        for (let i = a; i <= b; i++) out.add(i);
      } else {
        const n = +token;
        if (Number.isFinite(n)) out.add(n);
      }
    }
    if (maxHint > 0) {
      for (const n of [...out]) if (n < 1 || n > maxHint) out.delete(n);
    }
    return out;
  }
  window.parseCustomMonths = parseCustomMonths; // used in exports elsewhere

  const groupBy = (arr, keyFn) => {
    const m = new Map();
    arr.forEach(r => {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
    return m;
  };

  // ------------------------------- Commission UI -------------------------------
  function getCommissionCardEl() {
    // Support either id
    return document.getElementById('commissionCard') || document.getElementById('gciCard') || null;
  }

  function setCommissionUI(show) {
    const el = getCommissionCardEl();
    if (el) el.classList.toggle('hidden', !show);
  }

  // ------------------------------- CapEx (Buildout) ----------------------------
  const capexRowsEl = document.getElementById('capexRows');
  const capexAddBtn = document.getElementById('capexAdd');
  const tiTotalCostsEl = document.getElementById('tiTotalCosts');
  const tiLLTotalEl = document.getElementById('tiLLTotal');
  const tiNetTenantEl = document.getElementById('tiNetTenant');
  
  const capexEls = {
    total$: document.getElementById('tiTotalCosts'),
    totalPSF: document.getElementById('tiTotalCostsPSF'),
    ll$: document.getElementById('tiLLTotal'),
    llPSF: document.getElementById('tiLLTotalPSF'),
    net$: document.getElementById('tiNetTenant'),
    netPSF: document.getElementById('tiNetTenantPSF'),
    chip: document.getElementById('capexChip'),
  };

  // One canonical row builder (6 columns: item | type | amount | $/SF | total | del)
  function makeCapexRow() {
    const row = document.createElement('div');
    row.className = 'capex-row';

    const item = Object.assign(document.createElement('input'), {
      className: 'capex-item',
      type: 'text',
      placeholder: 'e.g., Demolition',
    });

    const sel = document.createElement('select');
    sel.className = 'capex-entry';
    sel.innerHTML = `
    <option value="psf" selected>$/SF</option>
    <option value="total">Total $</option>
  `;

    const amt = Object.assign(document.createElement('input'), {
      className: 'capex-amount',
      placeholder: '0.00',
    });
    amt.setAttribute('inputmode', 'decimal');

    const psf = Object.assign(document.createElement('span'), {
      className: 'capex-psf',
      textContent: '—',
    });

    const total = Object.assign(document.createElement('span'), {
      className: 'capex-row-total',
      textContent: '$0.00',
    });

    const del = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'capex-del',
      ariaLabel: 'Delete row',
      textContent: '✕',
    });

    row.append(item, sel, amt, psf, total, del);

    [item, sel, amt].forEach(el => el.addEventListener('input', recalcCapex));
    del.addEventListener('click', () => { row.remove(); recalcCapex(); });

    return row;
  }

  function rowsNodeList() {
    return capexRowsEl?.querySelectorAll('.capex-row') ?? [];
  }

  function updateCapexChip(totalCapex = 0) {
    if (!capexEls.chip) return;
    const count = [...rowsNodeList()]
      .filter(r => rawNumberFromInput(r.querySelector('.capex-amount')) > 0).length;
    capexEls.chip.textContent = `${count} ${count === 1 ? 'item' : 'items'} • ${fmtUSD(totalCapex)}`;
    capexEls.chip.classList.toggle('is-empty', count === 0);
  }

  // Read & write each row, return totals
  function readCapex(area) {
    const rows = [];
    let totalCapex = 0;

    for (const r of rowsNodeList()) {
      const mode = (r.querySelector('.capex-entry')?.value || 'psf').toLowerCase();  // 'psf' | 'total'
      const amt = rawNumberFromInput(r.querySelector('.capex-amount')) || 0;

      const rowTotal = (mode === 'psf') ? amt * (area || 0) : amt;

      // write back derived cells
      const psfEl = r.querySelector('.capex-psf');
      const totEl = r.querySelector('.capex-row-total');
      if (psfEl) psfEl.textContent = (area > 0 && rowTotal > 0) ? fmtUSD(rowTotal / area) : '—';
      if (totEl) totEl.textContent = fmtUSD(rowTotal);

      rows.push({ mode, amount: amt, total: rowTotal });
      totalCapex += rowTotal;
    }
    return { rows, totalCapex };
  }
  window.readCapex = readCapex;

  function recalcCapex() {
    const area = rawNumberFromInput(document.getElementById('area')) || 0;
  
    let totalCapex = 0;
    const rowsWrap = document.getElementById('capexRows');
    const rows = rowsWrap ? rowsWrap.querySelectorAll('.capex-row') : [];
  
    rows.forEach(rowEl => {
      const entrySel = rowEl.querySelector('.capex-mode, .capex-entry');
      const amountEl = rowEl.querySelector('.capex-amt, .capex-amount');
      const totalEl  = rowEl.querySelector('.capex-row-total, .capex-total');
      const psfEl    = rowEl.querySelector('.capex-psf');
  
      const mode = (entrySel?.value || '').toLowerCase();        // 'per_sf' | 'total' | legacy text
      const amt  = rawNumberFromInput(amountEl) || 0;
      const isPerSF = (mode === 'per_sf') || /psf|\/sf/.test(mode);
  
      const rowTotal = isPerSF ? (amt * area) : amt;
  
      if (totalEl) totalEl.textContent = fmtUSD(rowTotal);
      if (psfEl)   psfEl.textContent   = (area > 0 && rowTotal > 0) ? fmtUSD(rowTotal / area) : fmtUSD(0);
  
      totalCapex += rowTotal;
    });
  
    // Landlord allowance
    const llAmt     = rawNumberFromInput(document.getElementById('llAllow')) || 0;
    const allowUnit = (document.getElementById('llAllowUnit')?.value || 'per_sf');
    const llTotal   = (allowUnit === 'per_sf') ? (llAmt * area) : llAmt;
  
    const netTenant = Math.max(0, totalCapex - llTotal);
  
    // Chip
    if (typeof updateCapexChip === 'function') updateCapexChip(totalCapex);
  
    // $ totals
    const elTotal = document.getElementById('tiTotalCosts');
    if (elTotal) elTotal.textContent = fmtUSD(totalCapex);
  
    const elLL = document.getElementById('tiLLTotal');
    if (elLL) elLL.textContent = (llTotal > 0 ? ('−' + fmtUSD(llTotal)) : fmtUSD(0));
  
    const elNet = document.getElementById('tiNetTenant');
    if (elNet) elNet.textContent = fmtUSD(netTenant);
  
    // $/SF totals (always show $0.00 when zero)
    const psf = (v) => (area > 0 && v > 0) ? fmtUSD(v / area) : fmtUSD(0);
  
    const elTotalPSF = document.getElementById('tiTotalCostsPSF');
    if (elTotalPSF) elTotalPSF.textContent = psf(totalCapex);
  
    const elLLPSF = document.getElementById('tiLLTotalPSF');
    if (elLLPSF) elLLPSF.textContent = (llTotal > 0) ? ('−' + psf(llTotal)) : fmtUSD(0);
  
    const elNetPSF = document.getElementById('tiNetTenantPSF');
    if (elNetPSF) elNetPSF.textContent = psf(netTenant);
  
    // state color for Net ($ and $/SF)
    [elNet, elNetPSF].forEach(el => {
      if (!el) return;
      el.classList.remove('is-ok', 'is-over');
      if (totalCapex === 0 && llTotal === 0) return;      // neutral when nothing entered
      (llTotal >= totalCapex) ? el.classList.add('is-ok') // allowance covers all
                              : el.classList.add('is-over');
    });
  }
  
  function bootCapex() {
    const capexRowsEl = document.getElementById('capexRows');
    const capexAddBtn = document.getElementById('capexAdd');
    if (!capexRowsEl || !capexAddBtn) return;
  
    // Add row
    capexAddBtn.addEventListener('click', () => {
      capexRowsEl.appendChild(makeCapexRow());
      recalcCapex();
    });
  
    // Seed first row if none exists
    if (!capexRowsEl.querySelector('.capex-row')) {
      capexRowsEl.appendChild(makeCapexRow());
    }
  
    // Delegate: any edit inside the rows triggers a recalc (extra safety)
    capexRowsEl.addEventListener('input', (e) => {
      if (e.target.closest('.capex-row')) recalcCapex();
    });
    capexRowsEl.addEventListener('change', (e) => {
      if (e.target.closest('.capex-row')) recalcCapex();
    });
  
    // Recalc when allowance or area change
    ['llAllow', 'llAllowUnit', 'area'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', recalcCapex);
        el.addEventListener('change', recalcCapex);
      }
    });
  
    recalcCapex();
  }
  
  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootCapex);
  } else {
    bootCapex();
  }  

  function updateOpexLabels(kind) {
    const rawService = document.getElementById('serviceType')?.value || 'NNN';
    const services = rawService.toString();
    const modeSelId = (kind === 'taxes') ? 'taxesMode' : (kind === 'cam') ? 'camMode' : 'insMode';
    const mode = document.getElementById(modeSelId)?.value || 'tenant';

    const kickerId = (kind === 'taxes') ? 'lblTaxesKicker' : (kind === 'cam') ? 'lblCamKicker' : 'lblInsKicker';
    const hintId = (kind === 'taxes') ? 'hintTaxesMain' : (kind === 'cam') ? 'hintCamMain' : 'hintInsMain';
    const baseLblId = (kind === 'taxes') ? 'lblTaxesBase' : (kind === 'cam') ? 'lblCamBase' : 'lblInsBase';

    const svc = services.toLowerCase();
    const isMG = (svc === 'mg' || svc === 'mg_stop');
    const isCustom = /^custom$/i.test(services);
    const isBaseStop = (mode === 'stop');

    // Show Pass-through Mode for BOTH MG and Custom
    const modeWrap = document.querySelector(`.opx-mode[data-for="${kind}"]`);
    if (modeWrap) modeWrap.style.display = (isMG || isCustom) ? '' : 'none';

    // Show Base-year override only when Pass-through Mode = stop (for MG **or** Custom)
    const baseWrap = document.querySelector(`.opx-base[data-for="${kind}"]`);
    if (baseWrap) baseWrap.style.display = (isBaseStop && (isMG || isCustom)) ? '' : 'none';

    // Keep the per-line base-year visibility in sync
    syncBaseYearVisibility('taxes', document.getElementById('taxesMode')?.value === 'stop');
    syncBaseYearVisibility('cam', document.getElementById('camMode')?.value === 'stop');
    syncBaseYearVisibility('ins', document.getElementById('insMode')?.value === 'stop');

    // Kicker “(Year 1 …)” only when base-year stop is active (MG or Custom)
    const kicker = document.getElementById(kickerId);
    if (kicker) kicker.hidden = !isBaseStop;

    // Hint text aligns with whether we’re in a base-year stop flow
    const hint = document.getElementById(hintId);
    if (hint) {
      hint.textContent = isBaseStop
        ? 'Enter the Year-1 value that will escalate by the annual rate above.'
        : 'Enter the current value that will escalate by the annual rate above.';
    }

    // Base label stays the same
    const baseLbl = document.getElementById(baseLblId);
    if (baseLbl) {
      if (kind === 'taxes') baseLbl.textContent = 'Base-year Taxes ($/SF/yr)';
      else if (kind === 'cam') baseLbl.textContent = 'Base-year CAM ($/SF/yr)';
      else if (kind === 'ins') baseLbl.textContent = 'Base-year Insurance ($/SF/yr)';
    }
  }

  function wireOpexLabeling() {
    const serviceSel = document.getElementById('serviceType');
    const modeIds = ['taxesMode', 'camMode', 'insMode'];

    serviceSel?.addEventListener('change', () => {
      updateOpexLabels('taxes'); updateOpexLabels('cam'); updateOpexLabels('ins');
    });

    modeIds.forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        if (id === 'taxesMode') updateOpexLabels('taxes');
        if (id === 'camMode') updateOpexLabels('cam');
        if (id === 'insMode') updateOpexLabels('ins');
      });
    });

    // initial
    updateOpexLabels('taxes'); updateOpexLabels('cam'); updateOpexLabels('ins');
  }

  // call once after DOM ready
  wireOpexLabeling();

  // ------------------------------- Photo helpers ------------------------------
  const photoInput = document.getElementById('propertyPhoto');
  const clearPhoto = document.getElementById('clearPhoto');
  const photoWrap = document.getElementById('propertyPreviewWrap');
  const photoPreview = document.getElementById('propertyPreview');

  async function fileToDataURL(file, maxW = 1400, quality = 0.85) {
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    return canvas.toDataURL('image/jpeg', quality);
  }

  function setPhoto(dataUrl) {
    if (dataUrl) {
      if (photoPreview) photoPreview.src = dataUrl;
      if (photoWrap) { photoWrap.style.display = ''; photoWrap.removeAttribute('aria-hidden'); }
      window.__ner_photo = dataUrl;
      try { localStorage.setItem('ner.photo', dataUrl); } catch { }
    } else {
      photoPreview?.removeAttribute('src');
      if (photoWrap) { photoWrap.style.display = 'none'; photoWrap.setAttribute('aria-hidden', 'true'); }
      window.__ner_photo = null;
      try { localStorage.removeItem('ner.photo'); } catch { }
    }
  }

  photoInput?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { alert('Please choose an image file.'); return; }
    const dataUrl = await fileToDataURL(f);
    setPhoto(dataUrl);
  });
  clearPhoto?.addEventListener('click', () => setPhoto(null));
  try { const cached = localStorage.getItem('ner.photo'); if (cached) setPhoto(cached); } catch { }

  // ------------------------------- Results top bar ----------------------------
  // Schedule view (Monthly / Annual / Monthly + Subtotals)
  const viewToggles = $$('.toggle-group .toggle[data-view]');
  viewToggles.forEach(btn => {
    btn.addEventListener("click", () => {
      viewToggles.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeView = btn.dataset.view;
      renderView();
    });
  });
  viewToggles.forEach(b => b.classList.toggle("active", b.dataset.view === activeView));

  // KPI’s + Rent Schedule | KPI’s + Charts | Lease Comparison
  const resultsViewButtons = $$('#resultsViewToggle [data-view]');
  const scheduleWrap = document.getElementById('rent-schedule');
  const chartsWrap = document.getElementById('analysis-charts');
  const compareWrap = document.getElementById('compareSection');

  function setResultsView(mode) {
    scheduleWrap?.classList.toggle('hidden', mode !== 'schedule');
    chartsWrap?.classList.toggle('hidden', mode !== 'charts');
    compareWrap?.classList.toggle('hidden', mode !== 'compare');
    resultsViewButtons.forEach(b => b.classList.toggle('active', b.dataset.view === mode));
    try { localStorage.setItem('ner_view_mode', mode); } catch { }
    if (mode === 'charts' && window.charts && window.__ner_last) window.charts.update(window.__ner_last);
    if (mode === 'compare' && typeof window.renderCompareGrid === 'function') {
      window.renderCompareGrid();
    }
  }

  resultsViewButtons.forEach(btn => btn.addEventListener('click', () => setResultsView(btn.dataset.view)));
  setResultsView(localStorage.getItem('ner_view_mode') || ($('#resultsViewToggle [data-view].active')?.dataset.view) || 'schedule');

  // Landlord / Tenant perspective toggle
  $$('#perspectiveToggles .perspective-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#perspectiveToggles .perspective-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePerspective = btn.dataset.perspective || 'landlord';
      calculate(); // recompute using chosen basis
    });
  });


  // ------------------------------- Service includes UI ------------------------
  /* ===== Service includes + Custom passthroughs (scoped + idempotent) ===== */
  (() => {
    if (window.__customOpsInit) return;   // run once
    window.__customOpsInit = true;

    const d = document;
    const q = (sel, root = d) => root.querySelector(sel);
    const qa = (sel, root = d) => Array.from(root.querySelectorAll(sel));

    // --- Core controls ------------------------------------------------------
    const serviceType = q('#serviceType');
    const incTaxes = q('#incTaxes');
    const incCam = q('#incCam');
    const incIns = q('#incIns');

    // Custom-expense DOM
    const customSection = q('#customExpSection');
    const customList = q('#customExpList');
    const rowTpl = q('#tplCustomExpRow');
    const addBtn = q('#addCustomExp');

    // Show base-year for a single line based on its mode
    function toggleBaseFor(line /* 'taxes'|'cam'|'ins' */) {
      const modeSel = q(`#${line}Mode`);
      const baseWrap = q(`.opx-base[data-for="${line}"]`);
      if (!modeSel || !baseWrap) return;
      baseWrap.style.display = (modeSel.value === 'stop') ? '' : 'none';
    }
    ['taxes', 'cam', 'ins'].forEach(line => {
      const sel = q(`#${line}Mode`);
      if (sel) {
        sel.addEventListener('change', () => toggleBaseFor(line));
        toggleBaseFor(line);
      }
    });

    function syncIncludes() {
      const v = serviceType?.value || 'nnn';

      // NEW: expose the selection to CSS (used by #ner-form[data-service="custom"] rules)
      const formEl = document.getElementById('ner-form');
      if (formEl) formEl.dataset.service = v;

      const show = (sel, on) => qa(sel).forEach(el => (el.style.display = on ? '' : 'none'));
      const setAll = (checked, disabled) =>
        [incTaxes, incCam, incIns].forEach(cb => { if (!cb) return; cb.checked = checked; cb.disabled = disabled; });

      // default state
      show('.opx-mode', false);
      show('.opx-base', false);
      customSection?.classList.add('hidden');

      if (v === 'nnn') {
        // Triple-net: tenant pays all; lock switches
        setAll(true, true);
      } else if (v === 'gross') {
        // Gross: landlord pays all; lock switches
        setAll(false, true);
      } else if (v === 'mg_stop') {
        // Base-year stop across the 3 core lines
        setAll(false, true);
        show('.opx-base', true);
      } else if (v === 'custom') {
        // Universal “Custom” mode
        [incTaxes, incCam, incIns].forEach(cb => cb && (cb.disabled = true));
        show('.opx-mode', true);              // per-line mode selects
        customSection?.classList.remove('hidden');
      } else {
        // Fallback
        [incTaxes, incCam, incIns].forEach(cb => cb && (cb.disabled = false));
      }
    }
    serviceType?.addEventListener('change', syncIncludes);
    syncIncludes();


    // --- Custom expenses UI -------------------------------------------------
    let rowSeq = 0;

    function updateCustomRowModeUI(rowEl) {
      const modeSel = q('.cx-mode', rowEl);
      const baseWrap = q('.cx-base-wrap', rowEl);
      const kicker = q('.cx-kicker', rowEl); // optional helper text
      const isStop = modeSel?.value === 'stop';
      if (baseWrap) baseWrap.style.display = isStop ? '' : 'none';
      if (kicker) kicker.hidden = !isStop;
    }

    function addCustomRow(prefill = {}) {
      if (!rowTpl || !customList) return;
      const node = rowTpl.content.firstElementChild.cloneNode(true);
      node.dataset.idx = String(++rowSeq);

      q('.cx-label', node).value = prefill.label ?? '';
      q('.cx-val', node).value = prefill.value ?? '';
      q('.cx-growth', node).value = prefill.growth ?? '';
      q('.cx-growthUnit', node).value = prefill.growthUnit ?? 'pct';
      q('.cx-mode', node).value = prefill.mode ?? 'tenant';
      q('.cx-base', node).value = prefill.base ?? '';

      updateCustomRowModeUI(node);
      customList.appendChild(node);
    }

    // delegated events
    customList?.addEventListener('click', (e) => {
      const btn = e.target.closest('.cx-delete');
      if (!btn) return;
      btn.closest('.cx-row')?.remove();
    });
    customList?.addEventListener('change', (e) => {
      const sel = e.target.closest('.cx-mode');
      if (!sel) return;
      updateCustomRowModeUI(sel.closest('.cx-row'));
    });
    addBtn?.addEventListener('click', () => addCustomRow());

    // expose to engine
    function readCustomRows() {
      if (!customList) return [];
      const rows = [];
      qa('.cx-row', customList).forEach(row => {
        rows.push({
          label: (q('.cx-label', row)?.value || 'Expense').trim(),
          value: q('.cx-val', row)?.value ?? '',          // $/SF/yr (Y1)
          growth: q('.cx-growth', row)?.value ?? '',      // raw value; parse by unit
          growthUnit: q('.cx-growthUnit', row)?.value || 'pct', // 'pct' | 'flat'
          mode: q('.cx-mode', row)?.value || 'tenant',    // 'tenant' | 'stop' | 'landlord'
          base: q('.cx-base', row)?.value ?? ''           // $/SF/yr; blank = auto Y1
        });
      });
      return rows;
    }
    window.readCustomRows = readCustomRows;
    window.addCustomCustomExpenseRow = addCustomRow; // optional helper

    // --- Escalation UI for the base rent panel (reuse if you already have it) ---
    const escUnit = q('#escUnit');
    const escInput = q('#escalation');
    const escCustomWrap = q('#escCustomWrap');

    function syncEscUI() {
      if (!escUnit) return;
      const mode = escUnit.value;
      if (mode === 'pct') {
        if (escInput) { escInput.dataset.format = 'percent'; escInput.placeholder = '3.0'; }
        escCustomWrap && (escCustomWrap.style.display = 'none');
      } else if (mode === 'flat') {
        if (escInput) { escInput.dataset.format = 'money'; escInput.placeholder = '0.50'; }
        escCustomWrap && (escCustomWrap.style.display = 'none');
      } else if (mode === 'custom_pct') {
        escCustomWrap && (escCustomWrap.style.display = '');
        // (optional) tweak the placeholder on the custom list input:
        document.getElementById('escCustom')?.setAttribute('placeholder', 'e.g., 3, 3, 2.5 …');
      } else { // 'custom' -> dollars list (existing behavior)
        escCustomWrap && (escCustomWrap.style.display = '');
        document.getElementById('escCustom')?.setAttribute('placeholder', 'e.g., 0.50, 0.50, 0.75 …');
      }
    }
    escUnit?.addEventListener('change', syncEscUI);
    syncEscUI();

    // formatters on blur (uses your existing formatOnBlur)
    qa('input[data-format]').forEach(i => i.addEventListener('blur', formatOnBlur));
  })();

  // ------------------------------- Calculate / Reset --------------------------
  document.getElementById('calcBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    calculate();
    $('.panel-results')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Allow Enter anywhere in the form (except inside a textarea/button) to calculate
  document.getElementById('ner-form')?.addEventListener('keydown', (ev) => {
    const tag = ev.target?.tagName;
    if (ev.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'BUTTON') {
      ev.preventDefault();
      calculate();
    }
  });

  document.getElementById('resetBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('ner-form')?.reset();
    syncIncludes();
    syncEscUI();
    window.__ner_last = null;
    const table = document.getElementById('scheduleTable');
    const thead = table?.querySelector('thead');
    const tbody = table?.querySelector('tbody');
    thead && (thead.innerHTML = "");
    tbody && (tbody.innerHTML = "");
    if (window.charts && window.charts.update) window.charts.update(null);

    // zero KPIs
    ['nerPV', 'nerSimple', 'pvRent', 'pvTI', 'avgNetMonthly', 'avgGrossMonthly', 'totalNet', 'totalGross', 'gciTotal']
      .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = "$0.00"; });
    const leaseStartEl = document.getElementById('leaseStart');
    const leaseEndEl = document.getElementById('leaseEnd');
    if (leaseStartEl) leaseStartEl.textContent = "—";
    if (leaseEndEl) leaseEndEl.textContent = "—";

    activeView = "monthly";
    viewToggles.forEach(b => b.classList.toggle("active", b.dataset.view === "monthly"));
  });

  // ------------------------------- Main Calculate -----------------------------
  function calculate() {
    try {
      // -----------------------------------------------------------------------
      // Grab table refs
      // -----------------------------------------------------------------------
      const tableEl = document.getElementById('scheduleTable');
      const thead = tableEl?.querySelector('thead');
      const tbody = tableEl?.querySelector('tbody');

      // -----------------------------------------------------------------------
      // Read inputs
      // -----------------------------------------------------------------------
      const suite = $('#suite')?.value.trim() || '';
      const area = rawNumberFromInput($('#area'));
      const termUnit = $('#termUnit')?.value || 'months';
      let term = parseInt($('#term')?.value || "0", 10);
      if (termUnit === "years") term = term * 12;

      const startDate = parseDateInput($('#commencement')?.value || '');

      // Base rent + escalation
      const baseRent = rawNumberFromInput($('#startBase')); // $/SF/yr
      const escMode = getEscMode();
      let escalation = 0;    // %/yr (decimal)
      let escFlat = 0;    // $/SF/yr
      let escList = [];   // custom $ list

      // after: let escalation=0, escFlat=0, escList=[]
      let escPctList = [];

      if (escMode === 'pct') {
        escalation = rawNumberFromInput($('#escalation')) / 100;
      } else if (escMode === 'flat') {
        escFlat = rawNumberFromInput($('#escalation'));
      } else if (escMode === 'custom_pct') {
        const raw = ($('#escCustom')?.value || '').trim();
        escPctList = raw
          .split(',')
          .map(s => parseFloat(s.replace(/[^0-9.\-]/g, '')))
          .filter(v => Number.isFinite(v))
          .map(v => v / 100); // convert to decimals
      } else {
        const raw = ($('#escCustom')?.value || '').trim();
        escList = raw
          .split(',')
          .map(s => parseFloat(s.replace(/[^0-9.\-]/g, '')))
          .filter(v => Number.isFinite(v));
      }

      // Abatement options
      const freeMonths = parseInt($('#freeMonths')?.value || "0", 10);
      const freePlacement = ($('#freePlacement')?.value || "inside").toLowerCase(); // 'inside' | 'outside'
      const freeTiming = ($('#freeTiming')?.value || "begin").toLowerCase();  // 'begin' | 'end'
      const abateType = ($('input[name="abateType"]:checked')?.value || "net").toLowerCase(); // 'net' | 'gross'
      const abateCustomSpec = ($('#abateCustom')?.value || "").trim();

      // CapEx / TI (readCapex helper already in your code)
      const { rows: capexRows, totalCapex } =
        (window.readCapex ? window.readCapex(area) : { rows: [], totalCapex: 0 });

      const llAllowVal = rawNumberFromInput($('#llAllow'));
      const llAllowUnit = $('#llAllowUnit')?.value || 'per_sf';
      const llAllowTotal = (llAllowUnit === 'per_sf') ? (llAllowVal * area) : llAllowVal;

      const llAllowanceApplied = Math.min(llAllowTotal, totalCapex);
      const tenantContribution = Math.max(0, totalCapex - llAllowanceApplied);

      const llAllowTreatment = $('#llAllowTreatment')?.value || 'cash';  // 'cash' | 'amort'
      const llAllowApr = rawNumberFromInput($('#llAllowApr')) / 100;

      // For table display ($/SF)
      const tiPerSF_forDisplay = area ? (llAllowanceApplied / area) : 0;

      // Services + OpEx + growth
      const type = $('#serviceType')?.value || 'nnn'; // 'nnn' | 'gross' | 'mg_stop' | 'custom'
      const taxes = rawNumberFromInput($('#taxes'));
      const cam = rawNumberFromInput($('#cam'));
      const ins = rawNumberFromInput($('#ins'));
      const mgmtRatePct = +document.getElementById('mgmtRate')?.value || 0; // e.g. 3.0
      const mgmtAppliedOn = document.getElementById('mgmtAppliedOn')?.value || 'gross';
      const mgmtCfg = { ratePct: mgmtRatePct, appliedOn: mgmtAppliedOn };

      const extraOpExRows = (type === 'custom') ? readAdditionalOpEx() : [];
      const hasOtherOpEx = extraOpExRows.length > 0;

      const taxesGrowthRaw = rawNumberFromInput($('#taxesGrowth'));
      const camGrowthRaw = rawNumberFromInput($('#camGrowth'));
      const insGrowthRaw = rawNumberFromInput($('#insGrowth'));

      const taxesGrowthUnit = $('#taxesGrowthUnit')?.value || 'pct';
      const camGrowthUnit = $('#camGrowthUnit')?.value || 'pct';
      const insGrowthUnit = $('#insGrowthUnit')?.value || 'pct';

      const taxesGrowthPct = (taxesGrowthUnit === "pct") ? taxesGrowthRaw / 100 : 0;
      const camGrowthPct = (camGrowthUnit === "pct") ? camGrowthRaw / 100 : 0;
      const insGrowthPct = (insGrowthUnit === "pct") ? insGrowthRaw / 100 : 0;

      const taxesGrowthFlat = (taxesGrowthUnit === "flat") ? taxesGrowthRaw : 0;
      const camGrowthFlat = (camGrowthUnit === "flat") ? camGrowthRaw : 0;
      const insGrowthFlat = (insGrowthUnit === "flat") ? insGrowthRaw : 0;

      // Custom / Base-year stop extra controls
      const taxesMode = $('#taxesMode')?.value || 'tenant'; // 'tenant' | 'landlord' | 'stop'
      const camMode = $('#camMode')?.value || 'tenant';
      const insMode = $('#insMode')?.value || 'tenant';
      const taxesBaseAnn = rawNumberFromInput($('#taxesBase')); // $/SF/yr or blank for auto
      const camBaseAnn = rawNumberFromInput($('#camBase'));
      const insBaseAnn = rawNumberFromInput($('#insBase'));

      // Legacy include flags (fallback for “Other” type)
      const includeTaxes = !!$('#incTaxes')?.checked;
      const includeCam = !!$('#incCam')?.checked;
      const includeIns = !!$('#incIns')?.checked;

      // Commission & discount
      const brokerCommPct = rawNumberFromInput($('#brokerCommission')) / 100;
      const brokerCommBasis = ($('#brokerCommBasis')?.value || "gross").toLowerCase();
      // Parse commission percent as a number like 0.06 for "6.0"
      const brokerPct = rawPercentFromInput
        ? rawPercentFromInput(document.getElementById('brokerCommission'))
        : ((parseFloat((document.getElementById('brokerCommission')?.value || '').replace(/[,%\s]/g, '')) || 0) / 100);

      const brokerBasis = (document.getElementById('brokerCommBasis')?.value || 'gross');

      // -- Commissions & NPV chip -------------------------
      // NEW: commission is "included" whenever the field has a positive value
      const includeBrokerComm = brokerPct > 0;
      const hideCommissionUI = !!$('#hideCommUi')?.checked;

      // single source of truth for visibility:
      const showCommissionCard = includeBrokerComm && !hideCommissionUI;
      setCommissionUI(showCommissionCard);

      const discount = rawNumberFromInput($('#discount')) / 100;   // annual
      const rMonthly = Math.pow(1 + discount, 1 / 12) - 1;

      if (!area || !term) { alert("Please enter Space Size and Lease Term."); return; }

      // -----------------------------------------------------------------------
      // First-month proration for PV
      // -----------------------------------------------------------------------
      const startDay = startDate.getDate();
      const daysInStartMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate();
      const firstMonthProration = (startDay > 1)
        ? (daysInStartMonth - startDay + 1) / daysInStartMonth
        : 1;
      const pvStartOffset = (startDay > 1) ? firstMonthProration : 0;

      // -----------------------------------------------------------------------
      // PV of TI concession
      // ---------------- PV of TI concession (cash vs amort) ----------------
      let pvTI_cash = 0;  // PV of applied TI if cash
      let pvTI_amort = 0;  // PV of applied TI if amort (defined even when not used)
      let pvTI_forNER = 0;  // <-- use this in NER
      let tiOfferPV = 0;  // <-- use this in KPI "Total Incentive Value (PV)"

      if (llAllowTotal > 0) {
        if (llAllowTreatment === 'amort' && term > 0) {
          const i_m = Math.max(0, llAllowApr) / 12;
          const annuityPmt = (P) => i_m > 0
            ? (P * i_m) / (1 - Math.pow(1 + i_m, -term))
            : (P / term);

          const pmtApplied = annuityPmt(llAllowanceApplied); // PV for NER
          const pmtOffer = annuityPmt(llAllowTotal);       // PV for KPI

          let pvApplied = 0, pvOffer = 0;
          for (let k = 0; k < term; k++) {
            const t = k + pvStartOffset;
            const disc = 1 / Math.pow(1 + rMonthly, t);
            pvApplied += pmtApplied * disc;
            pvOffer += pmtOffer * disc;
          }

          pvTI_amort = pvApplied;
          pvTI_cash = llAllowanceApplied; // kept for completeness
          pvTI_forNER = pvApplied;          // use this in NER
          tiOfferPV = pvOffer;            // use this in KPI
        } else {
          // cash treatment: PV equals the amount
          pvTI_cash = llAllowanceApplied;
          pvTI_amort = 0;                  // make sure it's defined
          pvTI_forNER = llAllowanceApplied; // use this in NER
          tiOfferPV = llAllowTotal;       // KPI uses the full offer
        }
      } else {
        // no TI
        pvTI_cash = pvTI_amort = pvTI_forNER = tiOfferPV = 0;
      }

      // -----------------------------------------------------------------------
      // Schedule length with “outside” or custom abatement
      // -----------------------------------------------------------------------
      let scheduleMonths = term + (freePlacement === "outside" ? freeMonths : 0);

      function parseCustomMonths(spec, defaultLen) {
        const set = new Set();
        if (!spec) return set;
        // "1-3, 7, 15-18"
        for (const part of spec.split(',')) {
          const p = part.trim();
          if (!p) continue;
          if (p.includes('-')) {
            const [a, b] = p.split('-').map(v => parseInt(v.trim(), 10));
            const lo = Math.min(a, b), hi = Math.max(a, b);
            for (let m = lo; m <= hi; m++) set.add(m);
          } else {
            const v = parseInt(p, 10);
            if (Number.isFinite(v)) set.add(v);
          }
        }
        // ensure schedule big enough to include the farthest custom abate month
        return set;
      }
      const customSet = parseCustomMonths(abateCustomSpec, scheduleMonths);
      if (customSet.size) scheduleMonths = Math.max(scheduleMonths, Math.max(...customSet));

      const isMonthAbated = (m) => {
        if (customSet.size) return customSet.has(m);
        if (!freeMonths) return false;
        if (freePlacement === "inside") {
          if (freeTiming === "begin") return m <= freeMonths;
          return (m > (term - freeMonths)) && (m <= term);
        } else {
          if (freeTiming === "begin") return m <= freeMonths;
          return m > term;
        }
      };

      // -----------------------------------------------------------------------
      // Helpers
      // -----------------------------------------------------------------------
      const growOpEx = (baseAnnPSF, unit, pct, flat$, yearIndex) =>
        (unit === "pct") ? baseAnnPSF * Math.pow(1 + pct, yearIndex)
          : baseAnnPSF + (yearIndex * flat$);

      // Treat pass-through category → split tenant vs LL based on mode
      // mode: 'tenant' | 'landlord' | 'stop'
      // monthlyPSF = current monthly charge; baseAnnForStop = annual $/SF for base-year
      function treatCategory(mode, monthlyPSF, baseAnnForStop) {
        if (mode === "tenant") return { tenantPSF: monthlyPSF, llPSF: 0 };
        if (mode === "landlord") return { tenantPSF: 0, llPSF: monthlyPSF };
        // base-year stop → only increases above base are tenant
        const incMonthly = Math.max(0, (monthlyPSF * 12) - baseAnnForStop) / 12;
        return { tenantPSF: incMonthly, llPSF: monthlyPSF };
      }

      // --- Auto base-year stop helper (handles "first full calendar year") ---
      function autoBaseForStop(currPSF, unit, pct, flat) {
        const idx = startDate.getMonth() > 0 ? 1 : 0; // first full calendar year if start ≠ Jan
        return (unit === 'pct') ? currPSF * Math.pow(1 + pct, idx)
          : currPSF + idx * flat;
      }
  

      // Precompute annual base amounts when a line is in "base-year stop" mode.
      const taxesStopBaseAnn = taxesBaseAnn || autoBaseForStop(taxes, taxesGrowthUnit, taxesGrowthPct, taxesGrowthFlat);
      const camStopBaseAnn = camBaseAnn || autoBaseForStop(cam, camGrowthUnit, camGrowthPct, camGrowthFlat);
      const insStopBaseAnn = insBaseAnn || autoBaseForStop(ins, insGrowthUnit, insGrowthPct, insGrowthFlat);

      // -----------------------------------------------------------------------
      // Build the schedule (per-month rows)
      // -----------------------------------------------------------------------
      if (thead) thead.innerHTML = "";
      if (tbody) tbody.innerHTML = "";

      let pvRent = 0, pvRentNet = 0, totalPaidNet = 0, totalPaidGross = 0;
      let pvLLOpex = 0, totalLLOpex = 0;

      // New KPI accumulators
      let freeGrossNominal = 0;
      let freeGrossPV = 0;
      let abatedMonths = 0;
      let tenantOpExNominal = 0; // tenant-paid OpEx over term (gross - net)

      // If you later want LL OpEx carry inside cash outlay, you already have pvLLOpex/totalLLOpex
      const schedule = [];

      const outsideBeginOffset = (freePlacement === "outside" && freeTiming === "begin") ? freeMonths : 0;

      const baseAnnualPSFForIndex = (idx) => {
        if (escMode === 'pct') {
          return baseRent * Math.pow(1 + escalation, idx);
        } else if (escMode === 'flat') {
          return baseRent + (idx * escFlat);
        } else if (escMode === 'custom_pct') {
          let factor = 1;
          for (let i = 0; i < idx; i++) {
            const p = (i < escPctList.length) ? escPctList[i] : (escPctList[escPctList.length - 1] || 0);
            factor *= (1 + p);
          }
          return baseRent * factor;
        } else {
          let inc = 0;
          for (let i = 0; i < idx; i++) {
            inc += (i < escList.length) ? escList[i] : (escList[escList.length - 1] || 0);
          }
          return baseRent + inc;
        }
      };

      const mgmtRateDecimal = (+mgmtRatePct || 0) / 100;
      const mgmtStopBaseAnn = (type === 'mg_stop' && mgmtRateDecimal > 0)
        ? baseAnnualPSFForIndex(startDate.getMonth() > 0 ? 1 : 0) * mgmtRateDecimal
        : 0;

      for (let m = 1; m <= scheduleMonths; m++) {
        const rowDate = new Date(startDate.getFullYear(), startDate.getMonth() + (m - 1), 1);

        // Anniversary for base rent
        const annivYearIndex = Math.floor((m - 1) / 12);
        const yearIndex = annivYearIndex;

        // ✅ OpEx always calendar-year growth
        const opxYearIndex = rowDate.getFullYear() - startDate.getFullYear();

        // --- “Other” accumulators (reset every month)
        let otherTenantMoPSF = 0;
        let otherLLMoPSF = 0;
        let otherTenantAnnPSF = 0;

        // --- Compute “Other” rows (per spec)
        for (const x of extraOpExRows) {
          const gPct = (x.unit === 'pct') ? (x.growth / 100) : 0;
          const gFlat = (x.unit === 'flat') ? x.growth : 0;

          const otherAnnPSF = growOpEx(x.rate, x.unit, gPct, gFlat, opxYearIndex);
          const otherMoPSF = otherAnnPSF / 12;

          const stopBaseAnn = (x.mode === 'stop') ? (x.base || x.rate) : 0;

          const { tenantPSF, llPSF } =
            (x.mode === 'stop')
              ? treatCategory('stop', otherMoPSF, stopBaseAnn)
              : treatCategory(x.mode, otherMoPSF, stopBaseAnn);

          otherTenantMoPSF += tenantPSF;
          otherLLMoPSF += llPSF;
          otherTenantAnnPSF += tenantPSF * 12;
        }

        // Base rent escalation
        const baseAnnualPSF = baseAnnualPSFForIndex(yearIndex);

        // OpEx (annual PSF) for this row (calendar basis)
        const taxesAnnualPSF = growOpEx(taxes, taxesGrowthUnit, taxesGrowthPct, taxesGrowthFlat, opxYearIndex);
        const camAnnualPSF = growOpEx(cam, camGrowthUnit, camGrowthPct, camGrowthFlat, opxYearIndex);
        const insAnnualPSF = growOpEx(ins, insGrowthUnit, insGrowthPct, insGrowthFlat, opxYearIndex);

        // Convert to monthly PSF
        let baseMonthlyPSF = baseAnnualPSF / 12;
        const txMo = taxesAnnualPSF / 12;
        const camMo = camAnnualPSF / 12;
        const insMo = insAnnualPSF / 12;

        let tenTxMo = 0, tenCamMo = 0, tenInsMo = 0;
        let llTxMo = 0, llCamMo = 0, llInsMo = 0;
        let llOpexPSF = 0;

        if (type === "nnn") {
          tenTxMo = txMo; tenCamMo = camMo; tenInsMo = insMo;
          // LL pays none
        } else if (type === "gross") {
          llTxMo = txMo; llCamMo = camMo; llInsMo = insMo;
          llOpexPSF = txMo + camMo + insMo;
        } else if (type === "mg_stop") {
          const t = treatCategory('stop', txMo, taxesStopBaseAnn);
          const c = treatCategory('stop', camMo, camStopBaseAnn);
          const i = treatCategory('stop', insMo, insStopBaseAnn);
          tenTxMo = t.tenantPSF; tenCamMo = c.tenantPSF; tenInsMo = i.tenantPSF;
          llTxMo = t.llPSF; llCamMo = c.llPSF; llInsMo = i.llPSF;
          llOpexPSF = llTxMo + llCamMo + llInsMo;
        } else if (type === "custom") {
          const t = (taxesMode === 'stop') ? treatCategory('stop', txMo, taxesStopBaseAnn) : treatCategory(taxesMode, txMo, taxesStopBaseAnn);
          const c = (camMode === 'stop') ? treatCategory('stop', camMo, camStopBaseAnn) : treatCategory(camMode, camMo, camStopBaseAnn);
          const i = (insMode === 'stop') ? treatCategory('stop', insMo, insStopBaseAnn) : treatCategory(insMode, insMo, insStopBaseAnn);
          tenTxMo = t.tenantPSF; tenCamMo = c.tenantPSF; tenInsMo = i.tenantPSF;
          llTxMo = t.llPSF; llCamMo = c.llPSF; llInsMo = i.llPSF;
          llOpexPSF = llTxMo + llCamMo + llInsMo;
        } else {
          // Legacy fallback (include flags)
          tenTxMo = includeTaxes ? txMo : 0;
          tenCamMo = includeCam ? camMo : 0;
          tenInsMo = includeIns ? insMo : 0;
        }

        // tenant OpEx (core lines) before abatement this month
        const preTenantOpExPSF_core = tenTxMo + tenCamMo + tenInsMo;

        // what the tenant would have paid without abatement (for “free” PV lines)
        const cashFactor = (m === 1 ? firstMonthProration : 1);

        // base BEFORE any abatement is applied this month
        const preNetPay = baseMonthlyPSF * area * cashFactor;

        // gross before abatement = base + (tenant OpEx core + Other) dollars
        const preGrossPay = (baseMonthlyPSF + preTenantOpExPSF_core + otherTenantMoPSF) * area * cashFactor;

        // stash for the grid rows
        const preBase$ = preNetPay;
        const isTermMonth = (m - outsideBeginOffset) >= 1 && (m - outsideBeginOffset) <= term;

        const inFree = isMonthAbated(m);
        if (inFree) {
          if (abateType === "gross") {
            // forgive base + ALL tenant-paid OpEx, including “Other”
            baseMonthlyPSF = 0;
            tenTxMo = 0; tenCamMo = 0; tenInsMo = 0;
            // We'll zero the combined tenant OpEx below too (defensive)
          } else {
            // net abatement: base only
            baseMonthlyPSF = 0;
          }
        }

        // Tenant-other: zero if gross abatement
        const otherTenMoPSF = (inFree && abateType === "gross") ? 0 : otherTenantMoPSF;

        // Dollars (use proration)
        const tenTax$ = ((inFree && abateType === "gross") ? 0 : tenTxMo) * area * cashFactor;
        const tenCam$ = ((inFree && abateType === "gross") ? 0 : tenCamMo) * area * cashFactor;
        const tenIns$ = ((inFree && abateType === "gross") ? 0 : tenInsMo) * area * cashFactor;
        const tenOth$ = otherTenMoPSF * area * cashFactor;
        const other$ = tenOth$;

        const llTax$ = llTxMo * area * cashFactor;
        const llCam$ = llCamMo * area * cashFactor;
        const llIns$ = llInsMo * area * cashFactor;
        const llOth$ = otherLLMoPSF * area * cashFactor;

        // Combine tenant OpEx (include “Other”); then apply gross abatement zeroing
        let tenantOpExPSF = preTenantOpExPSF_core + otherTenantMoPSF;
        if (inFree && abateType === "gross") tenantOpExPSF = 0;

        // Landlord OpEx also gets the LL share of “Other”
        llOpexPSF += otherLLMoPSF;

        // Gross = base + tenant OpEx
        const netMonthlyPSF = baseMonthlyPSF;
        const grossMonthlyPSF = baseMonthlyPSF + tenantOpExPSF;

        // Cash (pre-fee)
        const netPay = netMonthlyPSF * area * cashFactor;
        let grossPay = grossMonthlyPSF * area * cashFactor;  // let: may add fee

        // Management Fee (no fee-on-fee, applied to post-abatement base)
        let mgmtFee$ = 0, tenantMgmt$ = 0, llMgmt$ = 0, contractMgmtAnnualPSF = 0;
        let tenantMgmtMoPSFShare = 0;
        let llMgmtMoPSFShare = 0;
        const preMgmtGross = grossPay;

        if (mgmtRateDecimal > 0) {
          const appliedBase = (mgmtAppliedOn === 'net') ? netPay : preMgmtGross;

          mgmtFee$ = appliedBase * mgmtRateDecimal;
          const mgmtMoPSF = (area && cashFactor) ? (mgmtFee$ / (area * cashFactor)) : 0;

          if (type === 'nnn') {
            tenantMgmtMoPSFShare = mgmtMoPSF;
          } else if (type === 'gross') {
            llMgmtMoPSFShare = mgmtMoPSF;
          } else if (type === 'mg_stop') {
            const share = treatCategory('stop', mgmtMoPSF, mgmtStopBaseAnn);
            tenantMgmtMoPSFShare = share.tenantPSF;
            llMgmtMoPSFShare = share.llPSF;
          } else if (type === 'custom') {
            const mgmtMode = (camMode || 'tenant').toLowerCase();
            const baseForStop = (mgmtMode === 'stop') ? (camBaseAnn || camStopBaseAnn || 0) : 0;
            const share = (mgmtMode === 'stop')
              ? treatCategory('stop', mgmtMoPSF, baseForStop)
              : treatCategory(mgmtMode, mgmtMoPSF, baseForStop);
            tenantMgmtMoPSFShare = share.tenantPSF;
            llMgmtMoPSFShare = share.llPSF;
          }

          tenantMgmt$ = tenantMgmtMoPSFShare * area * cashFactor;
          llMgmt$ = llMgmtMoPSFShare * area * cashFactor;

          grossPay = preMgmtGross + tenantMgmt$;
          llOpexPSF += llMgmtMoPSFShare;

          contractMgmtAnnualPSF = (area && cashFactor) ? (mgmtMoPSF * 12) : 0;
        } else {
          grossPay = preMgmtGross;
        }

        // …then compute freeBase$ / recov$ using grossPay (now includes tenant mgmt if applicable)
        const freeBase$ = Math.max(0, preBase$ - netPay);
        const recov$ = Math.max(0, grossPay - netPay);

        totalPaidNet += netPay;
        totalPaidGross += grossPay;

        // PV factors
        const t = (m - 1) + pvStartOffset;
        const pvFactor = 1 / Math.pow(1 + rMonthly, t);
        pvRent += grossPay * pvFactor;
        pvRentNet += netPay * pvFactor;

        // LL OpEx dollars (after including Other)
        const llOpex$ = llOpexPSF * area * cashFactor;
        pvLLOpex += llOpex$ * pvFactor;
        totalLLOpex += llOpex$;

        // Value of free rent (use pre-abatement tallies)
        if (inFree) {
          abatedMonths += 1;
          const forgiven = (abateType === 'gross') ? preGrossPay : preNetPay;
          freeGrossNominal += forgiven;
          freeGrossPV += forgiven * pvFactor;
        }

        // Tenant OpEx paid (post-abatement)
        tenantOpExNominal += Math.max(0, grossPay - netPay);

        const isGrossAbated = inFree && (abateType === 'gross');

        // Identify row labels
        const calYear = rowDate.getFullYear();
        const monthName = rowDate.toLocaleString(undefined, { month: "short" });

        // Tenant mgmt as monthly PSF (used in PSF bundle)
        const tenantMgmtMoPSF = (tenantMgmt$ && area && cashFactor) ? (tenantMgmt$ / (area * cashFactor)) : 0;

        // Tenant-paid gross PSF (monthly)
        const tenGrossMoPSF =
          baseMonthlyPSF + tenTxMo + tenCamMo + tenInsMo + otherTenantMoPSF + tenantMgmtMoPSF;

        // Assemble the row FIRST, then push it
        const row = {
          // identifiers
          calYear,
          calMonth: monthName,
          month: monthName,
          monthIndex: m,

          // PSF (monthly, tenant-paid portions)
          basePSF: netMonthlyPSF,
          taxesPSF: tenTxMo,
          camPSF: tenCamMo,
          insPSF: tenInsMo,

          // “Other” tenant-paid monthly PSF + annualized display value
          otherPSF: otherTenantMoPSF,                 // monthly PSF (tenant-paid)
          contractOtherAnnualPSF: otherTenantAnnPSF,  // $/SF/yr (tenant-paid)

          // cash
          netTotal: netPay,
          grossTotal: grossPay,

          // breakdowns used by compare grid
          preBase$,
          freeBase$,
          other$,
          recoveries$: recov$,

          // extras
          llOpex$: llOpex$,
          area,
          isGrossAbated,
          cashFactor,
          isTermMonth,

          // tenant/LL OpEx dollars this month
          tenantTaxes$: tenTax$,
          tenantCam$: tenCam$,
          tenantIns$: tenIns$,
          tenantOther$: tenOth$,

          llTaxes$: llTax$,
          llCam$: llCam$,
          llIns$: llIns$,
          llOther$: llOth$,

          tenantMgmt$: tenantMgmt$,
          llMgmt$: llMgmt$,

          // annualized contract fields
          contractMgmtAnnualPSF,
          contractNetAnnualPSF: baseMonthlyPSF * 12,
          contractTaxesAnnualPSF: tenTxMo * 12,
          contractCamAnnualPSF: tenCamMo * 12,
          contractInsAnnualPSF: tenInsMo * 12
        };

        // PSF bundles (what the tables/renderers read)
        row.tenPSF = {
          net: (row.isGrossAbated ? 0 : baseMonthlyPSF) * 12,
          taxes: (row.isGrossAbated ? 0 : tenTxMo) * 12,
          cam: (row.isGrossAbated ? 0 : tenCamMo) * 12,
          ins: (row.isGrossAbated ? 0 : tenInsMo) * 12,
          other: (row.isGrossAbated ? 0 : otherTenantMoPSF) * 12,
          mgmt: (row.isGrossAbated ? 0 : tenantMgmtMoPSF) * 12,
          gross: (row.isGrossAbated ? 0 : tenGrossMoPSF) * 12
        };

        row.llPSF = {
          taxes: llTxMo * 12,
          cam: llCamMo * 12,
          ins: llInsMo * 12,
          other: otherLLMoPSF * 12
        };

        schedule.push(row);
      }

      // -----------------------------------------------------------------------
      // KPIs (PV & simple)
      // -----------------------------------------------------------------------

      function setTermChip(data) {
        const chip = document.getElementById('termChip');
        if (!chip) return;
    
        // Accept data.term OR data.termMonths; fallback to counting schedule months
        const termMonths =
          Number(data?.term ?? data?.termMonths ?? 0) ||
          (Array.isArray(data?.schedule)
            ? data.schedule.filter(m => m.isTermMonth ?? true).length
            : 0);
    
        chip.textContent = `Term: ${termMonths} ${termMonths === 1 ? 'Month' : 'Months'}`;
    
        // (Optional) hide if 0 or invalid
        chip.style.display = termMonths > 0 ? '' : 'none';
      }
     
      const yearsTerm = term / 12;
      const nerPV = (yearsTerm > 0 && area > 0)
        ? ((pvRentNet - pvTI_forNER) / area) / yearsTerm
        : 0;

      const nerSimple = (yearsTerm > 0 && area > 0)
        ? ((totalPaidNet - llAllowanceApplied) / area) / yearsTerm
        : 0;

      const avgNetMonthly = term > 0 ? (totalPaidNet / term) : 0;
      const avgGrossMonthly = term > 0 ? (totalPaidGross / term) : 0;

      // ----- KPI: Spread & Recovery
      const avgMonthlySpread = (totalPaidGross - totalPaidNet) / term;           // $/mo
      const recoveryRatio = (tenantOpExNominal + totalLLOpex) > 0
        ? tenantOpExNominal / (tenantOpExNominal + totalLLOpex)
        : null;

      // ----- KPI: All-in occupancy (avg gross per SF per month)
      const occPSFmo = (totalPaidGross / term) / area;

      // ----- KPI: Free Rent (PV) + (% term abated)
      const pctAbated = term > 0 ? (abatedMonths / term) : 0;

      // ----- Commission (Nominal & PV) – assume paid upfront on chosen basis
      let commissionNominal = 0;
      let commissionPV = 0;

      if (includeBrokerComm) {
        // (Use your existing formula here; example structure:)
        // const basisSeries = (brokerBasis === 'net') ? netPaymentsByMonth : grossPaymentsByMonth;
        // commissionNominal = basisSeries.reduce((s,v)=> s + v, 0) * brokerPct;
        // commissionPV      = basisSeries.reduce((s,v,i)=> s + (v * brokerPct) / Math.pow(1 + rMonthly, i+pvStartOffset), 0);
      }

      // ----- TI values available now:
      // pvTI_forNER  = PV of APPLIED allowance (cash => amount; amort => PV of annuity)
      // tiOfferPV    = PV of OFFERED allowance (cash => amount; amort => PV of annuity)

      let tiAmortPmt = 0;
      if (llAllowTreatment === 'amort' && term > 0) {
        const i_m = Math.max(0, llAllowApr) / 12;
        const annuityPmt = (P) => i_m > 0
          ? (P * i_m) / (1 - Math.pow(1 + i_m, -term))
          : (P / term);

        const pmtApplied = annuityPmt(llAllowanceApplied);
        const pmtOffered = annuityPmt(llAllowTotal); // NEW
        // Use applied if present; otherwise drive payments off the OFFER
        tiAmortPmt = (llAllowanceApplied > 0 ? pmtApplied : pmtOffered);
      } else {
        tiAmortPmt = 0;
      }

      // (A) what NER PV should use
      const tiAppliedPV = pvTI_forNER;

      // (B) Landlord Cash Outlay (PV) should use the **offer**, regardless of CapEx rows
      const llCashOutPV = (tiOfferPV || 0) + (includeBrokerComm ? commissionPV : 0);

      // (C) Total Incentive Value (PV) = Free Rent (PV) + TI Offer (PV)
      const totalIncentivePV = (freeGrossPV || 0) + (tiOfferPV || 0);

      function updateExtraKpis(modelLike) {
        const model = modelLike || window.__ner_last || {};
        const k = (model.kpis || {});

        // Destructure with safe defaults
        const freeGrossPV = Number(k.freeGrossPV) || 0;
        const freeGrossNominal = Number(k.freeGrossNominal) || 0;
        const pctAbated = Number(k.pctAbated);        // fraction 0..1 (may be NaN)
        const avgMonthlySpread = Number(k.avgMonthlySpread) || 0;
        const recoveryRatio = (k.recoveryRatio == null) ? null : Number(k.recoveryRatio);
        const llCashOutPV = Number(k.llCashOutPV) || 0;
        const occPSFmo = Number(k.occPSFmo);
        const totalIncentivePV = Number(k.totalIncentivePV) || 0;

        // 1) Free rent PV, nominal & % abated
        setText(EXTRA_KPI_IDS.freePV, fmt$0(freeGrossPV));
        setText(EXTRA_KPI_IDS.freeNominal, `${fmt$0(freeGrossNominal)} nominal`);
        if (Number.isFinite(pctAbated)) {
          setText(EXTRA_KPI_IDS.abatedPct, `${(pctAbated * 100).toFixed(1)}% of term abated`);
        }

        // 2) Spread + Recovery
        setText(EXTRA_KPI_IDS.spread, fmt$0(avgMonthlySpread));
        setText(EXTRA_KPI_IDS.recovery, (recoveryRatio == null)
          ? '—'
          : `${(recoveryRatio * 100).toFixed(1)}% OpEx recovered`
        );

        // 3) LL Cash Outlay (PV)
        setText(EXTRA_KPI_IDS.llCashPV, fmt$0(llCashOutPV));

        // 4) All-in Occupancy Cost ($/SF/mo)
        if (Number.isFinite(occPSFmo)) {
          setText(EXTRA_KPI_IDS.occPSFmo, `$${occPSFmo.toFixed(2)}/SF/mo`);
        }

        // 5) Total Incentive Value (PV)
        setText(EXTRA_KPI_IDS.incentivePV, fmt$0(totalIncentivePV));
      }

      // Write KPI cards (if present)
      if (leaseStartEl) {
        leaseStartEl.textContent = startDate.toLocaleString(undefined, { month: 'short', year: 'numeric' });
      }

      setTermChip({ term });

      // Use scheduleMonths so “outside” free months extend the displayed end date
      if (leaseEndEl) {
        const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + scheduleMonths - 1, 1);
        leaseEndEl.textContent = endDate.toLocaleString(undefined, { month: 'short', year: 'numeric' });
      }

      if (nerPVEl) nerPVEl.textContent = formatUSD(nerPV);
      if (nerSimpleEl) nerSimpleEl.textContent = formatUSD(nerSimple);
      if (avgNetMonthlyEl) avgNetMonthlyEl.textContent = formatUSD(avgNetMonthly);
      if (avgGrossMonthlyEl) avgGrossMonthlyEl.textContent = formatUSD(avgGrossMonthly);
      if (totalNetEl) totalNetEl.textContent = formatUSD(totalPaidNet);
      if (totalGrossEl) totalGrossEl.textContent = formatUSD(totalPaidGross);
    
      function renderKpis(data) {
        // ... existing KPI assignments (lease starts/ends, totals, etc.)
        document.getElementById('leaseEndsVal').textContent = data.leaseEndLabel; // your code
    
        // NEW: set the term chip
        setTermChip(data);
      }

      // -----------------------------------------------------------------------
      // Build “model” and publish for charts/scenarios
      // -----------------------------------------------------------------------
      const model = {
        suite,
        area,
        termMonths: term,
        leaseStartISO: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`,
        leaseEndISO: (() => {
          const d = new Date(startDate.getFullYear(), startDate.getMonth() + scheduleMonths - 1, 1);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        })(),
        nerPV,
        simpleNet: nerSimple,
        avgNetMonthly,
        avgGrossMonthly,
        totalPaidNet,
        totalPaidGross,
        schedule,

        serviceType: type,

        photoDataURL: window.__ner_photo || (localStorage.getItem('ner.photo') || null),

        // NEW: these are used by chips / extra KPIs
        mgmt: mgmtCfg,
        pvLLOpex,                      // PV of landlord-paid OpEx
        includeBrokerComm,             // boolean toggle
        commissionTotal: commissionPV, // if you treat commission as paid up-front
        tiPerSF_forDisplay             // used by some renderers
      };
      model.perspective = (localStorage.getItem('ner_perspective') || 'landlord');
      model.hasOtherOpEx = hasOtherOpEx;

      // attach the computed extras
      model.kpis = {
        freeGrossNominal, freeGrossPV, pctAbated,
        avgMonthlySpread, recoveryRatio, commissionPV, commissionNominal,
        occPSFmo,
        llCashOutPV, // <-- now offer-based
        tiAppliedPV, // PV of TI actually used (for audit/NER)
        tiOfferPV, // PV of allowance offered
        commissionNominal, // nominal $ (upfront)
        commissionTotal: commissionPV,     // or commissionNominal if that's what you display
        llAllowanceApplied: llAllowanceApplied, // nominal $ the LL actually funds
        tiAmortPmt, // monthly TI amort inflow (if amortized; else 0)
        tenantContribution, // $ tenant pays above allowance (already computed)
        totalIncentivePV,   // Free Rent (PV) + TI Offer (PV)
        llAllowanceOffered: llAllowTotal,
        llAllowTreatment: llAllowTreatment,                           // 'cash' | 'amort'
        llFreeTIY0:      (llAllowTreatment === 'cash'  ? llAllowanceApplied : 0),
        llFinancedTIY0:  (llAllowTreatment === 'amort' ? llAllowanceApplied : 0),
        totalCapex,              // NEW: Total Improvement Costs (for Build-Out Costs row)


        // A6 — expose TI amortization params for scenarios.js
        tiApr: llAllowApr,                              // annual (decimal)
        tiRateMonthly: Math.max(0, llAllowApr) / 12,    // monthly rate
        termMonths: term                                // mirror so scenarios can read from kpis
      };

  
      // update the new KPI cards (function you already defined above)
      updateExtraKpis(model);

      // after building model
      setTermChip(model); // works because the function checks data.termMonths

      // Store globally for charts/scenarios
      window.__ner_last = model;
      renderView(); // <-- update the schedule table for the active view

      // Refresh charts if visible
      if (!document.getElementById('analysis-charts')?.classList.contains('hidden') &&
        window.charts && typeof window.charts.update === 'function') {
        window.charts.update(model);
      }

      // If the “Lease Comparison” (scenario compare) view is showing, refresh it
      if (!document.getElementById('compareSection')?.classList.contains('hidden') &&
        typeof window.renderCompareGrid === 'function') {
        window.renderCompareGrid();
      }

      // Emit a custom event so other modules can listen
      window.dispatchEvent(new CustomEvent('ner:calculated', { detail: { model } }));

    } catch (err) {
      console.error(err);
      alert('Something went wrong while calculating. Please check inputs.');
    }
  }
    // Who pays this category across the schedule? (aggregates tenant vs LL)
    function payerLabel(schedule, key) {
      let tenant = 0, ll = 0;
      for (const r of schedule) {
        if (key === 'mgmt') {
          tenant += (r.tenantMgmt$ || 0);
          ll     += (r.llMgmt$     || 0);
        } else if (key === 'other') {
          tenant += (r.tenPSF?.other || 0);
          ll     += (r.llPSF?.other  || 0);
        } else {
          tenant += (r.tenPSF?.[key] || 0);
          ll     += (r.llPSF?.[key]  || 0);
        }
      }
      if (tenant === 0 && ll > 0) return 'LL-paid';
      if (tenant > 0 && ll === 0) return 'recovered';
      if (tenant === 0 && ll === 0) return '';
      return 'split';
    }
    
    // Tiny formatter for header badges used in table <th> labels
    function hdrBadge(text) {
      return text ? `<small class="hdr-note">${text}</small>` : '';
    }
  
  // ------------------------------- Renderers -----------------------------------
  function renderView() {
    const table = document.getElementById('scheduleTable');
    const thead = table?.querySelector('thead');
    const tbody = table?.querySelector('tbody');

    const data = window.__ner_last;
    if (!data || !table || !thead || !tbody) {
      thead && (thead.innerHTML = '');
      tbody && (tbody.innerHTML = '');
      return;
    }

    if (activeView === 'monthly') renderMonthly(data, table, thead, tbody);
    else if (activeView === 'annual') renderAnnual(data, table, thead, tbody);
    else renderMonthlyWithSubtotals(data, table, thead, tbody);
  }

  function annualPSFFromDollars(amount, area, cashFactor) {
    if (!area || !cashFactor) return 0;
    return (amount / (area * cashFactor)) * 12;
  }

  function buildTenantSchedule(model) {
    const schedule = Array.isArray(model?.schedule) ? model.schedule : [];
    const area = Number(model?.area) || 0;
    return schedule.map(row => {
      const cashFactor = Number(row.cashFactor) || 1;
      const base$ = Number(row.netTotal) || 0;
      const taxes$ = Number(row.tenantTaxes$) || 0;
      const cam$ = Number(row.tenantCam$) || 0;
      const ins$ = Number(row.tenantIns$) || 0;
      const mgmt$ = Number(row.tenantMgmt$) || 0;
      const custom$ = Number(row.tenantOther$) || 0;
      const totalOpEx$ = taxes$ + cam$ + ins$ + mgmt$ + custom$;
      const totalCashOut = base$ + totalOpEx$;
      return {
        period: row.monthIndex,
        year: row.calYear,
        month: row.calMonth,
        cashFactor,
        base: {
          psf: annualPSFFromDollars(base$, area, cashFactor),
          total: base$
        },
        opEx: {
          taxes: { psf: annualPSFFromDollars(taxes$, area, cashFactor), total: taxes$ },
          cam: { psf: annualPSFFromDollars(cam$, area, cashFactor), total: cam$ },
          ins: { psf: annualPSFFromDollars(ins$, area, cashFactor), total: ins$ },
          mgmt: { psf: annualPSFFromDollars(mgmt$, area, cashFactor), total: mgmt$ },
          custom: { psf: annualPSFFromDollars(custom$, area, cashFactor), total: custom$ }
        },
        totals: {
          monthlyCashOut: totalCashOut,
          grossOccPSF: annualPSFFromDollars(totalCashOut, area, cashFactor)
        }
      };
    });
  }

  function buildLandlordSchedule(model) {
    const schedule = Array.isArray(model?.schedule) ? model.schedule : [];
    return schedule.map(row => {
      const baseCollected = Number(row.netTotal) || 0;
      const taxesRecovery = Number(row.tenantTaxes$) || 0;
      const camRecovery = Number(row.tenantCam$) || 0;
      const insRecovery = Number(row.tenantIns$) || 0;
      const mgmtRecovery = Number(row.tenantMgmt$) || 0;
      const customRecovery = Number(row.tenantOther$) || 0;

      const totalRecovery = taxesRecovery + camRecovery + insRecovery + mgmtRecovery + customRecovery;
      const totalCashIn = baseCollected + totalRecovery;

      const freeRent = Number(row.freeBase$) || 0;
      const tiOutlay = Number(row.tiOutlayThisPeriod) || 0;
      const lcOutlay = Number(row.lcOutlayThisPeriod) || 0;

      const landlordOpEx =
        (Number(row.llTaxes$) || 0) +
        (Number(row.llCam$) || 0) +
        (Number(row.llIns$) || 0) +
        (Number(row.llOther$) || 0) +
        (Number(row.llMgmt$) || 0);

      const netCash = totalCashIn - freeRent - tiOutlay - lcOutlay;

      return {
        period: row.monthIndex,
        year: row.calYear,
        month: row.calMonth,
        baseCollected,
        recoveries: {
          taxes: taxesRecovery,
          cam: camRecovery,
          ins: insRecovery,
          mgmt: mgmtRecovery,
          custom: customRecovery
        },
        totals: {
          totalCashIn,
          freeRent,
          tiOutlay,
          lcOutlay,
          netCash,
          landlordOpEx,
          unrecoveredOpEx: landlordOpEx - totalRecovery
        }
      };
    });
  }

  function renderScheduleTable(model, perspective, table, thead, tbody) {
    const serviceType = (model?.serviceType || '').toLowerCase();
    const rows = perspective === 'tenant'
      ? buildTenantSchedule(model)
      : buildLandlordSchedule(model);

    if (!Array.isArray(rows) || rows.length === 0) {
      thead.innerHTML = '';
      tbody.innerHTML = '';
      return;
    }

    const columns = [];
    columns.push({ key: 'period', label: 'Period', render: r => r.period });
    columns.push({ key: 'year', label: 'Year', render: r => r.year });
    columns.push({ key: 'month', label: 'Month', render: r => r.month });

    if (perspective === 'tenant') {
      const catLabel = (base) => (serviceType === 'mg_stop' ? `${base} Over Base` : base);
      columns.push({ key: 'base_psf', label: 'Base Rent ($/SF/yr)', render: r => fmtUSD(r.base.psf) });
      columns.push({ key: 'base_total', label: 'Base Rent ($)', render: r => fmtUSD(r.base.total), sum: r => r.base.total });

      const tenantCats = [
        { key: 'taxes', label: catLabel('Taxes') },
        { key: 'cam', label: catLabel('CAM') },
        { key: 'ins', label: catLabel('Insurance') },
        { key: 'mgmt', label: catLabel('Management Fee') },
        { key: 'custom', label: 'Custom OpEx' }
      ];

      tenantCats.forEach(cat => {
        const total = rows.reduce((acc, r) => acc + (r.opEx?.[cat.key]?.total || 0), 0);
        if (total !== 0) {
          columns.push({
            key: `${cat.key}_psf`,
            label: `${cat.label} ($/SF/yr)`,
            render: r => fmtUSD(r.opEx?.[cat.key]?.psf || 0)
          });
          columns.push({
            key: `${cat.key}_total`,
            label: `${cat.label} ($)`,
            render: r => fmtUSD(r.opEx?.[cat.key]?.total || 0),
            sum: r => r.opEx?.[cat.key]?.total || 0
          });
        }
      });

      columns.push({
        key: 'cash_out',
        label: 'Monthly Cash Out ($)',
        render: r => fmtUSD(r.totals.monthlyCashOut),
        sum: r => r.totals.monthlyCashOut
      });
      columns.push({
        key: 'gross_occ',
        label: 'Gross Occupancy Cost ($/SF/yr)',
        render: r => fmtUSD(r.totals.grossOccPSF)
      });
    } else {
      columns.push({
        key: 'base_collected',
        label: 'Base Rent Collected ($)',
        render: r => fmtUSD(r.baseCollected),
        sum: r => r.baseCollected
      });

      const recoveryCats = [
        { key: 'taxes', label: 'Taxes Recovery ($)' },
        { key: 'cam', label: 'CAM Recovery ($)' },
        { key: 'ins', label: 'Insurance Recovery ($)' },
        { key: 'mgmt', label: 'Management Fee Recovery ($)' },
        { key: 'custom', label: 'Custom Recovery ($)' }
      ];

      recoveryCats.forEach(cat => {
        const total = rows.reduce((acc, r) => acc + (r.recoveries?.[cat.key] || 0), 0);
        if (total !== 0) {
          columns.push({
            key: `rec_${cat.key}`,
            label: cat.label,
            render: r => fmtUSD(r.recoveries?.[cat.key] || 0),
            sum: r => r.recoveries?.[cat.key] || 0
          });
        }
      });

      columns.push({
        key: 'total_cash_in',
        label: 'Total Cash In ($)',
        render: r => fmtUSD(r.totals.totalCashIn),
        sum: r => r.totals.totalCashIn
      });
      columns.push({
        key: 'free_rent',
        label: 'Free Rent Concession ($)',
        render: r => fmtUSD(r.totals.freeRent),
        sum: r => r.totals.freeRent
      });
      columns.push({
        key: 'ti_outlay',
        label: 'TI Outlay ($)',
        render: r => fmtUSD(r.totals.tiOutlay),
        sum: r => r.totals.tiOutlay
      });
      columns.push({
        key: 'lc_outlay',
        label: 'Leasing Commission ($)',
        render: r => fmtUSD(r.totals.lcOutlay),
        sum: r => r.totals.lcOutlay
      });
      columns.push({
        key: 'net_cash',
        label: 'Net Cash To Landlord ($)',
        render: r => fmtUSD(r.totals.netCash),
        sum: r => r.totals.netCash
      });
      columns.push({
        key: 'unrecovered_opx',
        label: 'Unrecovered OpEx ($)',
        render: r => fmtUSD(r.totals.unrecoveredOpEx),
        sum: r => r.totals.unrecoveredOpEx
      });
    }

    thead.innerHTML = '';
    const headerRow = document.createElement('tr');
    columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    tbody.innerHTML = '';
    const totals = new Array(columns.length).fill(0);

    rows.forEach(row => {
      const tr = document.createElement('tr');
      columns.forEach((col, idx) => {
        const td = document.createElement('td');
        td.textContent = col.render(row);
        tr.appendChild(td);
        if (typeof col.sum === 'function') {
          totals[idx] += Number(col.sum(row) || 0);
        }
      });
      tbody.appendChild(tr);
    });

    const totalRow = document.createElement('tr');
    totalRow.classList.add('grand-total');
    columns.forEach((col, idx) => {
      const td = document.createElement('td');
      if (idx === 0) {
        td.textContent = 'Grand Total';
      } else if (typeof col.sum === 'function') {
        td.textContent = fmtUSD(totals[idx]);
      } else {
        td.textContent = '—';
      }
      totalRow.appendChild(td);
    });
    tbody.appendChild(totalRow);
  }

// -----------------------------------------------------------------------
// Monthly Rent Schedule Table
// -----------------------------------------------------------------------
function renderMonthly(data, table, thead, tbody) {
  table.classList.remove('annual-view','monthly-sub-view');
  renderScheduleTable(data, activePerspective, table, thead, tbody);
} // <— IMPORTANT: close renderMonthly here

  // helper to construct period range for Annual (keep this)
  const periodRange = (rows) => {
    const start = rows[0]?.monthIndex || 1;
    const end   = rows[rows.length - 1]?.monthIndex || start;
    return (start === end) ? String(start) : `${start}\u2013${end}`; // en dash
  };

// -----------------------------------------------------------------------
// Annual Rent Schedule Table
// -----------------------------------------------------------------------
function renderAnnual(data, table, thead, tbody) {
  table.classList.add('annual-view');
  table.classList.remove('monthly-sub-view');

  const hasOther = !!data.hasOtherOpEx;
  const hasMgmt  = (data.mgmt?.ratePct || 0) > 0;

  // Tags aggregated across the whole schedule
  const taxTag   = hdrBadge(payerLabel(data.schedule, 'taxes'));
  const camTag   = hdrBadge(payerLabel(data.schedule, 'cam'));
  const insTag   = hdrBadge(payerLabel(data.schedule, 'ins'));
  const othTag   = hasOther ? hdrBadge(payerLabel(data.schedule, 'other')) : '';
  const mgmtTag  = hasMgmt  ? hdrBadge(payerLabel(data.schedule, 'mgmt'))  : '';

  thead.innerHTML = `<tr>
    <th>Period</th>
    <th>Year</th>
    <th>Months</th>
    <th>Space Size (SF)</th>
    <th>Net Rent ($/SF/yr)</th>
    <th>Taxes ($/SF/yr)${taxTag}</th>
    <th>CAM ($/SF/yr)${camTag}</th>
    <th>Insurance ($/SF/yr)${insTag}</th>
    ${hasOther ? `<th>Other ($/SF/yr)${othTag}</th>` : ''}
    ${hasMgmt ? `<th>Mgmt Fee (${data.mgmt?.appliedOn === 'net' ? 'on Net' : 'on Gross'}) ($/SF/yr)${mgmtTag}</th>` : ''}
    <th>Gross Rent ($/SF/yr)</th>
    <th>Monthly Net Rent</th>
    <th>Total Net Rent</th>
    <th>Monthly Gross Rent</th>
    <th>Total Gross Rent</th>
  </tr>`;

  tbody.innerHTML = '';

  const byYear = groupBy(data.schedule, r => r.calYear);
  const frag = document.createDocumentFragment();

  byYear.forEach((rows, yr) => {
    const months = rows.length;
    const area   = rows[0].area;

    const netPSF  = rows.reduce((s,r)=> s + ((r.tenPSF?.net)   || 0), 0) / months;
    const taxPSF  = rows.reduce((s,r)=> s + ((r.tenPSF?.taxes) || 0), 0) / months;
    const camPSF  = rows.reduce((s,r)=> s + ((r.tenPSF?.cam)   || 0), 0) / months;
    const insPSF  = rows.reduce((s,r)=> s + ((r.tenPSF?.ins)   || 0), 0) / months;
    const othPSF  = hasOther ? (rows.reduce((s,r)=> s + ((r.tenPSF?.other) || 0), 0) / months) : 0;
    const mgmtPSF = hasMgmt ?  (rows.reduce((s,r)=> s + ((r.tenPSF?.mgmt)  || 0), 0) / months) : 0;
    const grossPSF= rows.reduce((s,r)=> s + ((r.tenPSF?.gross) || 0), 0) / months;
    

    // show mgmt PSF, but only count tenant-paid share in gross PSF
    const mgmtPSFDisp   = hasMgmt ? (rows.reduce((s,r)=> s + (r.contractMgmtAnnualPSF || 0), 0) / months) : 0;
    const mgmtPSFTenant = hasMgmt ? (rows.reduce((s,r)=> s + ((r.tenantMgmt$ > 0 ? (r.contractMgmtAnnualPSF || 0) : 0)), 0) / months) : 0;

    const totalNet     = rows.reduce((s,r)=> s + r.netTotal,   0);
    const totalGross   = rows.reduce((s,r)=> s + r.grossTotal, 0);
    const monthlyNet   = totalNet   / months;
    const monthlyGross = totalGross / months;

    const period = periodRange(rows);

    const tr = document.createElement('tr');
    const cells = [
      period, yr, `${months} Months`,
      area.toLocaleString(),
      fmtUSD(netPSF), fmtUSD(taxPSF), fmtUSD(camPSF), fmtUSD(insPSF)
    ];
    if (hasOther) cells.push(fmtUSD(othPSF));
    if (hasMgmt)  cells.push(fmtUSD(mgmtPSFDisp));
    cells.push(
      fmtUSD(grossPSF),
      fmtUSD(monthlyNet), fmtUSD(totalNet),
      fmtUSD(monthlyGross), fmtUSD(totalGross)
    );

    cells.forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);

  // Grand Total (sum $ columns; $/SF/yr columns are averages, so not additive)
  const grandNet   = data.schedule.reduce((s, r) => s + (r.netTotal   || 0), 0);
  const grandGross = data.schedule.reduce((s, r) => s + (r.grossTotal || 0), 0);

  // Label spans through the new Gross Rent ($/SF/yr) column
  const labelColspan =
    4  /* Period, Year, Months, Space */ +
    4  /* Net/Taxes/CAM/Ins PSF */ +
    (hasOther ? 1 : 0) +
    (hasMgmt  ? 1 : 0) +
    1; /* Gross PSF */

  const gt = document.createElement('tr');
  gt.className = 'grand-total';

  const tdLabel = document.createElement('td');
  tdLabel.colSpan = labelColspan;
  tdLabel.textContent = 'Grand Total';
  gt.appendChild(tdLabel);

  const tdMonNet = document.createElement('td');   tdMonNet.textContent = '—'; tdMonNet.className = 'muted'; gt.appendChild(tdMonNet);
  const tdTotNet = document.createElement('td');   tdTotNet.textContent = fmtUSD(grandNet);     gt.appendChild(tdTotNet);
  const tdMonGro = document.createElement('td');   tdMonGro.textContent = '—'; tdMonGro.className = 'muted'; gt.appendChild(tdMonGro);
  const tdTotGro = document.createElement('td');   tdTotGro.textContent = fmtUSD(grandGross);   gt.appendChild(tdTotGro);

  tbody.appendChild(gt);
}

// -----------------------------------------------------------------------
// Monthly + Subotals Rent Schedule Table
// -----------------------------------------------------------------------
// -----------------------------------------------------------------------
// Monthly + Subtotals Rent Schedule Table (payer-aware + grand total)
// -----------------------------------------------------------------------
function renderMonthlyWithSubtotals(data, table, thead, tbody) {
  table.classList.remove('annual-view');
  table.classList.add('monthly-sub-view');

  const hasOther = !!data.hasOtherOpEx;
  const hasMgmt  = (data.mgmt?.ratePct || 0) > 0;

  // Dynamic payer badges under each OpEx header
  const taxTag = hdrBadge(payerLabel(data.schedule, 'taxes'));
  const camTag = hdrBadge(payerLabel(data.schedule, 'cam'));
  const insTag = hdrBadge(payerLabel(data.schedule, 'ins'));
  const othTag = hasOther ? hdrBadge(payerLabel(data.schedule, 'other')) : '';
  const mgmTag = hasMgmt  ? hdrBadge(payerLabel(data.schedule, 'mgmt'))  : '';

  thead.innerHTML = `<tr>
    <th>Period</th>
    <th>Year</th>
    <th>Month</th>
    <th>Space Size (SF)</th>
    <th>Net Rent ($/SF/yr)</th>
    <th>Taxes ($/SF/yr)${taxTag}</th>
    <th>CAM ($/SF/yr)${camTag}</th>
    <th>Insurance ($/SF/yr)${insTag}</th>
    ${hasOther ? `<th>Other ($/SF/yr)${othTag}</th>` : ''}
    ${hasMgmt  ? `<th>Mgmt Fee (${data.mgmt?.appliedOn === 'net' ? 'on Net' : 'on Gross'}) ($/SF/yr)${mgmTag}</th>` : ''}
    <th>Gross Rent ($/SF/yr)</th>
    <th>Net Rent (Total)</th>
    <th>Gross Rent (Total)</th>
  </tr>`;

  tbody.innerHTML = '';

  // Per-year bins + grand totals
  let currentYear = null;
  let yNet = 0, yGross = 0;
  let grandNet = 0, grandGross = 0;

  const flushYearSubtotal = () => {
    if (currentYear == null) return;

    const headCols  = thead.querySelectorAll('th').length;
    const labelSpan = Math.max(headCols - 2, 1);

    const sub = document.createElement('tr');
    sub.classList.add('subtotal-row');

    const tdLabel = document.createElement('td');
    tdLabel.colSpan = labelSpan;
    tdLabel.textContent = `Subtotal ${currentYear}`;
    sub.appendChild(tdLabel);

    const tdNet = document.createElement('td');
    tdNet.textContent = fmtUSD(yNet);
    sub.appendChild(tdNet);

    const tdGross = document.createElement('td');
    tdGross.textContent = fmtUSD(yGross);
    sub.appendChild(tdGross);

    tbody.appendChild(sub);

    yNet = 0;
    yGross = 0;
  };

  // Render month rows
  data.schedule.forEach(r => {
    if (currentYear === null) currentYear = r.calYear;
    if (r.calYear !== currentYear) {
      flushYearSubtotal();
      currentYear = r.calYear;
    }

    // $/SF/yr values (tenant-paid, post-abatement)
    const netAnn  = r.isGrossAbated ? 0 : r.contractNetAnnualPSF;
    const taxAnn  = r.isGrossAbated ? 0 : r.contractTaxesAnnualPSF;
    const camAnn  = r.isGrossAbated ? 0 : r.contractCamAnnualPSF;
    const insAnn  = r.isGrossAbated ? 0 : r.contractInsAnnualPSF;
    const othAnn  = hasOther ? (r.isGrossAbated ? 0 : (r.contractOtherAnnualPSF || 0)) : 0;
    const mgmtAnn = hasMgmt  ? (r.isGrossAbated ? 0 : (r.contractMgmtAnnualPSF || 0)) : 0;

    const grossAnn = netAnn + taxAnn + camAnn + insAnn + othAnn + (hasMgmt ? mgmtAnn : 0);

    const tr = document.createElement('tr');
    const cells = [
      r.monthIndex,
      r.calYear,
      r.calMonth,
      data.area.toLocaleString(),
      fmtUSD(netAnn),
      fmtUSD(taxAnn),
      fmtUSD(camAnn),
      fmtUSD(insAnn)
    ];
    if (hasOther) cells.push(fmtUSD(othAnn));
    if (hasMgmt)  cells.push(fmtUSD(mgmtAnn));
    cells.push(fmtUSD(grossAnn), fmtUSD(r.netTotal), fmtUSD(r.grossTotal));

    cells.forEach(v => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });

    if (r.isGrossAbated) tr.classList.add('gross-abated');
    tbody.appendChild(tr);

    // Totals
    yNet       += (r.netTotal   || 0);
    yGross     += (r.grossTotal || 0);
    grandNet   += (r.netTotal   || 0);
    grandGross += (r.grossTotal || 0);
  });

  // Final year subtotal
  flushYearSubtotal();

  // Grand Total
  const headCols  = thead.querySelectorAll('th').length;
  const labelSpan = Math.max(headCols - 2, 1);

  const gt = document.createElement('tr');
  gt.classList.add('grand-total');

  const tdLabel = document.createElement('td');
  tdLabel.colSpan = labelSpan;
  tdLabel.textContent = 'Grand Total';
  gt.appendChild(tdLabel);

  const tdNet = document.createElement('td');
  tdNet.textContent = fmtUSD(grandNet);
  gt.appendChild(tdNet);

  const tdGross = document.createElement('td');
  tdGross.textContent = fmtUSD(grandGross);
  gt.appendChild(tdGross);

  tbody.appendChild(gt);
}

  // ------------------------------- Exports buttons (optional) -----------------
  document.getElementById('exportPdf')?.addEventListener('click', () => window.ExportPDF?.openDialog());
  document.getElementById('exportExcel')?.addEventListener('click', () => window.ExportExcel?.downloadExcel());
})();
