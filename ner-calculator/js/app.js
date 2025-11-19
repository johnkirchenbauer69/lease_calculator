/* =======================================================================
   NER Calculator — unified controller
   Drop-in replacement for app.js
   ======================================================================= */

   (() => {
    // ------------------------------- Config / State -------------------------------
    let activeView = "monthly";            // "monthly" | "annual" | "monthly+subtotals"
    let activePerspective = "landlord";    // "landlord" | "tenant"
    let suppressNextInputCapture = false;
  
    const formattingAPI = window.NERFormatting || {};
    const formatCurrency = typeof formattingAPI.formatCurrency === 'function'
      ? formattingAPI.formatCurrency
      : (value) => (Number.isFinite(Number(value))
        ? Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '—');
    const formatPSF = typeof formattingAPI.formatPSF === 'function'
      ? formattingAPI.formatPSF
      : (value) => (Number.isFinite(Number(value))
        ? `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/SF`
        : '—');

    // Calculation helpers keep numbers exact.
    const finalizeMonthlyCurrency = (raw = {}) => ({ ...raw });

    const roundingAPI = window.rounding || {};
    const pvFromExact = typeof roundingAPI.pvFromExact === 'function'
      ? roundingAPI.pvFromExact
      : (cashflows = [], rate = 0, startOffset = 1) => cashflows.reduce((total, cash, index) => {
          const t = index + startOffset;
          const factor = 1 / Math.pow(1 + rate, t);
          return total + Number(cash || 0) * factor;
        }, 0);

    const $id = (s) => document.getElementById(s);
    const setText = (id, txt) => { const el = $id(id); if (el) el.textContent = txt; };
    const fmtUSD = (n) => formatCurrency(n);
    const fmt$ = (n) => formatCurrency(n);
    const fmt$0 = (n) => (Number.isFinite(n)
      ? Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
      : '—');
    const fmtPct = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—');

    const devGuardsEnabled = window.NER_DEV_GUARDS !== false;
    const warnIfFormatted = (label, value) => {
      if (!devGuardsEnabled) return;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        const looksToFixed = /^-?\d+\.\d+$/.test(trimmed) && !trimmed.includes(',');
        const looksLocale = /[$,]/.test(trimmed);
        const reason = looksLocale
          ? 'value appears to be locale-formatted'
          : looksToFixed
            ? 'value appears to come from toFixed()'
            : 'string assigned to numeric field';
        console.warn(`[ExactGuard] ${reason} for ${label}`, value);
      }
    };
  
    // ------------------------------- Small helpers -------------------------------
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    const qField = (rootOrField, maybeField) => {
      let scope = document;
      let field = '';
      if (typeof rootOrField === 'string' && maybeField == null) {
        field = rootOrField;
      } else if (rootOrField && typeof rootOrField.querySelector === 'function') {
        scope = rootOrField;
        field = maybeField;
      } else {
        field = maybeField;
      }
      if (!field) return null;
      return scope.querySelector(`[data-field="${field}"]`) || scope.querySelector(`[name="${field}"]`);
    };

    const qFields = (field, root = document) => {
      if (!field) return [];
      const scope = (root && typeof root.querySelectorAll === 'function') ? root : document;
      const seen = new Set();
      const out = [];
      scope.querySelectorAll(`[data-field="${field}"]`).forEach(el => {
        if (!seen.has(el)) { seen.add(el); out.push(el); }
      });
      scope.querySelectorAll(`[name="${field}"]`).forEach(el => {
        if (!seen.has(el)) { seen.add(el); out.push(el); }
      });
      return out;
    };
  
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
  
    function fmtPSF(v) { return formatPSF(v); }

    function computeLandlordFreeTI({ tiAmount = 0, tiUnit = 'per_sf', areaSF = 0, treatment = 'cash' } = {}) {
      const amount = Number(tiAmount) || 0;
      const unit = (tiUnit || '').toString().toLowerCase();
      const area = Number(areaSF) || 0;
      const treat = (treatment || '').toString().toLowerCase();

      const isPerSF = unit === 'per_sf'
        || unit === 'psf'
        || unit.includes('/sf')
        || unit.includes('per sf')
        || unit.includes('$/sf');

      const total = isPerSF ? (amount * area) : amount;
      return treat === 'cash' ? total : 0;
    }

    // Returns normalized KPI metrics for downstream cards & compare views.
    function buildKpis({
      schedule,
      termMonths,
      totalNetRent,
      totalGrossRent,
      totalBaseRent,
      totalRecoveries,
      totalOpex
    } = {}) {
      const safe = (n) => (Number.isFinite(n) ? n : 0);
      const scheduleMonths = Array.isArray(schedule)
        ? schedule.reduce((count, row) => (row && row.isTermMonth ? count + 1 : count), 0) || schedule.length || 0
        : 0;
      const months = (Number.isFinite(termMonths) && termMonths > 0)
        ? termMonths
        : scheduleMonths;

      const net = safe(totalNetRent);
      const gross = safe(totalGrossRent);

      return {
        termMonths: months,
        totalNetRent: net,
        totalGrossRent: gross,
        totalBaseRent: safe(totalBaseRent),
        totalRecoveries: safe(totalRecoveries),
        totalOpex: safe(totalOpex),
        avgMonthlyNet: months ? net / months : 0,
        avgMonthlyGross: months ? gross / months : 0
      };
    }
  
    // LL Gross excludes pass-through recoveries across all service types.
    function includeOpExInGross(perspective, serviceType) {
      const view = (perspective || '').toString().toLowerCase();
      if (view === 'tenant') return true;
      if (view === 'landlord') return false;
      return false;
    }
  
// ------------------------------- Map / Marker -------------------------------
function initMap() {
  if (typeof maptilersdk === 'undefined') return;
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  const MAPTILER_KEY = window.MAPTILER_KEY || 'VTZLSqW7ZLguI0JButuB';
  if (!MAPTILER_KEY || MAPTILER_KEY === 'VTZLSqW7ZLguI0JButuB') {
    console.warn('MapTiler: please set MAPTILER_KEY.');
  }

  maptilersdk.config.apiKey = MAPTILER_KEY;

  const defaultCenter = [-87.6298, 41.8781];
  const map = new maptilersdk.Map({
    container: 'map',
    style: 'streets-v4',
    center: defaultCenter,
    zoom: 10,
    pitch: 0,
    bearing: 0,
    terrain: false,
    terrainControl: false
  });

  // ---- marker element (Lee red pin) ----
  const pin = document.createElement('img');
  pin.className = 'lee-pin';
  pin.src = new URL('assets/lee-pin.svg', document.baseURI).toString();
  pin.alt = 'Location';

  const marker = new maptilersdk.Marker({
    element: pin,
    anchor: 'bottom',
    draggable: true
  })
    .setLngLat(defaultCenter)
    .addTo(map);

  // ---- popup (card) ----
  const popup = new maptilersdk.Popup({
    className: 'lee-popup',
    closeButton: false,
    closeOnClick: false,
    offset: 18,
    anchor: 'top'
  }).setText('Move the pin or type an address…');

  // make sure the marker is definitely draggable (belt & suspenders)
  marker.setDraggable(true).setPopup(popup).togglePopup();

  // ----- helpers -----
  const addressInput = document.getElementById('address');
  let isProgrammaticAddressUpdate = false;
  const setInput = (val) => {
    if (!addressInput) return;
    if (addressInput.value === val) return;
    isProgrammaticAddressUpdate = true;
    addressInput.value = val;
    setTimeout(() => (isProgrammaticAddressUpdate = false), 0);
  };

  async function reverseGeocode(lon, lat) {
    const fallback = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    try {
      const url = `https://api.maptiler.com/geocoding/${lon},${lat}.json?limit=1&key=${MAPTILER_KEY}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const feat = data?.features?.[0];
      return (
        feat?.place_name ||
        feat?.place_name_en ||
        feat?.text ||
        feat?.properties?.name ||
        fallback
      );
    } catch (e) {
      console.warn('Reverse geocoding failed:', e);
      return fallback;
    }
  }

  async function updateCardAndInputFromCoords(lon, lat, title = 'Selected location') {
    const label = await reverseGeocode(lon, lat);
    popup.setHTML(
      `<div class="map-card">
         <div class="map-card-title">${title}</div>
         <div class="map-card-body">${label}</div>
       </div>`
    );
    setInput(label);
    if (!popup.isOpen()) marker.togglePopup();
  }

  // initial address for default center
  updateCardAndInputFromCoords(defaultCenter[0], defaultCenter[1], 'Selected location');

  // ---- click on map -> move pin + reverse geocode ----
  map.on('click', async (e) => {
    const { lng, lat } = e.lngLat;
    marker.setLngLat([lng, lat]);
    await updateCardAndInputFromCoords(lng, lat, 'Dropped pin');
  });

  // ---- drag end -> reverse geocode ----
  marker.on('dragend', async () => {
    const { lng, lat } = marker.getLngLat();
    await updateCardAndInputFromCoords(lng, lat, 'Dropped pin');
  });

  // (optional nicety) cursor feedback while dragging
  marker.on('dragstart', () => (pin.style.cursor = 'grabbing'));
  marker.on('drag',      () => (pin.style.cursor = 'grabbing'));
  marker.on('dragend',   () => (pin.style.cursor = 'grab'));

  // ---- forward geocode from input ----
  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  async function geocodeForward(query) {
    if (!query) return;
    const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?limit=1&country=US&key=${MAPTILER_KEY}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const feat = data?.features?.[0];
      const coords = feat?.center || feat?.geometry?.coordinates; // [lon, lat]
      if (Array.isArray(coords)) {
        map.flyTo({ center: coords, zoom: 15, duration: 700 });
        marker.setLngLat(coords);
        const label = feat?.place_name || feat?.place_name_en || feat?.text || query;
        popup.setHTML(
          `<div class="map-card">
             <div class="map-card-title">Selected location</div>
             <div class="map-card-body">${label}</div>
           </div>`
        );
        if (!popup.isOpen()) marker.togglePopup();
        setInput(label);
      } else {
        popup.setHTML(
          `<div class="map-card">
             <div class="map-card-title">No match found</div>
             <div class="map-card-body">Try another address</div>
           </div>`
        );
      }
    } catch (e) {
      console.warn('Geocoding failed:', e);
      popup.setHTML(
        `<div class="map-card">
           <div class="map-card-title">Geocoding unavailable</div>
           <div class="map-card-body">Please try again later.</div>
         </div>`
      );
    }
  }

  if (addressInput) {
    const trigger = debounce(() => {
      if (!isProgrammaticAddressUpdate) geocodeForward(addressInput.value.trim());
    }, 350);

    addressInput.addEventListener('input', trigger);
    addressInput.addEventListener('change', () => {
      if (!isProgrammaticAddressUpdate) geocodeForward(addressInput.value.trim());
    });
    addressInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !isProgrammaticAddressUpdate) {
        e.preventDefault();
        geocodeForward(addressInput.value.trim());
      }
    });
  }
}

window.addEventListener('load', initMap);
  
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

    function addMonthsUTC(date, months) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return new Date(NaN);
      const m = Number(months) || 0;
      const copy = new Date(date.getFullYear(), date.getMonth(), 1);
      copy.setMonth(copy.getMonth() + m);
      return copy;
    }

    function getLeaseTimingSummary(model = {}) {
      const termMonths = Number(model?.termMonths ?? model?.term ?? 0) || 0;

      const freeInfo = model?.freeRent || {};
      const baseFree = Number(freeInfo?.months ?? model?.freeMonths ?? 0) || 0;
      const patternFree = Number(freeInfo?.patternMonths ?? 0) || 0;
      const freeMonths = baseFree + patternFree;

      const placementRaw = (freeInfo?.freePlacement ?? freeInfo?.placement ?? model?.freePlacement ?? '')
        .toString()
        .toLowerCase();
      const freePlacement = placementRaw === 'outside' ? 'outside' : 'inside';

      const startCandidates = [];
      if (model?.commencementDate) startCandidates.push(model.commencementDate);
      if (model?.leaseStartISO) startCandidates.push(`${model.leaseStartISO}-01`);
      if (model?.leaseStart) startCandidates.push(model.leaseStart);

      let startDate = new Date(NaN);
      for (const cand of startCandidates) {
        if (!cand) continue;
        const parsed = cand instanceof Date ? new Date(cand.getTime()) : new Date(cand);
        if (!Number.isNaN(parsed.getTime())) {
          startDate = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
          break;
        }
      }

      const endDate = (!Number.isNaN(startDate.getTime()) && termMonths > 0)
        ? addMonthsUTC(startDate, Math.max(termMonths - 1, 0))
        : new Date(NaN);

      const chips = [
        `Term: ${termMonths} ${termMonths === 1 ? 'month' : 'months'}`,
        `${freeMonths} ${freeMonths === 1 ? 'month' : 'months'} free`,
        `${freePlacement} the term`
      ];

      return { startDate, endDate, termMonths, freeMonths, freePlacement, chips };
    }

    window.getLeaseTimingSummary = getLeaseTimingSummary;
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
  
      return rows.map((row, idx) => {
        const id = row.dataset.idx || `cx-${idx + 1}`;
        const label = (row.querySelector('.cx-label')?.value || 'Other').trim();
        const rate = toNum(row.querySelector('.cx-val'));          // Year-1 $/SF/yr
        const growth = toNum(row.querySelector('.cx-growth'));       // % or $ depending on unit
        const unit = (row.querySelector('.cx-growthUnit')?.value === 'flat') ? 'flat' : 'pct';
        const mode = (row.querySelector('.cx-mode')?.value || 'tenant').toLowerCase(); // tenant|stop|landlord
        const baseInput = toNum(row.querySelector('.cx-base'));
        const base = (mode === 'stop' && baseInput > 0) ? baseInput : null; // optional, only for stop
        const stopTypeSel = row.querySelector('.cx-stopType');
        const stopType = (stopTypeSel?.value || 'base').toLowerCase();
        const stopPSFInput = toNum(row.querySelector('.cx-stopPSF'));
        const fixedStop = (mode === 'stop' && stopType === 'fixed' && stopPSFInput > 0) ? stopPSFInput : null;
  
        return { id, label, rate, growth, unit, mode, base, stopType, fixedStop };
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
    const mgmtModeSelect = document.getElementById('mgmtMode');
    const mgmtBaseWrap = document.getElementById('mgmtBaseWrap');
    const customList = document.getElementById('customExpList');
    const taxesModeSelect = document.getElementById('taxesMode');
    const camModeSelect = document.getElementById('camMode');
    const insModeSelect = document.getElementById('insMode');
  
    function setAutoDefault(selectEl, value) {
      if (!selectEl) return;
      if (!selectEl.dataset.auto) selectEl.dataset.auto = '1';
      if (selectEl.dataset.auto !== '0' && value != null) {
        selectEl.value = value;
      }
    }
  
    function defaultOpExModeForService(type) {
      switch ((type || '').toLowerCase()) {
        case 'gross':
        case 'mg':
          return 'landlord';
        default:
          return 'tenant';
      }
    }
  
    function defaultMgmtModeForService(type) {
      switch ((type || '').toLowerCase()) {
        case 'gross':
        case 'mg':
          return 'landlord';
        default:
          return 'tenant';
      }
    }
  
    function syncMgmtModeUI() {
      if (!mgmtModeSelect || !mgmtBaseWrap) return;
      const isStop = (mgmtModeSelect.value || '').toLowerCase() === 'stop';
      mgmtBaseWrap.style.display = isStop ? '' : 'none';
    }
  
    function syncCustomRowModeDefaults(type) {
      if (!customList) return;
      const desired = defaultOpExModeForService(type);
      customList.querySelectorAll('.cx-row').forEach(row => {
        if (!row) return;
        if (row.dataset.autoMode === '0') return;
        const sel = row.querySelector('.cx-mode');
        if (!sel) return;
        if (desired) sel.value = desired;
        if (desired === 'stop') {
          const stopSel = row.querySelector('.cx-stopType');
          if (stopSel) stopSel.value = 'base';
        }
        row.dataset.autoMode = '1';
        updateCustomRowModeUI(row);
      });
    }
  
    function handleServiceTypeChange() {
      const type = (serviceTypeEl?.value || 'nnn').toLowerCase();
      customSection?.classList.remove('hidden');
  
      setAutoDefault(mgmtModeSelect, defaultMgmtModeForService(type));
      syncMgmtModeUI();
  
      const desiredCoreMode = defaultOpExModeForService(type);
      setAutoDefault(taxesModeSelect, desiredCoreMode);
      setAutoDefault(camModeSelect, desiredCoreMode);
      setAutoDefault(insModeSelect, desiredCoreMode);
  
      ['taxes', 'cam', 'ins'].forEach(updateOpexLabels);
  
      syncCustomRowModeDefaults(type);
    }
  
    serviceTypeEl?.addEventListener('change', () => {
      handleServiceTypeChange();
      calculate();
    });
    handleServiceTypeChange();
  
    mgmtModeSelect?.addEventListener('change', () => {
      if (mgmtModeSelect) mgmtModeSelect.dataset.auto = '0';
      syncMgmtModeUI();
      calculate();
    });
  
    document.getElementById('mgmtBase')
      ?.addEventListener('change', calculate);
  
    // Toggle "Advanced" panels
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-adv-toggle]');
      if (!t) return;
      const key = t.getAttribute('data-adv-toggle');
      const panel = document.querySelector(`.opx-adv[data-for="${key}"]`);
      if (panel) panel.hidden = !panel.hidden;
    });
  
    // Show base-year policy only when that line is in stop mode
    function syncBaseYearVisibility(prefix, showBaseControls) {
      const group = document.querySelector(`.opx-adv[data-for="${prefix}"] [data-show-when-stop="true"]`);
      if (group) group.style.display = showBaseControls ? '' : 'none';
      const policy = document.getElementById(`${prefix}BasePolicy`);
      const year = document.getElementById(`${prefix}BaseYear`);
      if (policy && year) {
        const toggleYear = () => { year.hidden = (policy.value !== 'explicit'); };
        policy.addEventListener('change', toggleYear); toggleYear();
      }
    }
  
    // ---------- custom row add/remove/label flipping
    const rowTpl = document.getElementById('tplCustomExpRow');
    let customRowSeq = 0;
  
    function addCustomRow(prefill = {}) {
      if (!rowTpl || !customList) return;
      const node = rowTpl.content.firstElementChild.cloneNode(true);
      node.dataset.idx = (++customRowSeq).toString();
  
      const serviceType = (serviceTypeEl?.value || 'nnn').toLowerCase();
      const defaultMode = defaultOpExModeForService(serviceType) || 'tenant';
      const initialMode = prefill.mode ?? defaultMode;
  
      // prefill
      node.querySelector('.cx-label').value = prefill.label ?? '';
      node.querySelector('.cx-val').value = prefill.value != null ? prefill.value : '';
      node.querySelector('.cx-growth').value = (prefill.growth != null && prefill.growthUnit === 'pct')
        ? (prefill.growth * 100).toFixed(2) : (prefill.growth ?? '');
      node.querySelector('.cx-growthUnit').value = prefill.growthUnit ?? 'pct';
      const modeSel = node.querySelector('.cx-mode');
      if (modeSel) modeSel.value = initialMode;
      node.querySelector('.cx-base').value = prefill.base != null ? prefill.base : '';
      const stopTypeSel = node.querySelector('.cx-stopType');
      const stopPSFInput = node.querySelector('.cx-stopPSF');
      if (stopTypeSel) stopTypeSel.value = prefill.stopType ?? 'base';
      if (stopPSFInput) stopPSFInput.value = prefill.fixedStop != null ? prefill.fixedStop : '';
  
      node.dataset.autoMode = prefill.mode ? '0' : '1';
  
      // if stop, show base + year-1 kicker
      updateCustomRowModeUI(node);
      customList.appendChild(node);
    }
  
    function updateCustomRowModeUI(rowEl) {
      const modeSel = rowEl.querySelector('.cx-mode');
      const baseWrap = rowEl.querySelector('.cx-base-wrap');
      const kicker = rowEl.querySelector('.cx-kicker');
      const stopTypeWrap = rowEl.querySelector('[data-stop-type]');
      const stopTypeSel = rowEl.querySelector('.cx-stopType');
      const stopPSFWrap = rowEl.querySelector('.cx-stopPSF-wrap');
      const isStop = modeSel?.value === 'stop';
      const stopTypeVal = (stopTypeSel?.value || 'base').toLowerCase();
      const showFixed = isStop && stopTypeVal === 'fixed';
  
      if (stopTypeWrap) stopTypeWrap.style.display = isStop ? '' : 'none';
      if (stopTypeSel) stopTypeSel.style.display = isStop ? '' : 'none';
      if (baseWrap) baseWrap.style.display = (isStop && !showFixed) ? '' : 'none';
      if (stopPSFWrap) stopPSFWrap.style.display = showFixed ? '' : 'none';
      if (kicker) kicker.hidden = !(isStop && !showFixed);
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
      if (row) {
        row.dataset.autoMode = '0';
        updateCustomRowModeUI(row);
      }
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
        const stopType = row.querySelector('.cx-stopType')?.value || 'base';
        const stopPSF = money(row.querySelector('.cx-stopPSF')?.value);
        const base = money(row.querySelector('.cx-base')?.value);
  
        rows.push({
          label,
          value: val,           // Year-1 PSF if mode=stop, otherwise “current” PSF
          growth,
          growthUnit: gUnit,    // 'pct' | 'flat'
          mode,                 // 'tenant' | 'stop' | 'landlord'
          base: Number.isFinite(base) && base > 0 ? base : null,
          stopType,
          fixedStop: (mode === 'stop' && stopType === 'fixed' && Number.isFinite(stopPSF) && stopPSF > 0) ? stopPSF : null
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
      const isMG = (svc === 'mg');
      const isBaseStop = (mode === 'stop');
  
      // Show Pass-through Mode for MG leases
      const modeWrap = document.querySelector(`.opx-mode[data-for="${kind}"]`);
      if (modeWrap) modeWrap.style.display = isMG ? '' : 'none';
  
      const stopRows = Array.from(document.querySelectorAll(`.opx-stop[data-for="${kind}"]`));
      const baseWrap = document.querySelector(`.opx-base[data-for="${kind}"]`);
      const showStopControls = isBaseStop && isMG;

      let primaryStopType = 'base';
      if (stopRows.length > 0) {
        const primarySel = qField(stopRows[0], `${kind}StopType`);
        if (primarySel) primaryStopType = (primarySel.value || 'base').toLowerCase();
      } else {
        const primarySel = qField(`${kind}StopType`);
        if (primarySel) primaryStopType = (primarySel.value || 'base').toLowerCase();
      }
      const showFixedPrimary = showStopControls && primaryStopType === 'fixed';

      stopRows.forEach(row => {
        row.style.display = showStopControls ? '' : 'none';
        const rowStopType = (qField(row, `${kind}StopType`)?.value || 'base').toLowerCase();
        const rowFixed = showStopControls && rowStopType === 'fixed';
        const rowWrap = qField(row, `${kind}StopPSFWrap`);
        if (rowWrap) rowWrap.style.display = rowFixed ? '' : 'none';
      });

      if (baseWrap) baseWrap.style.display = (showStopControls && !showFixedPrimary) ? '' : 'none';

      // Keep the per-line base-year visibility in sync (only when base-year stop applies)
      syncBaseYearVisibility(kind, showStopControls && !showFixedPrimary);
  
      // Kicker “(Year 1 …)” only when base-year stop is active (MG or Custom)
      const kicker = document.getElementById(kickerId);
      if (kicker) kicker.hidden = !(isBaseStop && !showFixedPrimary);
  
      // Hint text aligns with whether we’re in a base-year stop flow
      const hint = document.getElementById(hintId);
      if (hint) {
        hint.textContent = showFixedPrimary
          ? 'Tenant pays only the portion above the fixed stop entered below.'
          : (isBaseStop
            ? 'Enter the Year-1 value that will escalate by the annual rate above.'
            : 'Enter the current value that will escalate by the annual rate above.');
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
        calculate();
      });
  
      modeIds.forEach(id => {
        const sel = document.getElementById(id);
        sel?.addEventListener('change', () => {
          if (sel && !sel.dataset.auto) sel.dataset.auto = '0';
          if (sel) sel.dataset.auto = '0';
          if (id === 'taxesMode') updateOpexLabels('taxes');
          if (id === 'camMode') updateOpexLabels('cam');
          if (id === 'insMode') updateOpexLabels('ins');
          calculate();
        });
        if (sel && !sel.dataset.auto) sel.dataset.auto = '1';
      });
  
      [
        ['taxesStopType', 'taxes'],
        ['camStopType', 'cam'],
        ['insStopType', 'ins']
      ].forEach(([field, kind]) => {
        qFields(field).forEach(sel => {
          sel.addEventListener('change', () => {
            updateOpexLabels(kind);
            calculate();
          });
        });
      });

      ['taxesStopPSF', 'camStopPSF', 'insStopPSF'].forEach(field => {
        qFields(field).forEach(input => {
          ['input', 'change'].forEach(evt => input.addEventListener(evt, calculate));
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
    const resultsViewToggle = document.getElementById('resultsViewToggle');
    const scheduleWrap = document.getElementById('rent-schedule');
    const chartsWrap = document.getElementById('analysis-charts');
    const compareWrap = document.getElementById('compareSection');

    function setResultsView(mode) {
      scheduleWrap?.classList.toggle('hidden', mode !== 'schedule');
      chartsWrap?.classList.toggle('hidden', mode !== 'charts');
      compareWrap?.classList.toggle('hidden', mode !== 'compare');
      const buttons = resultsViewToggle ? Array.from(resultsViewToggle.querySelectorAll('[data-view]')) : [];
      buttons.forEach(b => b.classList.toggle('active', b.dataset.view === mode));
      const kpiResults = document.getElementById('kpiResults');
      kpiResults?.classList.toggle('hidden', mode === 'compare');
      try { localStorage.setItem('ner_view_mode', mode); } catch { }
      if (mode === 'charts' && window.charts && window.__ner_last) window.charts.update(window.__ner_last);
      if (mode === 'compare') {
        window.updateLeaseComparisonView?.('summary');
        if (typeof window.renderCompareGrid === 'function') {
          window.renderCompareGrid();
        }
      }
    }

    if (resultsViewToggle) {
      resultsViewToggle.addEventListener('click', (evt) => {
        const btn = evt.target.closest('[data-view]');
        if (!btn || !resultsViewToggle.contains(btn)) return;
        setResultsView(btn.dataset.view);
      });
    }

    setResultsView(localStorage.getItem('ner_view_mode') || (resultsViewToggle?.querySelector('[data-view].active')?.dataset.view) || 'schedule');
  
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
        customSection?.classList.remove('hidden');
  
        if (v === 'nnn') {
          // Triple-net: tenant pays all; lock switches
          setAll(true, true);
        } else if (v === 'gross') {
          // Gross: landlord pays all; lock switches
          setAll(false, true);
        } else if (v === 'mg') {
          setAll(false, true);
          show('.opx-mode', true);
        } else {
          [incTaxes, incCam, incIns].forEach(cb => cb && (cb.disabled = false));
        }
  
        updateOpexLabels('taxes');
        updateOpexLabels('cam');
        updateOpexLabels('ins');
      }
      serviceType?.addEventListener('change', syncIncludes);
      syncIncludes();
  
  
      // --- Custom expenses UI -------------------------------------------------
      // delegated events
      customList?.addEventListener('click', (e) => {
        const btn = e.target.closest('.cx-delete');
        if (!btn) return;
        btn.closest('.cx-row')?.remove();
      });
      customList?.addEventListener('change', (e) => {
        const modeSel = e.target.closest('.cx-mode');
        const row = e.target.closest('.cx-row');
        if (!row) return;
        if (modeSel) {
          row.dataset.autoMode = '0';
        }
        updateCustomRowModeUI(row);
        calculate();
      });
      customList?.addEventListener('input', (e) => {
        if (e.target.closest('.cx-row')) calculate();
      });
      addBtn?.addEventListener('click', () => addCustomRow());
  
      // expose to engine
      function readCustomRows() {
        if (!customList) return [];
        const rows = [];
        qa('.cx-row', customList).forEach(row => {
          const mode = q('.cx-mode', row)?.value || 'tenant';
          const stopType = q('.cx-stopType', row)?.value || 'base';
          rows.push({
            label: (q('.cx-label', row)?.value || 'Expense').trim(),
            value: q('.cx-val', row)?.value ?? '',          // $/SF/yr (Y1)
            growth: q('.cx-growth', row)?.value ?? '',      // raw value; parse by unit
            growthUnit: q('.cx-growthUnit', row)?.value || 'pct', // 'pct' | 'flat'
            mode,
            base: q('.cx-base', row)?.value ?? '',           // $/SF/yr; blank = auto Y1
            stopType,
            fixedStop: (mode === 'stop' && stopType === 'fixed') ? (q('.cx-stopPSF', row)?.value ?? '') : ''
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

    const escapeAttrValue = (name) => {
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(name);
      }
      return name.replace(/"/g, '\\"');
    };

    function captureModelInputs({ customExpenses = [], capexRows = [] } = {}) {
      const form = document.getElementById('ner-form');
      const elements = form ? Array.from(form.elements || []) : [];
      const fields = {};

      elements.forEach(el => {
        if (!el) return;
        const tag = (el.tagName || '').toLowerCase();
        const type = (el.type || '').toLowerCase();
        if (type === 'button' || type === 'submit' || type === 'reset') return;
        const key = el.id || el.name;
        if (!key) return;
        const origin = el.id ? 'id' : 'name';

        if (type === 'radio') {
          const prev = fields[key];
          if (!prev) fields[key] = { type: 'radio', value: null, origin };
          if (el.checked) fields[key] = { type: 'radio', value: el.value, origin };
          return;
        }

        if (type === 'checkbox') {
          fields[key] = { type: 'checkbox', value: !!el.checked, origin };
          return;
        }

        if (tag === 'select' && el.multiple) {
          const values = Array.from(el.selectedOptions || []).map(opt => opt.value);
          fields[key] = { type: 'multi', value: values, origin };
          return;
        }

        fields[key] = { type: 'value', value: el.value ?? '', origin };
      });

      const cloneCustom = Array.isArray(customExpenses)
        ? customExpenses.map(row => ({
            label: row?.label ?? '',
            rate: row?.rate ?? 0,
            growth: row?.growth ?? 0,
            unit: row?.unit ?? 'pct',
            mode: row?.mode ?? 'tenant',
            base: row?.base ?? null,
            stopType: row?.stopType ?? 'base',
            fixedStop: row?.fixedStop ?? null
          }))
        : [];

      const cloneCapex = Array.isArray(capexRows)
        ? capexRows.map(row => ({
            mode: row?.mode ?? 'psf',
            amount: row?.amount ?? 0,
            total: row?.total ?? 0
          }))
        : [];

      const shouldStamp = !suppressNextInputCapture;
      suppressNextInputCapture = false;

      const inputs = {
        fields,
        customExpenses: cloneCustom,
        capexRows: cloneCapex,
        perspective: activePerspective,
        view: activeView
      };

      if (shouldStamp) inputs.timestamp = Date.now();

      return inputs;
    }

    function applyModelToForm(modelLike) {
      const inputs = modelLike?.__inputs;
      if (!inputs || typeof inputs !== 'object') return false;

      const form = document.getElementById('ner-form');
      if (!form) return false;

      suppressNextInputCapture = true;

      const applyField = (key, meta = {}) => {
        if (!key || !meta) return;
        const { type, value, origin } = meta;

        if (type === 'radio') {
          const name = origin === 'name'
            ? key
            : (document.getElementById(key)?.name || key);
          const radios = Array.from(form.querySelectorAll(`input[type="radio"][name="${escapeAttrValue(name)}"]`));
          if (!radios.length) return;
          let matched = false;
          radios.forEach(radio => {
            const shouldCheck = value != null && radio.value === value;
            radio.checked = shouldCheck;
            if (shouldCheck) matched = true;
          });
          if (!matched && value == null) {
            radios.forEach(radio => { radio.checked = false; });
          }
          return;
        }

        let el = null;
        if (origin === 'id') el = document.getElementById(key);
        if (!el && origin === 'name') {
          const nodes = Array.from(form.querySelectorAll(`[name="${escapeAttrValue(key)}"]`));
          el = nodes.find(node => node.type !== 'radio') || nodes[0] || null;
        }
        if (!el && key) {
          el = document.getElementById(key) || form.elements?.namedItem?.(key);
          if (el && typeof el.length === 'number' && el.item) {
            el = el[0] || null;
          }
        }
        if (!el || el.type === 'radio') return;

        if (type === 'checkbox') {
          el.checked = !!value;
          return;
        }

        if (type === 'multi') {
          const values = Array.isArray(value) ? value.map(String) : [];
          Array.from(el.options || []).forEach(opt => {
            opt.selected = values.includes(opt.value);
          });
          return;
        }

        el.value = value != null ? value : '';
      };

      const fieldEntries = Object.entries(inputs.fields || {});
      fieldEntries.forEach(([key, meta]) => applyField(key, meta));

      if (customList) {
        customList.innerHTML = '';
        customRowSeq = 0;
        const expenses = Array.isArray(inputs.customExpenses) ? inputs.customExpenses : [];
        expenses.forEach(row => {
          addCustomRow({
            label: row?.label ?? '',
            value: row?.rate ?? row?.value ?? 0,
            growth: row?.growth ?? 0,
            growthUnit: row?.unit ?? row?.growthUnit ?? 'pct',
            mode: row?.mode ?? 'tenant',
            base: row?.base ?? null,
            stopType: row?.stopType ?? 'base',
            fixedStop: row?.fixedStop ?? null
          });
        });
      }

      const capexRowsEl = document.getElementById('capexRows');
      const capexAddBtn = document.getElementById('capexAdd');
      if (capexRowsEl) {
        capexRowsEl.innerHTML = '';
        const rowsData = Array.isArray(inputs.capexRows) ? inputs.capexRows : [];
        if (!rowsData.length) {
          if (capexAddBtn) capexAddBtn.click();
        } else {
          rowsData.forEach(row => {
            if (capexAddBtn) capexAddBtn.click();
            const newRow = capexRowsEl.querySelector('.capex-row:last-of-type') || capexRowsEl.lastElementChild;
            if (!newRow) return;
            const modeSel = newRow.querySelector('.capex-entry');
            if (modeSel && row?.mode) modeSel.value = row.mode;
            const amtInput = newRow.querySelector('.capex-amount');
            if (amtInput) amtInput.value = row?.amount ?? '';
          });
        }
      }

      syncIncludes();
      handleServiceTypeChange();
      syncEscUI();
      syncMgmtModeUI();
      if (typeof updateCommNpvChip === 'function') updateCommNpvChip();
      recalcCapex();

      return true;
    }

    window.applyModelToForm = applyModelToForm;

    (function ensureAutoAddGuard() {
      const guard = (fn) => (typeof fn === 'function'
        ? function guarded(model, ...args) {
            if (!model?.__inputs?.timestamp) return;
            return fn.apply(this, [model, ...args]);
          }
        : fn);

      let guarded = guard(window.autoAddScenarioFromModel);
      try {
        Object.defineProperty(window, 'autoAddScenarioFromModel', {
          configurable: true,
          enumerable: true,
          get() { return guarded; },
          set(fn) { guarded = guard(fn); }
        });
      } catch (err) {
        window.autoAddScenarioFromModel = guard(window.autoAddScenarioFromModel);
      }
    })();

    // ------------------------------- Calculate / Reset --------------------------
    const CALC_CLICK_WINDOW_MS = 2000;

    function wasCalcJustClicked(windowMs = CALC_CLICK_WINDOW_MS) {
      const ts = window.__calcClickedAt;
      if (!Number.isFinite(ts)) return false;
      const now = Date.now();
      const recent = (now - ts) <= windowMs;
      if (!recent) delete window.__calcClickedAt;
      return recent;
    }

    document.getElementById('calcBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const timestamp = Date.now();
      window.__calcClickedAt = timestamp;
      const autoAddSignals = [
        window.__ner_compare_auto_add_intent,
        window.__ner_compare_auto_add_request,
        window.__ner_compare_auto_add_click,
        window.__ner_compare_auto_add
      ];
      const autoAddRequested = autoAddSignals.some(signal => {
        if (!signal) return false;
        if (typeof signal === 'object') return Object.keys(signal).length > 0;
        return true;
      });

      const existingIntent = (
        window.__ner_compare_auto_add_intent && typeof window.__ner_compare_auto_add_intent === 'object'
      )
        ? window.__ner_compare_auto_add_intent
        : {};

      const intentMeta = {
        ...existingIntent,
        ts: timestamp,
        programmatic: false
      };

      window.__ner_compare_auto_add_intent = intentMeta;
      window.__ner_compare_auto_add_programmatic = false;

      if (autoAddRequested) {
        window.__ner_compare_auto_add_click_ts = timestamp;
        window.__ner_compare_auto_add_ts = timestamp;
      } else {
        delete window.__ner_compare_auto_add_click_ts;
        delete window.__ner_compare_auto_add_ts;
      }

      if ('__ner_compare_auto_add_request' in window) {
        window.__ner_compare_auto_add_request = false;
      }
      window.setTimeout(() => {
        if (window.__calcClickedAt === timestamp) delete window.__calcClickedAt;
      }, CALC_CLICK_WINDOW_MS);
      if (typeof window.__ner_resetAutoAddGuard === 'function') {
        window.__ner_resetAutoAddGuard();
      }
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
      const intentMeta = window.__ner_compare_auto_add_intent;
      const intentObj = (intentMeta && typeof intentMeta === 'object') ? intentMeta : null;
      const intentTsCandidates = [];
      if (intentObj) {
        ['ts', 'timestamp', 'time', 'at', 'clickedAt', 'clickTs']
          .forEach((prop) => {
            const val = intentObj[prop];
            if (Number.isFinite(Number(val))) intentTsCandidates.push(Number(val));
          });
      }
      const clickTs = Number(window.__ner_compare_auto_add_click_ts);
      if (Number.isFinite(clickTs)) intentTsCandidates.push(clickTs);
      const intentTs = intentTsCandidates.length ? intentTsCandidates[0] : NaN;
      const triggeredByClick = (
        intentObj
        && intentObj.programmatic === false
        && Number.isFinite(intentTs)
        && Math.abs(Date.now() - intentTs) <= CALC_CLICK_WINDOW_MS
      );
      window.__ner_compare_auto_add_programmatic = triggeredByClick ? false : true;
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
        const address = $('#address')?.value.trim() || '';
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
        const landlordFreeTICash = computeLandlordFreeTI({
          tiAmount: llAllowVal,
          tiUnit: llAllowUnit,
          areaSF: area,
          treatment: llAllowTreatment
        });
        const llAllowApr = rawNumberFromInput($('#llAllowApr')) / 100;
  
        // For table display ($/SF)
        const tiPerSF_forDisplay = area ? (llAllowanceApplied / area) : 0;
  
        // Services + OpEx + growth
        const type = $('#serviceType')?.value || 'nnn'; // 'nnn' | 'gross' | 'mg'
        const taxes = rawNumberFromInput($('#taxes'));
        const cam = rawNumberFromInput($('#cam'));
        const ins = rawNumberFromInput($('#ins'));
        const mgmtRatePct = +document.getElementById('mgmtRate')?.value || 0; // e.g. 3.0
        const mgmtAppliedOn = document.getElementById('mgmtAppliedOn')?.value || 'gross';
        const mgmtModeSelection = (document.getElementById('mgmtMode')?.value || defaultMgmtModeForService(type)).toLowerCase();
        const mgmtBaseAnnInput = rawNumberFromInput($('#mgmtBase'));
        const mgmtCfg = {
          ratePct: mgmtRatePct,
          appliedOn: mgmtAppliedOn,
          mode: mgmtModeSelection,
          baseAnnual: mgmtBaseAnnInput > 0 ? mgmtBaseAnnInput : null
        };
  
        const extraOpExRows = readAdditionalOpEx();
        let hasOtherOpEx = false;
  
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
        const taxesMode = ($('#taxesMode')?.value || 'tenant').toLowerCase(); // 'tenant' | 'landlord' | 'stop'
        const camMode = ($('#camMode')?.value || 'tenant').toLowerCase();
        const insMode = ($('#insMode')?.value || 'tenant').toLowerCase();
        const taxesBaseAnn = rawNumberFromInput($('#taxesBase')); // $/SF/yr or blank for auto
        const camBaseAnn = rawNumberFromInput($('#camBase'));
        const insBaseAnn = rawNumberFromInput($('#insBase'));
        const taxesStopType = (qField('taxesStopType')?.value || 'base').toLowerCase();
        const camStopType = (qField('camStopType')?.value || 'base').toLowerCase();
        const insStopType = (qField('insStopType')?.value || 'base').toLowerCase();
        const taxesFixedStop = rawNumberFromInput(qField('taxesStopPSF'));
        const camFixedStop = rawNumberFromInput(qField('camStopPSF'));
        const insFixedStop = rawNumberFromInput(qField('insStopPSF'));
  
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
        const customPatternMonths = abateCustomSpec ? customSet.size : 0;

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
        function treatCategory(mode, monthlyPSF, stopMeta) {
          if (mode === "tenant") return { tenantPSF: monthlyPSF, llPSF: 0 };
          if (mode === "landlord") return { tenantPSF: 0, llPSF: monthlyPSF };
          const meta = (stopMeta && typeof stopMeta === 'object' && !Array.isArray(stopMeta))
            ? stopMeta
            : { type: 'base', baseAnnual: Number(stopMeta) || 0, fixedAnnual: 0 };
          const type = (meta.type || 'base').toLowerCase();
          const baseAnnual = Number(meta.baseAnnual) || 0;
          const fixedAnnual = Number(meta.fixedAnnual) || 0;
          const comparison = (type === 'fixed') ? fixedAnnual : baseAnnual;
          const incMonthly = Math.max(0, (monthlyPSF * 12) - comparison) / 12;
          return { tenantPSF: incMonthly, llPSF: monthlyPSF };
        }
  
        // --- Auto base-year stop helper (handles "first full calendar year") ---
        function autoBaseForStop(currPSF, unit, pct, flat) {
          const idx = startDate.getMonth() > 0 ? 1 : 0; // first full calendar year if start ≠ Jan
          return (unit === 'pct') ? currPSF * Math.pow(1 + pct, idx)
            : currPSF + idx * flat;
        }
    
  
        // Precompute annual base amounts when a line is in "base-year stop" mode.
        const taxesStopBaseAnn = (taxesStopType === 'fixed')
          ? 0
          : (taxesBaseAnn || autoBaseForStop(taxes, taxesGrowthUnit, taxesGrowthPct, taxesGrowthFlat));
        const camStopBaseAnn = (camStopType === 'fixed')
          ? 0
          : (camBaseAnn || autoBaseForStop(cam, camGrowthUnit, camGrowthPct, camGrowthFlat));
        const insStopBaseAnn = (insStopType === 'fixed')
          ? 0
          : (insBaseAnn || autoBaseForStop(ins, insGrowthUnit, insGrowthPct, insGrowthFlat));
  
        const taxesStopMeta = {
          type: taxesStopType,
          baseAnnual: taxesStopBaseAnn,
          fixedAnnual: (taxesStopType === 'fixed') ? taxesFixedStop : 0
        };
        const camStopMeta = {
          type: camStopType,
          baseAnnual: camStopBaseAnn,
          fixedAnnual: (camStopType === 'fixed') ? camFixedStop : 0
        };
        const insStopMeta = {
          type: insStopType,
          baseAnnual: insStopBaseAnn,
          fixedAnnual: (insStopType === 'fixed') ? insFixedStop : 0
        };
  
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
  
        const mgmtMode = (mgmtCfg.mode || defaultMgmtModeForService(type)).toLowerCase();
        const mgmtRateDecimal = Math.max(0, mgmtCfg.ratePct || 0) / 100;
        const autoMgmtBaseAnn = (mgmtRateDecimal > 0)
          ? baseAnnualPSFForIndex(startDate.getMonth() > 0 ? 1 : 0) * mgmtRateDecimal
          : 0;
        const mgmtStopBaseAnn = (mgmtMode === 'stop')
          ? (mgmtCfg.baseAnnual != null && mgmtCfg.baseAnnual > 0 ? mgmtCfg.baseAnnual : autoMgmtBaseAnn)
          : 0;
  
        let totalOtherAnnualPSF = 0;
        const monthlyNetCash = [];
        const monthlyGrossCash = [];
        const monthlyLLOpexCash = [];
        const monthlyFreeGross = [];
  
        for (let m = 1; m <= scheduleMonths; m++) {
          const rowDate = new Date(startDate.getFullYear(), startDate.getMonth() + (m - 1), 1);
  
          // Anniversary for base rent
          const annivYearIndex = Math.floor((m - 1) / 12);
          const yearIndex = annivYearIndex;
  
          // ✅ OpEx always calendar-year growth
          const opxYearIndex = rowDate.getFullYear() - startDate.getFullYear();
  
          const customLineItems = extraOpExRows.map((x, idx) => {
            const mode = (x.mode || 'tenant').toLowerCase();
            const gPct = (x.unit === 'pct') ? (x.growth / 100) : 0;
            const gFlat = (x.unit === 'flat') ? x.growth : 0;
            const otherAnnPSF = growOpEx(x.rate, x.unit, gPct, gFlat, opxYearIndex);
            const otherMoPSF = otherAnnPSF / 12;
            const stopType = (x.stopType || 'base').toLowerCase();
            const stopBaseAnn = (mode === 'stop' && stopType !== 'fixed')
              ? (x.base != null ? x.base : autoBaseForStop(x.rate, x.unit, gPct, gFlat))
              : 0;
            const stopMeta = {
              type: stopType,
              baseAnnual: stopBaseAnn,
              fixedAnnual: (mode === 'stop' && stopType === 'fixed' && x.fixedStop != null) ? x.fixedStop : 0
            };
            const share = treatCategory(mode === 'stop' ? 'stop' : mode, otherMoPSF, stopMeta);
            return {
              id: x.id || `custom-${idx + 1}`,
              label: x.label || `Custom ${idx + 1}`,
              mode,
              baseAnnual: (mode === 'stop' && stopType !== 'fixed') ? stopBaseAnn : null,
              fixedStop: (mode === 'stop' && stopType === 'fixed' && x.fixedStop != null) ? x.fixedStop : null,
              stopType,
              tenantMonthlyPSF: share.tenantPSF,
              landlordMonthlyPSF: share.llPSF,
              tenantAnnualPSF: share.tenantPSF * 12,
              landlordAnnualPSF: share.llPSF * 12
            };
          });
  
          const otherTenantMoPSF = customLineItems.reduce((sum, item) => sum + item.tenantMonthlyPSF, 0);
          const otherLLMoPSF = customLineItems.reduce((sum, item) => sum + item.landlordMonthlyPSF, 0);
          const otherTenantAnnPSF = customLineItems.reduce((sum, item) => sum + item.tenantAnnualPSF, 0);
  
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
  
          const effectiveTaxesMode = (type === 'nnn') ? 'tenant' : (type === 'gross') ? 'landlord' : taxesMode;
          const effectiveCamMode = (type === 'nnn') ? 'tenant' : (type === 'gross') ? 'landlord' : camMode;
          const effectiveInsMode = (type === 'nnn') ? 'tenant' : (type === 'gross') ? 'landlord' : insMode;
  
          const taxesShare = (effectiveTaxesMode === 'stop')
            ? treatCategory('stop', txMo, taxesStopMeta)
            : treatCategory(effectiveTaxesMode, txMo, taxesStopMeta);
          const camShare = (effectiveCamMode === 'stop')
            ? treatCategory('stop', camMo, camStopMeta)
            : treatCategory(effectiveCamMode, camMo, camStopMeta);
          const insShare = (effectiveInsMode === 'stop')
            ? treatCategory('stop', insMo, insStopMeta)
            : treatCategory(effectiveInsMode, insMo, insStopMeta);
  
          tenTxMo = taxesShare.tenantPSF;
          tenCamMo = camShare.tenantPSF;
          tenInsMo = insShare.tenantPSF;
  
          llTxMo = taxesShare.llPSF;
          llCamMo = camShare.llPSF;
          llInsMo = insShare.llPSF;
  
          llOpexPSF = llTxMo + llCamMo + llInsMo;
  
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
  
          const customItemsThisPeriod = customLineItems.map(item => {
            const tenantMoPSF = (inFree && abateType === "gross") ? 0 : item.tenantMonthlyPSF;
            const tenant$ = tenantMoPSF * area * cashFactor;
            const landlord$ = item.landlordMonthlyPSF * area * cashFactor;
            return {
              ...item,
              tenantMonthlyPSF: tenantMoPSF,
              tenantAnnualPSF: tenantMoPSF * 12,
              tenantDollars: tenant$,
              landlordMonthlyPSF: item.landlordMonthlyPSF,
              landlordAnnualPSF: item.landlordAnnualPSF,
              landlordDollars: landlord$
            };
          });
  
          // Dollars (use proration)
          const tenTax$ = ((inFree && abateType === "gross") ? 0 : tenTxMo) * area * cashFactor;
          const tenCam$ = ((inFree && abateType === "gross") ? 0 : tenCamMo) * area * cashFactor;
          const tenIns$ = ((inFree && abateType === "gross") ? 0 : tenInsMo) * area * cashFactor;
          const tenOth$ = customItemsThisPeriod.reduce((sum, item) => sum + item.tenantDollars, 0);
          const other$ = tenOth$;
  
          const llTax$ = llTxMo * area * cashFactor;
          const llCam$ = llCamMo * area * cashFactor;
          const llIns$ = llInsMo * area * cashFactor;
          const llOth$ = customItemsThisPeriod.reduce((sum, item) => sum + item.landlordDollars, 0);
  
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
  
            const mgmtStopMeta = { type: 'base', baseAnnual: mgmtStopBaseAnn, fixedAnnual: 0 };
            const share = treatCategory(mgmtMode === 'stop' ? 'stop' : mgmtMode, mgmtMoPSF, mgmtStopMeta);
            tenantMgmtMoPSFShare = share.tenantPSF;
            llMgmtMoPSFShare = share.llPSF;
  
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
  
          // LL OpEx dollars (after including Other)
          const llOpex$ = llOpexPSF * area * cashFactor;

          const rawCurrency = {
            preBase$: preBase$,
            preGross$: preGrossPay,
            netTotal: netPay,
            grossTotal: grossPay,
            freeBase$: freeBase$,
            recoveries$: recov$,
            other$: other$,
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
            llOpex$: llOpex$
          };

          const currency = finalizeMonthlyCurrency(rawCurrency);

          const customItemsExact = customItemsThisPeriod.map(item => ({
            ...item,
            tenantDollars: Number(item.tenantDollars) || 0,
            landlordDollars: Number(item.landlordDollars) || 0
          }));

          const tenantOtherExact = customItemsExact.reduce((sum, item) => sum + (item.tenantDollars || 0), 0);
          const landlordOtherExact = customItemsExact.reduce((sum, item) => sum + (item.landlordDollars || 0), 0);

          currency.tenantOther$ = tenantOtherExact;
          currency.llOther$ = landlordOtherExact;
          currency.other$ = tenantOtherExact;

          totalPaidNet += netPay;
          totalPaidGross += grossPay;
          totalLLOpex += llOpex$;

          monthlyNetCash.push(netPay);
          monthlyGrossCash.push(grossPay);
          monthlyLLOpexCash.push(llOpex$);

          const isGrossAbated = inFree && (abateType === 'gross');

          if (inFree) {
            abatedMonths += 1;
            const forgiven = (abateType === 'gross') ? preGrossPay : preBase$;
            freeGrossNominal += forgiven;
            monthlyFreeGross.push(forgiven);
          } else {
            monthlyFreeGross.push(0);
          }

          tenantOpExNominal += Math.max(0, grossPay - netPay);

          // Identify row labels
          const calYear = rowDate.getFullYear();
          const monthName = rowDate.toLocaleString(undefined, { month: "short" });

          // Tenant mgmt as monthly PSF (used in PSF bundle)
          const tenantMgmtMoPSF = (currency.tenantMgmt$ && area && cashFactor)
            ? (currency.tenantMgmt$ / (area * cashFactor))
            : 0;

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
            netTotal: currency.netTotal,
            grossTotal: currency.grossTotal,

            // breakdowns used by compare grid
            preBase$: currency.preBase$,
            freeBase$: currency.freeBase$,
            other$: currency.other$,
            recoveries$: currency.recoveries$,

            // extras
            llOpex$: currency.llOpex$,
            area,
            isGrossAbated,
            cashFactor,
            isTermMonth,

            // tenant/LL OpEx dollars this month
            tenantTaxes$: currency.tenantTaxes$,
            tenantCam$: currency.tenantCam$,
            tenantIns$: currency.tenantIns$,
            tenantOther$: currency.tenantOther$,

            llTaxes$: currency.llTaxes$,
            llCam$: currency.llCam$,
            llIns$: currency.llIns$,
            llOther$: currency.llOther$,

            tenantMgmt$: currency.tenantMgmt$,
            llMgmt$: currency.llMgmt$,

            tiOutlayThisPeriod: 0,
            lcOutlayThisPeriod: 0,

            customItems: customItemsExact,

            // annualized contract fields
            contractMgmtAnnualPSF: contractMgmtAnnualPSF,
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

          row.otherPSF = row.tenPSF.other + row.llPSF.other;
          row.otherMonthly$Tenant = currency.tenantOther$;
          row.otherMonthly$LL = currency.llOther$;

          totalOtherAnnualPSF += row.otherPSF;

          if (devGuardsEnabled) {
            [
              'netTotal', 'grossTotal', 'preBase$', 'freeBase$', 'other$', 'recoveries$', 'llOpex$',
              'tenantTaxes$', 'tenantCam$', 'tenantIns$', 'tenantOther$',
              'llTaxes$', 'llCam$', 'llIns$', 'llOther$', 'tenantMgmt$', 'llMgmt$'
            ].forEach(key => warnIfFormatted(`row.${key}`, row[key]));
            customItemsExact.forEach((item, idx) => {
              warnIfFormatted(`customItems[${idx}].tenantDollars`, item.tenantDollars);
              warnIfFormatted(`customItems[${idx}].landlordDollars`, item.landlordDollars);
            });
          }

          schedule.push(row);
        }
  
        hasOtherOpEx = totalOtherAnnualPSF > 0;

        pvRent = pvFromExact(monthlyGrossCash, rMonthly, pvStartOffset);
        pvRentNet = pvFromExact(monthlyNetCash, rMonthly, pvStartOffset);
        pvLLOpex = pvFromExact(monthlyLLOpexCash, rMonthly, pvStartOffset);
        freeGrossPV = pvFromExact(monthlyFreeGross, rMonthly, pvStartOffset);

        // -----------------------------------------------------------------------
        // Cash-flow comparison helpers (Landlord Free TI / Allowance lines)
        // -----------------------------------------------------------------------
        const landlordFreeTI = Array(schedule.length + 1).fill(0);
        const freeTIAllowance = Array(schedule.length + 1).fill(0);

        landlordFreeTI[0] = landlordFreeTICash;
        freeTIAllowance[0] = landlordFreeTICash;
  
        // -----------------------------------------------------------------------
        // KPIs (PV & simple)
        // -----------------------------------------------------------------------
  
        function setTermChip(data) {
          const container = document.getElementById('termChip');
          if (!container) return;

          const summary = (data && data.startDate instanceof Date && Array.isArray(data.chips))
            ? data
            : (typeof getLeaseTimingSummary === 'function' ? getLeaseTimingSummary(data || {}) : null);

          const chips = summary?.chips?.filter(Boolean) || [];

          container.innerHTML = '';

          if (!chips.length) {
            container.style.display = 'none';
            return;
          }

          for (const text of chips) {
            const pill = document.createElement('span');
            pill.className = 'chip';
            pill.textContent = text;
            container.appendChild(pill);
          }

          container.style.display = '';
        }
       
        const yearsTerm = term / 12;
        const nerPV = (yearsTerm > 0 && area > 0)
          ? ((pvRentNet - pvTI_forNER) / area) / yearsTerm
          : 0;

        const nerSimple = (yearsTerm > 0 && area > 0)
          ? ((totalPaidNet - llAllowanceApplied) / area) / yearsTerm
          : 0;

        let totalBaseRentNominal = 0;
        schedule.forEach(row => {
          if (!row || !row.isTermMonth) return;
          const paidBase = (+row.preBase$ || 0) - (+row.freeBase$ || 0);
          totalBaseRentNominal += paidBase;
        });
        // exact-first: keep full precision; defer rounding to display
        // totalBaseRentNominal remains as-is

        const safeNum = (n) => (Number.isFinite(n) ? n : 0);
        const kpis = buildKpis({
          schedule,
          termMonths: term,
          totalNetRent: safeNum(totalPaidNet),
          totalGrossRent: safeNum(totalPaidGross),
          totalBaseRent: safeNum(totalBaseRentNominal),
          totalRecoveries: undefined,
          totalOpex: safeNum(totalLLOpex)
        });
        const { avgMonthlyNet, avgMonthlyGross, termMonths: safeTermMonths } = kpis;

        const grossSummaries = summarizeGrossByPerspective({
          schedule,
          area,
          serviceType: type
        });
        const perspectiveKey = (activePerspective === 'tenant') ? 'tenant' : 'landlord';
        const grossSummaryForCards = grossSummaries[perspectiveKey] || grossSummaries.tenant || {
          avgMonthlyGross,
          totalGross: kpis.totalGrossRent
        };

        // ----- KPI: Spread & Recovery
        const avgMonthlySpread = safeTermMonths > 0
          ? (kpis.totalGrossRent - kpis.totalNetRent) / safeTermMonths
          : 0;           // $/mo
        const recoveryRatio = (tenantOpExNominal + totalLLOpex) > 0
          ? tenantOpExNominal / (tenantOpExNominal + totalLLOpex)
          : null;

        // ----- KPI: All-in occupancy (avg gross per SF per month)
        const occPSFmo = (safeTermMonths > 0 && area > 0)
          ? (kpis.totalGrossRent / safeTermMonths) / area
          : 0;

        // ----- KPI: Free Rent (PV) + (% term abated)
        const pctAbated = safeTermMonths > 0 ? (abatedMonths / safeTermMonths) : 0;
  
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
        if (nerPVEl) nerPVEl.textContent = formatUSD(nerPV);
        if (nerSimpleEl) nerSimpleEl.textContent = formatUSD(nerSimple);
        if (avgNetMonthlyEl) avgNetMonthlyEl.textContent = formatUSD(avgMonthlyNet);
        if (avgGrossMonthlyEl) avgGrossMonthlyEl.textContent = formatUSD(grossSummaryForCards.avgMonthlyGross);
        if (totalNetEl) totalNetEl.textContent = formatUSD(kpis.totalNetRent);
        if (totalGrossEl) totalGrossEl.textContent = formatUSD(grossSummaryForCards.totalGross);
      
        function renderKpis(data) {
          // ... existing KPI assignments (lease starts/ends, totals, etc.)
          document.getElementById('leaseEndsVal').textContent = data.leaseEndLabel; // your code
      
          // NEW: set the term chip
          setTermChip(data);
        }
  
        // -----------------------------------------------------------------------
        // Build “model” and publish for charts/scenarios
        // -----------------------------------------------------------------------
        const taxesModeForModel = taxesMode;
        const camModeForModel = camMode;
        const insModeForModel = insMode;
        const mgmtModeForModel = mgmtMode;
  
        const commencementISO = startDate
          ? `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`
          : null;
        const startYearValue = Number.isFinite(startDate.getFullYear()) ? startDate.getFullYear() : null;

        const model = {
          address,
          area,
          termMonths: term,
          startYear: startYearValue,
          commencementDate: commencementISO,
          leaseStartISO: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`,
          leaseEndISO: (() => {
            const d = new Date(startDate.getFullYear(), startDate.getMonth() + scheduleMonths - 1, 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          })(),
          nerPV,
          simpleNet: nerSimple,
          avgNetMonthly: avgMonthlyNet,
          avgGrossMonthly: avgMonthlyGross,
          totalPaidNet: kpis.totalNetRent,
          totalPaidGross: kpis.totalGrossRent,
          schedule,
          compareSeries: {
            landlordFreeTI,
            freeTIAllowance
          },

          freeRent: {
            months: freeMonths,
            patternMonths: customPatternMonths,
            placement: freePlacement,
            timing: freeTiming
          },

          serviceType: type,
          customExpenses: extraOpExRows.map(row => ({ ...row })),
          coreOpExModes: {
            taxes: taxesModeForModel,
            cam: camModeForModel,
            ins: insModeForModel,
            mgmt: mgmtModeForModel
          },
          coreOpExStopTypes: {
            taxes: taxesStopType,
            cam: camStopType,
            ins: insStopType,
            mgmt: 'base'
          },
  
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
        model.grossSummaries = grossSummaries;

        const leaseTiming = typeof getLeaseTimingSummary === 'function'
          ? getLeaseTimingSummary(model)
          : null;
        const formatLeaseLabel = (date) => (date instanceof Date && !Number.isNaN(date.getTime()))
          ? date.toLocaleString(undefined, { month: 'short', year: 'numeric' })
          : '—';
        const startLabel = leaseTiming
          ? formatLeaseLabel(leaseTiming.startDate)
          : startDate.toLocaleString(undefined, { month: 'short', year: 'numeric' });
        const endFallback = new Date(startDate.getFullYear(), startDate.getMonth() + scheduleMonths - 1, 1);
        const endLabel = leaseTiming
          ? formatLeaseLabel(leaseTiming.endDate)
          : endFallback.toLocaleString(undefined, { month: 'short', year: 'numeric' });
        if (leaseStartEl) {
          leaseStartEl.textContent = startLabel;
        }
        if (leaseEndEl) {
          leaseEndEl.textContent = endLabel;
        }

        // Summary metrics for comparison views
        const termRows = schedule.filter(row => row && row.isTermMonth);
        let firstMonthGross = 0;
        let lastMonthGross = 0;
        let peakMonthlyGross = 0;
        if (termRows.length) {
          firstMonthGross = Number(termRows[0]?.grossTotal || 0);
          lastMonthGross = Number(termRows[termRows.length - 1]?.grossTotal || 0);
          peakMonthlyGross = termRows.reduce((max, row) => {
            const val = Number(row?.grossTotal || 0);
            return val > max ? val : max;
          }, 0);
        }

        const freeMonthsTotal = Math.max(0, (freeMonths || 0) + (customPatternMonths || 0));
        const primaryEscPct = (() => {
          if (escMode === 'pct') return escalation * 100;
          if (escMode === 'custom_pct' && escPctList.length) return escPctList[0] * 100;
          return null;
        })();

        const firstOpexRow = termRows.find(r => r?.tenPSF && (
          (r.tenPSF.taxes || 0) || (r.tenPSF.cam || 0) || (r.tenPSF.ins || 0) ||
          (r.tenPSF.other || 0) || (r.tenPSF.mgmt || 0)
        )) || termRows[0];
        let opexStartPSF = null;
        if (firstOpexRow && firstOpexRow.tenPSF) {
          opexStartPSF =
            (Number(firstOpexRow.tenPSF.taxes) || 0) +
            (Number(firstOpexRow.tenPSF.cam) || 0) +
            (Number(firstOpexRow.tenPSF.ins) || 0) +
            (Number(firstOpexRow.tenPSF.other) || 0) +
            (Number(firstOpexRow.tenPSF.mgmt) || 0);
        }

        let opexEscPct = null;
        if (termRows.length && area > 0) {
          const startYear = termRows[0]?.calYear;
          if (Number.isFinite(startYear)) {
            const rowsForYear = (yr) => termRows.filter(r => r?.calYear === yr && r.tenPSF);
            const psfForYear = (yr) => {
              const rows = rowsForYear(yr);
              if (!rows.length) return null;
              const total = rows.reduce((sum, r) => {
                const val =
                  (Number(r.tenPSF?.taxes) || 0) +
                  (Number(r.tenPSF?.cam) || 0) +
                  (Number(r.tenPSF?.ins) || 0) +
                  (Number(r.tenPSF?.other) || 0) +
                  (Number(r.tenPSF?.mgmt) || 0);
                return sum + val;
              }, 0);
              return total / rows.length;
            };
            const year1 = psfForYear(startYear);
            const year2 = psfForYear(startYear + 1);
            if (year1 != null && year2 != null && Math.abs(year1) > 1e-6) {
              opexEscPct = ((year2 - year1) / Math.abs(year1)) * 100;
            }
          }
        }

        const financedPrincipal = (llAllowTreatment === 'amort') ? llAllowanceApplied : 0;
        const netTenantCashAtPos = (-totalCapex) + landlordFreeTICash + financedPrincipal;

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
          llFreeTIY0:      landlordFreeTICash,
          llFinancedTIY0:  (llAllowTreatment === 'amort' ? llAllowanceApplied : 0),
          totalCapex,              // NEW: Total Improvement Costs (for Build-Out Costs row)


          // A6 — expose TI amortization params for scenarios.js
          tiApr: llAllowApr,                              // annual (decimal)
          tiRateMonthly: Math.max(0, llAllowApr) / 12,    // monthly rate
          termMonths: term,                               // mirror so scenarios can read from kpis

          // Comparison summary helpers
          startNetAnnualPSF: baseRent,
          escalationPct: primaryEscPct,
          totalBaseRentNominal,
          avgMonthlyNet,
          freeMonths: freeMonthsTotal,
          freePlacement,
          tiAllowanceTotal: llAllowTotal,
          freeRentValueNominal: freeGrossNominal,
          opexStartPSF,
          opexEscalationPct: opexEscPct,
          netTenantCashAtPos,
          nerPV,
          nerNonPV: nerSimple,
          firstMonthRent: firstMonthGross,
          lastMonthRent: lastMonthGross,
          peakMonthly: peakMonthlyGross,
          summaryChips: leaseTiming?.chips || [],
          topline: kpis
        };

        model.toplineKpis = kpis;

        model.__inputs = captureModelInputs({
          customExpenses: extraOpExRows,
          capexRows
        });


        // update the new KPI cards (function you already defined above)
        updateExtraKpis(model);

        // after building model
        setTermChip(leaseTiming || model);
  
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
    window.calculate = calculate;
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
  
      function lineDisplayPolicy({ perspective, mode, stopType }) {
        const view = (perspective || '').toString().toLowerCase();
        const normalizedMode = (mode || '').toString().toLowerCase();
        const normalizedStop = (stopType || '').toString().toLowerCase();
  
        const showColumn = (view === 'tenant') ? (normalizedMode !== 'landlord') : true;
  
        let badge = '';
        if (normalizedMode === 'tenant') {
          badge = (view === 'tenant') ? 'Tenant-paid' : 'Recovered';
        } else if (normalizedMode === 'landlord') {
          badge = 'LL-paid';
        } else if (normalizedMode === 'stop') {
          badge = 'split';
        }
  
        return { showColumn, badge, mode: normalizedMode, stopType: normalizedStop };
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
      const defaultArea = Number(model?.area) || 0;
      const serviceType = model?.serviceType || '';
      const includeGross = includeOpExInGross('tenant', serviceType);
  
      return schedule.map(row => {
        const area = Number(row.area) || defaultArea || 0;
        const cashFactor = Number(row.cashFactor) || 1;
        const base$ = Number(row.netTotal) || 0;
        const grossRaw$ = Number(row.totals?.monthlyCashOut ?? (row.grossTotal || 0)) || 0;
        const taxes$ = Number(row.tenantTaxes$) || 0;
        const cam$ = Number(row.tenantCam$) || 0;
        const ins$ = Number(row.tenantIns$) || 0;
        const mgmt$ = Number(row.tenantMgmt$) || 0;
        const customItems = Array.isArray(row.customItems) ? row.customItems : [];
        const customTenant$ = customItems.reduce((sum, item) => sum + (Number(item.tenantDollars) || 0), 0);
        const other$ = Number(row.tenantOther$) || customTenant$ || 0;
        const abatement$ = Number(row.freeBase$) || 0;
  
        const baseRentPSF = annualPSFFromDollars(base$, area, cashFactor);
        const taxesPSF = annualPSFFromDollars(taxes$, area, cashFactor);
        const camPSF = annualPSFFromDollars(cam$, area, cashFactor);
        const insPSF = annualPSFFromDollars(ins$, area, cashFactor);
        const mgmtPSF = annualPSFFromDollars(mgmt$, area, cashFactor);
        const otherPSF = annualPSFFromDollars(other$, area, cashFactor);
  
        const displayGross$ = includeGross
          ? grossRaw$
          : base$;
        const grossPSF = annualPSFFromDollars(displayGross$, area, cashFactor);
  
        const rowTotals = {
          monthlyNet: base$,
          monthlyGross: displayGross$,
          monthlyCashOut: grossRaw$,
          grossOccPSF: grossPSF,
          tenantOpExMonthly: taxes$ + cam$ + ins$ + mgmt$ + customTenant$
        };
  
        return {
          period: row.monthIndex,
          year: row.calYear,
          month: row.calMonth,
          spaceSize: area,
          cashFactor,
          baseRentPSF,
          taxesPSF,
          camPSF,
          insPSF,
          mgmtPSF,
          otherPSF,
          grossPSF,
          monthlyNet$: base$,
          monthlyGross$: displayGross$,
          isAbated: !!row.isAbated,
          abatement$,
          tenantTaxes$: taxes$,
          tenantCam$: cam$,
          tenantIns$: ins$,
          tenantMgmt$: mgmt$,
          tenantOther$: other$,
          otherMonthly$Tenant: other$,
          totals: row.totals ? { ...row.totals, ...rowTotals } : rowTotals,
          opEx: row.opEx,
          customItems: row.customItems
        };
      });
    }
  
    function buildLandlordSchedule(model) {
      const schedule = Array.isArray(model?.schedule) ? model.schedule : [];
      const defaultArea = Number(model?.area) || 0;
      const serviceType = model?.serviceType || '';
      const includeGross = includeOpExInGross('landlord', serviceType);
  
      return schedule.map(row => {
        const area = Number(row.area) || defaultArea || 0;
        const cashFactor = Number(row.cashFactor) || 1;
        const baseCollected$ = Number(row.netTotal) || 0;
        const taxesRecovery = Number(row.tenantTaxes$) || 0;
        const camRecovery = Number(row.tenantCam$) || 0;
        const insRecovery = Number(row.tenantIns$) || 0;
        const mgmtRecovery = Number(row.tenantMgmt$) || 0;
        const customItems = Array.isArray(row.customItems) ? row.customItems : [];
  
        const customRecoveries = {};
        let customRecovery = 0;
        let customLandlordBurden = 0;
        customItems.forEach((item, idx) => {
          const key = item.id || `custom-${idx + 1}`;
          const tenant$ = Number(item.tenantDollars) || 0;
          const landlord$ = Number(item.landlordDollars) || 0;
          customRecoveries[key] = {
            label: item.label || key,
            mode: item.mode || 'tenant',
            total: tenant$,
            landlordPortion: landlord$,
            baseAnnual: item.baseAnnual ?? null,
            stopType: item.stopType || null,
            fixedStop: item.fixedStop ?? null
          };
          customRecovery += tenant$;
          customLandlordBurden += landlord$;
        });
  
        const totalRecovery = taxesRecovery + camRecovery + insRecovery + mgmtRecovery + customRecovery;
        const totalCashIn$ = Number(row.totals?.totalCashIn ?? (baseCollected$ + totalRecovery)) || 0;
  
        const llTaxes$ = Number(row.llTaxes$) || 0;
        const llCam$ = Number(row.llCam$) || 0;
        const llIns$ = Number(row.llIns$) || 0;
        const llMgmt$ = Number(row.llMgmt$) || 0;
        const llOther$ = Number(row.llOther$) || 0;
        const abatement$ = Number(row.freeBase$) || 0;
        const otherTenant$ = Number(row.tenantOther$) || 0;
  
        const landlordOpEx = llTaxes$ + llCam$ + llIns$ + llOther$ + llMgmt$ + customLandlordBurden;
        const freeRent = Number(row.freeBase$) || 0;
        const tiOutlay = Number(row.tiOutlayThisPeriod) || 0;
        const lcOutlay = Number(row.lcOutlayThisPeriod) || 0;
  
        const netCash = totalCashIn$ - freeRent - tiOutlay - lcOutlay - landlordOpEx;
        const unrecoveredOpEx = landlordOpEx - totalRecovery;
  
        const nonOpExCash$ = totalCashIn$ - totalRecovery;
        const displayGross$ = includeGross ? totalCashIn$ : nonOpExCash$;
  
        const baseRentPSF_LL = annualPSFFromDollars(baseCollected$, area, cashFactor);
        const taxesPSF_LL = annualPSFFromDollars(llTaxes$, area, cashFactor);
        const camPSF_LL = annualPSFFromDollars(llCam$, area, cashFactor);
        const insPSF_LL = annualPSFFromDollars(llIns$, area, cashFactor);
        const otherPSF_LL = annualPSFFromDollars(llOther$, area, cashFactor);
        const mgmtPSF_LL = annualPSFFromDollars(llMgmt$, area, cashFactor);
        const grossPSF_LL = annualPSFFromDollars(displayGross$, area, cashFactor);
  
        const monthlyNet$ = baseCollected$;
        const monthlyGross$ = displayGross$;
  
        const rowTotals = {
          totalCashIn: totalCashIn$,
          freeRent,
          tiOutlay,
          lcOutlay,
          netCash,
          landlordOpEx,
          tenantRecovery: totalRecovery,
          unrecoveredOpEx,
          monthlyNet: monthlyNet$,
          monthlyGross: monthlyGross$
        };
  
        return {
          period: row.monthIndex,
          year: row.calYear,
          month: row.calMonth,
          spaceSize: area,
          cashFactor,
          baseRentPSF_LL,
          taxesPSF_LL,
          camPSF_LL,
          insPSF_LL,
          mgmtPSF_LL,
          otherPSF: otherPSF_LL,
          otherPSF_LL,
          grossPSF_LL,
          monthlyNet$,
          monthlyGross$,
          isAbated: !!row.isAbated,
          abatement$,
          baseCollected: baseCollected$,
          tenantTaxes$: taxesRecovery,
          tenantCam$: camRecovery,
          tenantIns$: insRecovery,
          tenantMgmt$: mgmtRecovery,
          tenantOther$: otherTenant$,
          llTaxes$: llTaxes$,
          llCam$: llCam$,
          llIns$: llIns$,
          llMgmt$: llMgmt$,
          llOther$: llOther$,
          otherMonthly$Tenant: otherTenant$,
          otherMonthly$LL: llOther$,
          totals: row.totals ? { ...row.totals, ...rowTotals } : rowTotals,
          recoveries: {
            taxes: taxesRecovery,
            cam: camRecovery,
            ins: insRecovery,
            mgmt: mgmtRecovery,
            custom: customRecoveries
          },
          customItems: row.customItems
        };
      });
    }
  
    function summarizeGrossByPerspective(model) {
      const tenantRows = buildTenantSchedule(model);
      const landlordRows = buildLandlordSchedule(model);
  
      const summarize = (rows) => {
        const totalGross = rows.reduce((sum, r) => sum + (Number(r.monthlyGross$) || 0), 0);
        const months = rows.length || 0;
        return {
          totalGross,
          avgMonthlyGross: months ? totalGross / months : 0
        };
      };
  
      return {
        tenant: summarize(tenantRows),
        landlord: summarize(landlordRows)
      };
    }
  
    function buildMonthlyRows(model, perspective) {
      return perspective === 'tenant'
        ? buildTenantSchedule(model)
        : buildLandlordSchedule(model);
    }

    function buildYearlyAbatementRows(monthlyRows = []) {
      if (!Array.isArray(monthlyRows) || monthlyRows.length === 0) return [];

      const toNumber = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
      };

      const ensureMonthIndex = (row, idx) => {
        const raw = Number(row?.period);
        if (Number.isFinite(raw) && raw > 0) return raw;
        return idx + 1;
      };

      const createAggregate = (leaseYear, key) => ({
        leaseYear,
        segmentKey: key,
        segment: key === 'abatement' ? 'Abatement' : 'Rent',
        months: 0,
        base: 0,
        taxes: 0,
        cam: 0,
        ins: 0,
        mgmt: 0,
        totalNet: 0,
        totalGross: 0,
        abatement: 0,
        spaceSF: 0
      });

      const addRowToAggregate = (agg, row) => {
        if (!agg || !row) return;
        agg.months += 1;
        agg.base += toNumber(row.baseCollected ?? row.monthlyNet$ ?? row.totals?.monthlyNet);
        const recoveries = row.recoveries || {};
        agg.taxes += toNumber(recoveries.taxes ?? row.totals?.taxes ?? row.opEx?.taxes);
        agg.cam += toNumber(recoveries.cam ?? row.totals?.cam ?? row.opEx?.cam);
        agg.ins += toNumber(recoveries.ins ?? row.totals?.ins ?? row.opEx?.ins);
        agg.mgmt += toNumber(recoveries.mgmt ?? row.totals?.mgmt ?? row.opEx?.mgmt);
        agg.totalNet += toNumber(row.monthlyNet$ ?? row.totals?.monthlyNet);
        agg.totalGross += toNumber(row.monthlyGross$ ?? row.totals?.monthlyGross ?? row.totals?.monthlyCashOut);
        agg.abatement += toNumber(row.totals?.freeRent ?? row.freeRent ?? row.totals?.freeRentValue);

        const space = toNumber(row.spaceSize);
        if (space > 0 && agg.spaceSF <= 0) {
          agg.spaceSF = space;
        }
      };

      const aggregates = new Map();

      monthlyRows.forEach((row, idx) => {
        if (!row) return;
        const leaseMonth = Math.max(1, ensureMonthIndex(row, idx));
        const leaseYear = 1 + Math.floor((leaseMonth - 1) / 12);
        const key = row.isAbated ? 'abatement' : 'rent';
        const entry = aggregates.get(leaseYear) || { rent: null, abatement: null };
        if (!entry[key]) {
          entry[key] = createAggregate(leaseYear, key);
        }
        addRowToAggregate(entry[key], row);
        aggregates.set(leaseYear, entry);
      });

      const finalizeAggregate = (agg) => {
        if (!agg) return null;
        const months = Math.max(0, agg.months);
        const totalGross = toNumber(agg.totalGross);
        const space = toNumber(agg.spaceSF);
        let grossPerSFPerYr = 0;
        if (totalGross !== 0 && space > 0 && months > 0) {
          const years = months / 12;
          if (years > 0) {
            grossPerSFPerYr = totalGross / space / years;
          }
        }
        return {
          leaseYear: agg.leaseYear,
          segment: agg.segment,
          months,
          base: agg.base,
          taxes: agg.taxes,
          cam: agg.cam,
          ins: agg.ins,
          mgmt: agg.mgmt,
          totalNet: agg.totalNet,
          totalGross,
          abatement: agg.abatement,
          spaceSF: space,
          grossPerSFPerYr
        };
      };

      const years = Array.from(aggregates.keys()).sort((a, b) => a - b);
      const rows = [];
      years.forEach(year => {
        const entry = aggregates.get(year);
        if (!entry) return;
        if (entry.abatement && entry.abatement.months > 0) {
          rows.push(finalizeAggregate(entry.abatement));
        }
        if (entry.rent && entry.rent.months > 0) {
          rows.push(finalizeAggregate(entry.rent));
        }
      });

      return rows.filter(Boolean);
    }
  
    function buildMonthlyColumns(model, perspective) {
      const coreModes = model?.coreOpExModes || {};
      const coreStopTypes = model?.coreOpExStopTypes || {};
      const normalizeMode = (mode) => (mode || '').toLowerCase();
      const stopTypeFor = (key) => (coreStopTypes[key] || 'base').toLowerCase();
      const hasOther = !!model?.hasOtherOpEx;
      const customExpenses = Array.isArray(model?.customExpenses) ? model.customExpenses : [];
  
      const otherMeta = (() => {
        if (!hasOther) return { mode: 'landlord', stopType: 'base' };
        let hasStop = false;
        let hasTenant = false;
        let anyFixed = false;
        customExpenses.forEach(exp => {
          const m = (exp.mode || '').toLowerCase();
          if (m === 'stop') {
            hasStop = true;
            if ((exp.stopType || '').toLowerCase() === 'fixed') anyFixed = true;
          } else if (m === 'tenant') {
            hasTenant = true;
          }
        });
        if (hasStop) return { mode: 'stop', stopType: anyFixed ? 'fixed' : 'base' };
        if (hasTenant) return { mode: 'tenant', stopType: 'base' };
        return { mode: 'landlord', stopType: 'base' };
      })();
  
      const lineMeta = {
        taxes: { mode: normalizeMode(coreModes.taxes), stopType: stopTypeFor('taxes') },
        cam:   { mode: normalizeMode(coreModes.cam), stopType: stopTypeFor('cam') },
        ins:   { mode: normalizeMode(coreModes.ins), stopType: stopTypeFor('ins') },
        mgmt:  { mode: normalizeMode(coreModes.mgmt), stopType: stopTypeFor('mgmt') },
        other: otherMeta
      };
  
      const policiesTenant = {
        taxes: lineDisplayPolicy({ perspective: 'tenant', ...lineMeta.taxes }),
        cam:   lineDisplayPolicy({ perspective: 'tenant', ...lineMeta.cam }),
        ins:   lineDisplayPolicy({ perspective: 'tenant', ...lineMeta.ins }),
        mgmt:  lineDisplayPolicy({ perspective: 'tenant', ...lineMeta.mgmt }),
        other: lineDisplayPolicy({ perspective: 'tenant', ...lineMeta.other })
      };
  
      const policiesLandlord = {
        taxes: lineDisplayPolicy({ perspective: 'landlord', ...lineMeta.taxes }),
        cam:   lineDisplayPolicy({ perspective: 'landlord', ...lineMeta.cam }),
        ins:   lineDisplayPolicy({ perspective: 'landlord', ...lineMeta.ins }),
        mgmt:  lineDisplayPolicy({ perspective: 'landlord', ...lineMeta.mgmt }),
        other: lineDisplayPolicy({ perspective: 'landlord', ...lineMeta.other })
      };
  
      const labelForLine = (baseName, meta) => {
        if ((meta.mode || '') === 'stop') {
          const suffix = (meta.stopType === 'fixed') ? 'Over Fixed Stop' : 'Over Base';
          return `${baseName} ${suffix} ($/SF/yr)`;
        }
        return `${baseName} ($/SF/yr)`;
      };
  
      const headerFor = (baseName, meta, policy) => {
        const label = labelForLine(baseName, meta);
        const badge = hdrBadge(policy.badge);
        return {
          label,
          headerHTML: badge ? `${label}${badge}` : undefined
        };
      };
  
      const tenantColumns = [
        { key: 'period', label: 'Period', render: r => r.period, isLabel: true },
        { key: 'year', label: 'Year', render: r => r.year },
        { key: 'month', label: 'Month', render: r => r.month },
        { key: 'spaceSize', label: 'Space Size (SF)', render: r => (Number(r.spaceSize || 0)).toLocaleString() },
        { key: 'baseRentPSF', label: 'Base Rent ($/SF/yr)', render: r => fmtUSD(r.baseRentPSF || 0), isPSF: true }
      ];
  
      const pushTenantCol = (key, meta, policy, baseName) => {
        if (!policy.showColumn) return;
        const labelText = labelForLine(baseName, meta);
        const badgeHtml = hdrBadge(policy.badge);
        tenantColumns.push({
          key,
          label: labelText,
          headerHTML: badgeHtml ? `${labelText}${badgeHtml}` : labelText,
          render: r => fmtUSD(Number(r[key] || 0)),
          isPSF: true
        });
      };
  
      pushTenantCol('taxesPSF', lineMeta.taxes, policiesTenant.taxes, 'Taxes');
      pushTenantCol('camPSF', lineMeta.cam, policiesTenant.cam, 'CAM');
      pushTenantCol('insPSF', lineMeta.ins, policiesTenant.ins, 'Insurance');
      if (hasOther) {
        pushTenantCol('otherPSF', lineMeta.other, policiesTenant.other, 'Other OpEx');
      }
      pushTenantCol('mgmtPSF', lineMeta.mgmt, policiesTenant.mgmt, 'Management Fee');
  
      tenantColumns.push(
        { key: 'grossPSF', label: 'Gross Rent ($/SF/yr)', render: r => fmtUSD(r.grossPSF || 0), isPSF: true },
        { key: 'monthlyNet$', label: 'Monthly Net Rent ($)', render: r => fmtUSD(r.monthlyNet$ || 0), sum: r => r.monthlyNet$ || 0, className: 'cell-dollar', isDollar: true },
        { key: 'monthlyGross$', label: 'Monthly Gross Rent ($)', render: r => fmtUSD(r.monthlyGross$ || 0), sum: r => r.monthlyGross$ || 0, className: 'cell-dollar', isDollar: true }
      );
  
      const landlordColumns = [
        { key: 'period', label: 'Period', render: r => r.period, isLabel: true },
        { key: 'year', label: 'Year', render: r => r.year },
        { key: 'month', label: 'Month', render: r => r.month },
        { key: 'spaceSize', label: 'Space Size (SF)', render: r => (Number(r.spaceSize || 0)).toLocaleString() },
        { key: 'baseRentPSF_LL', label: 'Base Rent ($/SF/yr)', render: r => fmtUSD(r.baseRentPSF_LL || 0), isPSF: true }
      ];
  
      const taxesHeader = headerFor('Taxes', lineMeta.taxes, policiesLandlord.taxes);
      landlordColumns.push({
        key: 'taxesPSF_LL',
        label: taxesHeader.label,
        headerHTML: taxesHeader.headerHTML,
        render: r => fmtUSD(r.taxesPSF_LL || 0),
        isPSF: true
      });
  
      const camHeader = headerFor('CAM', lineMeta.cam, policiesLandlord.cam);
      landlordColumns.push({
        key: 'camPSF_LL',
        label: camHeader.label,
        headerHTML: camHeader.headerHTML,
        render: r => fmtUSD(r.camPSF_LL || 0),
        isPSF: true
      });
  
      const insHeader = headerFor('Insurance', lineMeta.ins, policiesLandlord.ins);
      landlordColumns.push({
        key: 'insPSF_LL',
        label: insHeader.label,
        headerHTML: insHeader.headerHTML,
        render: r => fmtUSD(r.insPSF_LL || 0),
        isPSF: true
      });
  
      if (hasOther) {
        const otherHeader = headerFor('Other OpEx', lineMeta.other, policiesLandlord.other);
        landlordColumns.push({
          key: 'otherPSF',
          label: otherHeader.label,
          headerHTML: otherHeader.headerHTML,
          render: r => fmtUSD(Number(r.otherPSF || 0)),
          isPSF: true
        });
      }
  
      const mgmtHeader = headerFor('Management Fee', lineMeta.mgmt, policiesLandlord.mgmt);
      landlordColumns.push(
        { key: 'mgmtPSF_LL', label: mgmtHeader.label, headerHTML: mgmtHeader.headerHTML, render: r => fmtUSD(r.mgmtPSF_LL || 0), isPSF: true },
        { key: 'grossPSF_LL', label: 'Gross Rent ($/SF/yr)', render: r => fmtUSD(r.grossPSF_LL || 0), isPSF: true },
        { key: 'monthlyNet$', label: 'Monthly Net Rent ($)', render: r => fmtUSD(r.monthlyNet$ || 0), sum: r => r.monthlyNet$ || 0, className: 'cell-dollar', isDollar: true },
        { key: 'monthlyGross$', label: 'Monthly Gross Rent ($)', render: r => fmtUSD(r.monthlyGross$ || 0), sum: r => r.monthlyGross$ || 0, className: 'cell-dollar', isDollar: true }
      );
  
      return (perspective === 'tenant') ? tenantColumns : landlordColumns;
    }
  
    function renderTableHeader(schema, thead) {
      thead.innerHTML = '';
      const headerRow = document.createElement('tr');
      schema.forEach(col => {
        const th = document.createElement('th');
        if (col.headerHTML) th.innerHTML = col.headerHTML;
        else th.textContent = col.label;
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
    }
  
    function renderScheduleTable(model, perspective, table, thead, tbody) {
      const rows = buildMonthlyRows(model, perspective);

      if (!Array.isArray(rows) || rows.length === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = '';
        return;
      }

      const schema = buildMonthlyColumns(model, perspective);
      const labelColIdx = Math.max(0, schema.findIndex(col => col.isLabel));

      renderTableHeader(schema, thead);

      tbody.innerHTML = '';
      const totals = new Array(schema.length).fill(0);
      const sumFns = schema.map(col => (typeof col.sum === 'function') ? col.sum : null);

      rows.forEach(row => {
        const tr = document.createElement('tr');
        schema.forEach((col, idx) => {
          const td = document.createElement('td');
          const rendered = col.render(row);
          if (col.className) {
            col.className.split(/\s+/).filter(Boolean).forEach(cls => td.classList.add(cls));
          }
          td.textContent = rendered;
          tr.appendChild(td);
          if (sumFns[idx]) {
            totals[idx] += Number(sumFns[idx](row) || 0);
          }
        });
        tbody.appendChild(tr);
      });

      const totalRow = document.createElement('tr');
      totalRow.classList.add('grand-total', 'row-grandtotal');
      schema.forEach((col, idx) => {
        const td = document.createElement('td');
        if (col.className) {
          col.className.split(/\s+/).filter(Boolean).forEach(cls => td.classList.add(cls));
        }
        if (idx === labelColIdx) {
          td.textContent = 'Grand Total';
        } else if (sumFns[idx]) {
          td.textContent = fmtUSD(totals[idx]);
          td.classList.add('cell-dollar');
        } else {
          td.textContent = EM_DASH;
          td.classList.add('cell-muted');
        }
        totalRow.appendChild(td);
      });
      tbody.appendChild(totalRow);
    }

    function computeYearlyAbatementRollup({ monthlyRows = [], perspective = 'landlord', psfKeys = [], sumKeys = [] } = {}) {
      const safeRows = Array.isArray(monthlyRows) ? monthlyRows : [];
      const safePsfKeys = Array.isArray(psfKeys) ? psfKeys.slice() : [];
      const safeSumKeys = Array.isArray(sumKeys) ? sumKeys.slice() : [];

      const toNumber = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
      };

      const psfDollarValue = (row, key) => {
        switch (key) {
          case 'baseRentPSF':
          case 'baseRentPSF_LL':
            return toNumber(row.baseCollected ?? row.monthlyNet$ ?? row.totals?.monthlyNet);
          case 'grossPSF':
          case 'grossPSF_LL':
            return toNumber(row.monthlyGross$ ?? row.totals?.monthlyGross ?? row.totals?.monthlyCashOut ?? row.totals?.totalCashIn);
          case 'taxesPSF':
            return toNumber(row.tenantTaxes$ ?? row.recoveries?.taxes ?? row.opEx?.taxes ?? row.totals?.taxes);
          case 'taxesPSF_LL':
            return toNumber(row.llTaxes$ ?? row.opEx?.taxes ?? row.totals?.llTaxes ?? row.recoveries?.taxes);
          case 'camPSF':
            return toNumber(row.tenantCam$ ?? row.recoveries?.cam ?? row.opEx?.cam ?? row.totals?.cam);
          case 'camPSF_LL':
            return toNumber(row.llCam$ ?? row.opEx?.cam ?? row.totals?.llCam ?? row.recoveries?.cam);
          case 'insPSF':
            return toNumber(row.tenantIns$ ?? row.recoveries?.ins ?? row.opEx?.ins ?? row.totals?.ins);
          case 'insPSF_LL':
            return toNumber(row.llIns$ ?? row.opEx?.ins ?? row.totals?.llIns ?? row.recoveries?.ins);
          case 'mgmtPSF':
            return toNumber(row.tenantMgmt$ ?? row.recoveries?.mgmt ?? row.opEx?.mgmt ?? row.totals?.mgmt);
          case 'mgmtPSF_LL':
            return toNumber(row.llMgmt$ ?? row.opEx?.mgmt ?? row.totals?.llMgmt ?? row.recoveries?.mgmt);
          case 'otherPSF':
            if (perspective === 'tenant') {
              return toNumber(row.tenantOther$ ?? row.otherMonthly$Tenant ?? 0);
            }
            return toNumber(row.otherMonthly$LL ?? row.llOther$ ?? row.otherMonthly$Tenant ?? 0);
          case 'otherPSF_LL':
            return toNumber(row.otherMonthly$LL ?? row.llOther$ ?? 0);
          default:
            return 0;
        }
      };

      const weightForRow = (row) => {
        const w = Number(row.cashFactor);
        return Number.isFinite(w) && w > 0 ? w : 1;
      };

      const totals = {
        sumByKey: Object.fromEntries(safeSumKeys.map(key => [key, 0])),
        psfWeighted: Object.fromEntries(safePsfKeys.map(key => [key, 0])),
        totalWeight: 0,
        totalMonths: 0,
        hasAbated: false,
        abatedMonths: 0
      };

      if (!safeRows.length) {
        return {
          perspective,
          rows: [],
          psfKeys: safePsfKeys,
          sumKeys: safeSumKeys,
          totals,
          monthlyRows: safeRows
        };
      }

      const baseRentKey = perspective === 'tenant' ? 'baseRentPSF' : 'baseRentPSF_LL';
      const resolveIsAbated = (row) => {
        if (!row || typeof row !== 'object') return false;
        if (Object.prototype.hasOwnProperty.call(row, 'isAbated')) {
          return !!row.isAbated;
        }
        const netValue = toNumber(row.monthlyNet$);
        const baseValue = toNumber(row[baseRentKey]);
        return Math.abs(netValue) <= 1e-9 || Math.abs(baseValue) <= 1e-9;
      };

      const monthRangeLabel = (start, end, count) => {
        if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end > 0) {
          return (start === end) ? `${start}` : `${start}\u2013${end}`;
        }
        if (count === 1) return '1';
        return `${count}`;
      };

      const labelForGroup = (yearKey) => {
        return yearKey != null ? `Lease Year ${yearKey}` : 'Lease Year —';
      };

      safeRows.forEach((row, idx) => {
        if (!row || typeof row !== 'object') return;
        const leaseMonth = Number(row.period) || (idx + 1);
        const leaseYear = 1 + Math.floor((leaseMonth - 1) / 12);
        row.__leaseMonth = leaseMonth;
        row.__leaseYear = leaseYear;
      });

      const resolveLeaseYear = (row) => {
        const derived = Number(row?.__leaseYear);
        return Number.isFinite(derived) && derived > 0 ? derived : null;
      };

      const grouped = new Map();
      safeRows.forEach(row => {
        const leaseYear = resolveLeaseYear(row);
        const yearKey = leaseYear;
        if (!grouped.has(yearKey)) grouped.set(yearKey, []);
        grouped.get(yearKey).push(row);
      });

      const sortedYears = Array.from(grouped.keys()).sort((a, b) => Number(a) - Number(b));
      const aggregatedRows = [];
      let totalAbatedMonths = 0;
      let hasAbated = false;

      const buildAggregatedRow = ({ segmentRows = [], yearRows = [], leaseYear = null, isAbated = false, segmentKey = 'rent' }) => {
        if (!segmentRows.length) return null;
        const monthCount = segmentRows.length;
        const segmentMonths = segmentRows
          .map(r => Number(r.__leaseMonth) || 0)
          .filter(val => val > 0);
        const segMin = segmentMonths.length ? Math.min(...segmentMonths) : null;
        const segMax = segmentMonths.length ? Math.max(...segmentMonths) : null;
        const yearSpace = yearRows.find(r => toNumber(r.spaceSize) > 0);
        const firstRow = segmentRows[0];
        const spaceSize = toNumber(segmentRows.find(r => toNumber(r.spaceSize) > 0)?.spaceSize)
          || toNumber(yearSpace?.spaceSize)
          || 0;
        const cashFactor = firstRow?.cashFactor;
        const segmentAbatedMonths = segmentRows.reduce((count, row) => count + (resolveIsAbated(row) ? 1 : 0), 0);
        const yearAbatedMonths = yearRows.reduce((count, row) => count + (resolveIsAbated(row) ? 1 : 0), 0);

        const aggRow = {
          period: monthRangeLabel(segMin, segMax, monthCount),
          leaseYearLabel: labelForGroup(leaseYear),
          year: leaseYear ?? '',
          month: `${monthCount} Months`,
          segmentLabel: monthRangeLabel(segMin, segMax, monthCount),
          segmentMonthCount: monthCount,
          segmentStartPeriod: segMin,
          segmentEndPeriod: segMax,
          spaceSize,
          cashFactor,
          isAbated,
          segmentKey,
          segmentOrder: segmentKey === 'abatement' ? 0 : 1,
          segmentName: segmentKey === 'abatement' ? 'Abatement' : 'Rent',
          segmentIsAbated: isAbated,
          abatedMonths: yearAbatedMonths,
          segmentAbatedMonths,
          __monthCount: monthCount
        };

        safeSumKeys.forEach(key => {
          const total = segmentRows.reduce((sum, row) => sum + toNumber(row[key]), 0);
          aggRow[key] = total;
        });

        const monthsForPsf = monthCount;
        const yearsForPsf = monthsForPsf / 12;
        const areaForPsf = aggRow.spaceSize || 0;

        safePsfKeys.forEach(key => {
          const totalDollars = segmentRows.reduce((sum, row) => sum + psfDollarValue(row, key), 0);
          if (!areaForPsf || !yearsForPsf || Math.abs(totalDollars) <= 1e-9) {
            aggRow[key] = 0;
            return;
          }
          aggRow[key] = totalDollars / areaForPsf / yearsForPsf;
        });

        const abatementTotal = segmentRows.reduce((sum, row) => sum + toNumber(row.abatement$ || 0), 0);
        aggRow.abatement$ = abatementTotal;
        aggRow.abatementPSF = annualPSFFromDollars
          ? annualPSFFromDollars(abatementTotal, aggRow.spaceSize, aggRow.cashFactor)
          : 0;

        return aggRow;
      };

      sortedYears.forEach(year => {
        const yearRows = (grouped.get(year) || []).slice().sort((a, b) => {
          return (Number(a.__leaseMonth) || 0) - (Number(b.__leaseMonth) || 0);
        });
        if (!yearRows.length) return;

        const abatementRows = yearRows.filter(resolveIsAbated);
        const rentRows = yearRows.filter(row => !resolveIsAbated(row));

        if (abatementRows.length) {
          hasAbated = true;
          totalAbatedMonths += abatementRows.length;
        }

        const orderedSegments = [];
        if (abatementRows.length) {
          const earliest = Math.min(...abatementRows.map(r => Number(r.__leaseMonth) || Infinity));
          orderedSegments.push({ key: 'abatement', rows: abatementRows, earliest });
        }
        if (rentRows.length) {
          const earliest = Math.min(...rentRows.map(r => Number(r.__leaseMonth) || Infinity));
          orderedSegments.push({ key: 'rent', rows: rentRows, earliest });
        }

        orderedSegments.sort((a, b) => a.earliest - b.earliest);

        const yearAggregates = orderedSegments.map(segment => buildAggregatedRow({
          segmentRows: segment.rows,
          yearRows,
          leaseYear: year,
          isAbated: segment.key === 'abatement',
          segmentKey: segment.key
        })).filter(Boolean);

        if (yearAggregates.length > 2) {
          throw new Error(`Lease year ${year} produced more than two rows`);
        }

        aggregatedRows.push(...yearAggregates);
      });

      const sumTotals = Object.fromEntries(safeSumKeys.map(key => [key, 0]));
      aggregatedRows.forEach(aggRow => {
        safeSumKeys.forEach(key => {
          sumTotals[key] += toNumber(aggRow[key]);
        });
      });

      const totalMonths = aggregatedRows.reduce((sum, row) => sum + (Number(row.__monthCount) || 0), 0);
      const totalWeight = safeRows.reduce((sum, row) => sum + weightForRow(row), 0);
      const psfWeightedTotals = Object.fromEntries(safePsfKeys.map(key => [key, 0]));
      safePsfKeys.forEach(key => {
        const weighted = safeRows.reduce((sum, row) => sum + toNumber(row[key]) * weightForRow(row), 0);
        psfWeightedTotals[key] = weighted;
      });

      return {
        perspective,
        rows: aggregatedRows,
        psfKeys: safePsfKeys,
        sumKeys: safeSumKeys,
        monthlyRows: safeRows,
        totals: {
          sumByKey: sumTotals,
          psfWeighted: psfWeightedTotals,
          totalWeight,
          totalMonths,
          hasAbated,
          abatedMonths: totalAbatedMonths
        }
      };
    }

    function buildYearlyAbatementRows(model, perspective = 'landlord', options = {}) {
      const monthlyRows = Array.isArray(options.monthlyRows) ? options.monthlyRows : buildMonthlyRows(model, perspective);
      const schema = Array.isArray(options.schema) ? options.schema : buildMonthlyColumns(model, perspective);
      const providedPsfKeys = Array.isArray(options.psfKeys) ? options.psfKeys : null;
      const providedSumKeys = Array.isArray(options.sumKeys) ? options.sumKeys : null;

      const psfKeys = providedPsfKeys && providedPsfKeys.length
        ? providedPsfKeys.slice()
        : schema.filter(col => col.isPSF && col.key).map(col => col.key);

      const sumKeys = providedSumKeys && providedSumKeys.length
        ? providedSumKeys.slice()
        : schema.filter(col => typeof col.sum === 'function').map(col => col.key);

      return computeYearlyAbatementRollup({ monthlyRows, perspective, psfKeys, sumKeys });
    }

  // -----------------------------------------------------------------------
  // Monthly Rent Schedule Table
  // -----------------------------------------------------------------------
  function renderMonthly(data, table, thead, tbody) {
    table.classList.remove('annual-view','monthly-sub-view');
    renderScheduleTable(data, activePerspective, table, thead, tbody);
  } // <— IMPORTANT: close renderMonthly here
  
  // -----------------------------------------------------------------------
  // Annual Rent Schedule Table
  // -----------------------------------------------------------------------
  function renderAnnual(data, table, thead, tbody) {
    table.classList.add('annual-view');
    table.classList.remove('monthly-sub-view');

    const perspective = activePerspective || 'landlord';
    const monthlyRows = buildMonthlyRows(data, perspective);

    if (!Array.isArray(monthlyRows) || monthlyRows.length === 0) {
      thead.innerHTML = '';
      tbody.innerHTML = '';
      return;
    }

    const schema = buildMonthlyColumns(data, perspective);
    let monthColIndex = -1;

    schema.forEach((col, idx) => {
      if (col.key === 'monthlyNet$') {
        col.label = 'Total Net Rent ($)';
        if (col.headerHTML) {
          col.headerHTML = col.headerHTML.replace(/Monthly Net Rent/gi, 'Total Net Rent');
        }
        col.render = (row) => fmtUSD(Number(row.monthlyNet$ || 0));
      } else if (col.key === 'monthlyGross$') {
        col.label = 'Total Gross Rent ($)';
        if (col.headerHTML) {
          col.headerHTML = col.headerHTML.replace(/Monthly Gross Rent/gi, 'Total Gross Rent');
        }
        col.render = (row) => fmtUSD(Number(row.monthlyGross$ || 0));
      } else if (col.key === 'month') {
        col.label = 'Months';
        if (col.headerHTML) {
          col.headerHTML = col.headerHTML.replace(/Month/gi, 'Months');
        }
        col.render = (row) => row.month;
        monthColIndex = idx;
      }
    });

    const labelColIdx = Math.max(0, schema.findIndex(col => col.isLabel));
    const psfKeyCandidates = schema.filter(col => col.isPSF && col.key).map(col => col.key);
    const sumKeyCandidates = schema.filter(col => typeof col.sum === 'function').map(col => col.key);

    const rollup = buildYearlyAbatementRows(data, perspective, {
      monthlyRows,
      psfKeys: psfKeyCandidates,
      sumKeys: sumKeyCandidates
    });

    const aggregatedRows = Array.isArray(rollup?.rows) ? rollup.rows : [];
    const psfKeys = (Array.isArray(rollup?.psfKeys) && rollup.psfKeys.length)
      ? rollup.psfKeys
      : psfKeyCandidates;
    const sumKeys = (Array.isArray(rollup?.sumKeys) && rollup.sumKeys.length)
      ? rollup.sumKeys
      : sumKeyCandidates;
    const annualRows = aggregatedRows;

    if (!annualRows.length) {
      thead.innerHTML = '';
      tbody.innerHTML = '';
      return;
    }

    renderTableHeader(schema, thead);

    tbody.innerHTML = '';

    const totals = rollup?.totals || {};
    const grandTotals = totals.sumByKey || Object.fromEntries(sumKeys.map(key => [key, 0]));
    const psfWeightedTotals = totals.psfWeighted || Object.fromEntries(psfKeys.map(key => [key, 0]));
    const totalWeight = Number(totals.totalWeight) || 0;
    const totalMonths = Number(totals.totalMonths) || 0;
    const totalAbatedMonths = Number(totals.abatedMonths) || 0;
    const hasAbated = !!totals.hasAbated;

    annualRows.forEach(row => {
      const tr = document.createElement('tr');
      schema.forEach(col => {
        const td = document.createElement('td');
        if (col.className) {
          col.className.split(/\s+/).filter(Boolean).forEach(cls => td.classList.add(cls));
        }
        const value = typeof col.render === 'function' ? col.render(row) : '';
        td.textContent = value == null ? '' : value;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    const grandRow = document.createElement('tr');
    grandRow.classList.add('grand-total', 'row-grandtotal');

    schema.forEach((col, idx) => {
      const td = document.createElement('td');
      if (col.className) {
        col.className.split(/\s+/).filter(Boolean).forEach(cls => td.classList.add(cls));
      }

      if (idx === labelColIdx) {
        td.textContent = 'Grand Total';
      } else if (psfKeys.includes(col.key)) {
        const avg = totalWeight ? (psfWeightedTotals[col.key] / totalWeight) : 0;
        td.textContent = fmtUSD(avg);
      } else if (sumKeys.includes(col.key)) {
        td.textContent = fmtUSD(grandTotals[col.key]);
        td.classList.add('cell-dollar');
      } else if (col.key === 'month') {
        td.textContent = `${totalMonths} Months`;
      } else if (col.key === abatementColumn.key) {
        const html = abatementColumn.renderHTML({
          isAbated: hasAbated,
          abatedMonths: totalAbatedMonths
        });
        if (html) {
          td.innerHTML = html;
          if (totalAbatedMonths > 0) {
            const count = totalAbatedMonths;
            const label = `${count} month${count === 1 ? '' : 's'} abated`;
            td.setAttribute('aria-label', label);
          }
        } else {
          td.textContent = '';
        }
      } else {
        td.textContent = EM_DASH;
        td.classList.add('cell-muted');
      }

      grandRow.appendChild(td);
    });

    tbody.appendChild(grandRow);
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
  
    const perspective = activePerspective || 'landlord';
    const rows = buildMonthlyRows(data, perspective);
  
    if (!Array.isArray(rows) || rows.length === 0) {
      thead.innerHTML = '';
      tbody.innerHTML = '';
      return;
    }
  
    const schema = buildMonthlyColumns(data, perspective);
    const labelColIdx = Math.max(0, schema.findIndex(col => col.isLabel));
    renderTableHeader(schema, thead);
  
    tbody.innerHTML = '';
  
    const sumFns = schema.map(col => (typeof col.sum === 'function') ? col.sum : null);
    const grandTotals = new Array(schema.length).fill(0);
    let yearTotals = new Array(schema.length).fill(0);
  
    const appendDataRow = (row) => {
      const tr = document.createElement('tr');
      schema.forEach((col, idx) => {
        const td = document.createElement('td');
        const rendered = col.render(row);
        if (col.className) {
          col.className.split(/\s+/).filter(Boolean).forEach(cls => td.classList.add(cls));
        }
        td.textContent = rendered;
        tr.appendChild(td);
        if (sumFns[idx]) {
          const val = Number(sumFns[idx](row) || 0);
          grandTotals[idx] += val;
          yearTotals[idx] += val;
        }
      });
      tbody.appendChild(tr);
    };
  
    const flushSubtotal = (year) => {
      if (year == null) return;
      const tr = document.createElement('tr');
      tr.classList.add('subtotal-row', 'row-subtotal');
      schema.forEach((col, idx) => {
        const td = document.createElement('td');
        if (col.className) {
          col.className.split(/\s+/).filter(Boolean).forEach(cls => td.classList.add(cls));
        }
        if (idx === labelColIdx) {
          td.setAttribute('aria-label', `Subtotal for ${year}`);
          td.innerHTML = `<span class="year-chip" aria-hidden="true">${year}</span><span class="subtotal-text">Subtotal ${year}</span>`;
        } else if (sumFns[idx]) {
          td.textContent = fmtUSD(yearTotals[idx]);
          td.classList.add('cell-dollar');
        } else {
          td.textContent = EM_DASH;
          td.classList.add('cell-muted');
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
      yearTotals = new Array(schema.length).fill(0);
    };
  
    let currentYear = rows[0]?.year ?? null;
  
    rows.forEach(row => {
      if (currentYear !== null && row.year !== currentYear) {
        flushSubtotal(currentYear);
        currentYear = row.year;
      }
      appendDataRow(row);
    });
  
    flushSubtotal(currentYear);
  
    const grandRow = document.createElement('tr');
    grandRow.classList.add('grand-total', 'row-grandtotal');
    schema.forEach((col, idx) => {
      const td = document.createElement('td');
      if (col.className) {
        col.className.split(/\s+/).filter(Boolean).forEach(cls => td.classList.add(cls));
      }
      if (idx === labelColIdx) {
        td.textContent = 'Grand Total';
      } else if (sumFns[idx]) {
        td.textContent = fmtUSD(grandTotals[idx]);
        td.classList.add('cell-dollar');
      } else {
        td.textContent = EM_DASH;
        td.classList.add('cell-muted');
      }
      grandRow.appendChild(td);
    });
    tbody.appendChild(grandRow);
  }
  
    // ------------------------------- Exports buttons (optional) -----------------
    document.getElementById('exportPdf')?.addEventListener('click', () => window.ExportPDF?.openDialog());
    document.getElementById('exportExcel')?.addEventListener('click', () => window.ExportExcel?.downloadExcel());
  
    window.includeOpExInGross = includeOpExInGross;
    window.buildTenantSchedule = buildTenantSchedule;
    window.buildLandlordSchedule = buildLandlordSchedule;
    window.buildYearlyAbatementRows = buildYearlyAbatementRows;
    window.summarizeGrossByPerspective = summarizeGrossByPerspective;
    window.renderScheduleTable = renderScheduleTable;

    (function initLeaseComparisonVisibility() {
      if (window.__leaseComparisonVisibilityInit) return;
      window.__leaseComparisonVisibilityInit = true;

      const els = {
        btnSummary: document.getElementById('btnComparisonSummary'),
        btnCash: document.getElementById('btnCashFlowComparison'),
        panelSummary: document.getElementById('comparisonSummary'),
        panelCash: document.getElementById('cashFlowComparison'),
        hiddenRowsWrap: document.getElementById('hiddenRowsToggleWrap'),
        cashGrid: document.getElementById('compareGrid')
      };

      if (!els.btnSummary || !els.btnCash || !els.panelSummary || !els.panelCash) {
        console.warn('[LeaseComparison] Missing comparison toggle elements.');
        return;
      }

      if (els.panelCash && els.cashGrid && !els.panelCash.contains(els.cashGrid)) {
        console.info('[LeaseComparison] Root cause: #compareGrid was mounted outside #cashFlowComparison, so summary view still exposed the cash-flow table. Relocating grid into the cash panel.');
        const anchor = els.panelCash.querySelector('.cf-compare');
        if (anchor && anchor.parentNode === els.panelCash) {
          els.panelCash.insertBefore(els.cashGrid, anchor);
        } else {
          els.panelCash.appendChild(els.cashGrid);
        }
      }

      function renderSummaryIfNeeded() {
        if (typeof window.renderComparisonSummary === 'function') {
          const toggle = document.getElementById('toggleHiddenRows');
          window.renderComparisonSummary({ showHidden: !!toggle?.checked });
        }
      }

      function setActive(which) {
        const isSummary = which === 'summary';
        if (els.btnSummary) {
          els.btnSummary.classList.toggle('active', isSummary);
          els.btnSummary.setAttribute('aria-pressed', String(isSummary));
          els.btnSummary.setAttribute('aria-selected', String(isSummary));
        }
        if (els.btnCash) {
          els.btnCash.classList.toggle('active', !isSummary);
          els.btnCash.setAttribute('aria-pressed', String(!isSummary));
          els.btnCash.setAttribute('aria-selected', String(!isSummary));
        }
      }

      window.updateLeaseComparisonView = function (mode) {
        const isSummary = mode === 'summary';
        els.panelSummary?.classList.toggle('hidden', !isSummary);
        els.panelCash?.classList.toggle('hidden', isSummary);
        if (els.hiddenRowsWrap) {
          if (isSummary) els.hiddenRowsWrap.classList.add('hidden');
          else els.hiddenRowsWrap.classList.remove('hidden');
        }
        if (els.cashGrid && !els.panelCash?.contains(els.cashGrid)) {
          els.cashGrid.classList.toggle('hidden', isSummary);
        }
        setActive(mode);
        if (isSummary) {
          renderSummaryIfNeeded();
        }
      };

      els.btnSummary?.addEventListener('click', () => window.updateLeaseComparisonView('summary'));
      els.btnCash?.addEventListener('click', () => window.updateLeaseComparisonView('cash'));

      window.updateLeaseComparisonView('summary');
    })();

    if (devGuardsEnabled) {
      setTimeout(() => {
        const seenIds = new Set();
        document.querySelectorAll('[id]').forEach(el => {
          const id = el.id;
          if (!id) return;
          if (seenIds.has(id)) {
            console.warn(`[ExactGuard] Duplicate id detected: #${id}`);
          } else {
            seenIds.add(id);
          }
        });
      }, 0);
    }
  })();
