const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

// Map of known KPI fields (for formatting fallbacks / labels)
const KPI_FIELD_MAP = {
  termMonths: { label: 'Term (months)', format: 'number' },
  freeMonths: { label: 'Free Months', format: 'number' },
  startNetAnnualPSF: { label: 'Start Net Rent ($/SF/yr)', format: 'number' },
  escalationPct: { label: 'Escalation', format: 'percent' },
  totalBaseRentNominal: { label: 'Total Base Rent', format: 'currency' },
  totalNetRent: { label: 'Total Net Rent', format: 'currency' },
  totalGrossRent: { label: 'Total Gross Rent', format: 'currency' },
  totalRecoveries: { label: 'Total Recoveries', format: 'currency' },
  totalOpex: { label: 'Total Operating Expenses', format: 'currency' },
  avgMonthlyNet: { label: 'Average Monthly Net Rent', format: 'currency' },
  avgMonthlyGross: { label: 'Average Monthly Gross Rent', format: 'currency' },
  avgMonthlySpread: { label: 'Gross–Net Spread', format: 'currency' },
  freeGrossPV: { label: 'Free Rent (PV)', format: 'currency' },
  freeGrossNominal: { label: 'Free Rent (Nominal)', format: 'currency' },
  pctAbated: { label: 'Percent of Term Abated', format: 'percent' },
  recoveryRatio: { label: 'Recovery Ratio', format: 'percent' },
  commissionPV: { label: 'Commission (PV)', format: 'currency' },
  commissionNominal: { label: 'Commission (Nominal)', format: 'currency' },
  commissionTotal: { label: 'Total Commission', format: 'currency' },
  llCashOutPV: { label: 'LL Cash Outlay (PV)', format: 'currency' },
  tiAppliedPV: { label: 'TI Applied (PV)', format: 'currency' },
  tiOfferPV: { label: 'TI Offer (PV)', format: 'currency' },
  llAllowanceApplied: { label: 'LL Allowance Applied', format: 'currency' },
  llAllowanceOffered: { label: 'LL Allowance Offered', format: 'currency' },
  tiAmortPmt: { label: 'TI Amortization Payment', format: 'currency' },
  tenantContribution: { label: 'Tenant Contribution', format: 'currency' },
  totalIncentivePV: { label: 'Total Incentive Value (PV)', format: 'currency' },
  llFreeTIY0: { label: 'LL Free TI (Y0)', format: 'currency' },
  llFinancedTIY0: { label: 'LL Financed TI (Y0)', format: 'currency' },
  totalCapex: { label: 'Total CapEx', format: 'currency' },
  netTenantCashAtPos: { label: 'Net Tenant Cash at Possession', format: 'currency' },
  nerPV: { label: 'NER (PV)', format: 'currency' },
  nerNonPV: { label: 'NER (non-PV)', format: 'currency' },
  firstMonthRent: { label: 'First Month Rent', format: 'currency' },
  lastMonthRent: { label: 'Last Month Rent', format: 'currency' },
  peakMonthly: { label: 'Peak Monthly Rent', format: 'currency' },
  opexStartPSF: { label: 'OpEx Start ($/SF/yr)', format: 'number' },
  opexEscalationPct: { label: 'OpEx Escalation', format: 'percent' },
  occPSFmo: { label: 'All-in Occupancy ($/SF/mo)', format: 'number' },
};

// === #3: lock the KPI rows & order here ===
const KPI_SPEC = [
  ['termMonths',          'Term (months)',                 'number'],
  ['freeMonths',          'Free Months',                   'number'],
  ['totalGrossRent',      'Total Gross Rent',              'currency'],
  ['totalOpex',           'Total Operating Expenses',      'currency'],
  ['avgMonthlyGross',     'Average Monthly Gross Rent',    'currency'],
  ['nerPV',               'NER (PV)',                      'currency'],
  ['occPSFmo',            'All-in Occupancy ($/SF/mo)',    'number'],
];

function chunk(arr = [], size = 4) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatValue(value, format) {
  if (value == null) return '—';
  switch (format) {
    case 'currency': return currencyFormatter.format(value);
    case 'percent':  return percentFormatter.format(value);
    case 'number':   return numberFormatter.format(value);
    default:
      return typeof value === 'number' ? numberFormatter.format(value) : String(value);
  }
}

function humanizeKey(key = '') {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/^\w|\s\w/g, (txt) => txt.toUpperCase());
}

function kpisFromSpec(scenario) {
  const get = (k) => (
    scenario?.kpis?.topline?.[k] ??
    scenario?.kpis?.[k] ??
    scenario?.[k]
  );
  return KPI_SPEC.map(([key, label, fmt]) => ({
    label,
    value: get(key),
    format: fmt || KPI_FIELD_MAP[key]?.format
  }));
}

// Keep dynamic extras if provided, but always render the spec first.
function normalizeScenarioKpis(scenario) {
  // If user provided an array already, respect it as-is.
  if (Array.isArray(scenario?.kpis)) return scenario.kpis;

  const specRows = kpisFromSpec(scenario);

  // Collect any extra topline keys that are not in KPI_SPEC, append them afterward.
  const raw = scenario?.kpis;
  const extras = [];
  if (raw && typeof raw === 'object') {
    const topline = raw.topline && typeof raw.topline === 'object' && !Array.isArray(raw.topline)
      ? raw.topline
      : raw;
    if (topline && typeof topline === 'object' && !Array.isArray(topline)) {
      const specKeys = new Set(KPI_SPEC.map(([k]) => k));
      for (const [key, value] of Object.entries(topline)) {
        if (specKeys.has(key)) continue;
        if (value == null || value === '') continue;
        const meta = KPI_FIELD_MAP[key] || {};
        extras.push({
          label: meta.label || humanizeKey(key),
          value,
          format: meta.format || (typeof value === 'number' ? 'number' : undefined),
        });
      }
    }
  }

  // Optional chips under scenario.kpis.summaryChips
  const chips = Array.isArray(raw?.summaryChips)
    ? raw.summaryChips.filter(Boolean).map((c) => ({ label: String(c), value: '', format: 'text' }))
    : [];

  return [...specRows, ...extras, ...chips];
}

function renderScenarioCard(scenario, index) {
  const {
    title = `Scenario ${index + 1}`,
    subtitle = '',
    summary = '',
  } = scenario ?? {};

  const kpis = normalizeScenarioKpis(scenario);
  const kpiRows = kpis.map(({ label, value, format }) => `
    <div class="kpi-row">
      <span class="label">${label ?? ''}</span>
      <span class="value">${formatValue(value, format)}</span>
    </div>
  `).join('');

  return `
    <article class="scenario-card">
      <header>
        <div class="pill">Scenario ${index + 1}</div>
        <h3>${title}</h3>
        ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}
      </header>
      ${summary ? `<p class="summary">${summary}</p>` : ''}
      <div class="kpi-grid">${kpiRows}</div>
    </article>
  `;
}

function renderChartBlock(chart) {
  if (!chart) return '';
  const { title = '', subtitle = '', image, description = '' } = chart;
  if (!image) return '';
  return `
    <figure class="chart">
      <img src="${image}" alt="${title}" />
      <figcaption>
        <strong>${title}</strong>
        ${subtitle ? `<span class="subtitle">${subtitle}</span>` : ''}
        ${description ? `<span class="description">${description}</span>` : ''}
      </figcaption>
    </figure>
  `;
}

function renderRentScheduleRows(schedule = []) {
  return schedule.map((row, idx) => {
    const period = row.period ?? `Year ${idx + 1}`;
    const rent   = formatValue(row.rent, 'currency');
    const opex   = row.opex  != null ? formatValue(row.opex,  'currency') : '—';
    const total  = row.total != null ? formatValue(row.total, 'currency') : '—';
    const note   = row.note ?? '';
    return `
      <tr>
        <td>${period}</td>
        <td>${rent}</td>
        <td>${opex}</td>
        <td>${total}</td>
        <td>${note}</td>
      </tr>
    `;
  }).join('');
}

export default function renderProposalTemplate({ deal, scenarios = [], charts = [], branding = {} }) {
  const normalizedBranding = { ...branding };
  if (normalizedBranding.logo && normalizedBranding.logoUrl == null) {
    normalizedBranding.logoUrl = normalizedBranding.logo;
  }
  if (normalizedBranding.secondary && normalizedBranding.accent == null) {
    normalizedBranding.accent = normalizedBranding.secondary;
  }

  const {
    title = 'Lease Proposal',
    subtitle = '',
    propertyName = '',
    propertyAddress = '',
    preparedFor = '',
    preparedBy = '',
    preparedDate,
    rentSchedule = [],
    highlights = [],
    assumptions = [],
  } = deal || {};

  const primary  = normalizedBranding.primary  ?? '#1434ef';
  const accent   = normalizedBranding.accent   ?? '#f9a13a';
  const logoUrl  = normalizedBranding.logoUrl  ?? '';
  const footerNote = normalizedBranding.footerNote ?? '';

  const headlineDate = preparedDate
    ? new Date(preparedDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  // Build sections
  const scenarioCards   = scenarios.slice(0, 3).map(renderScenarioCard).join('');
  const normalizedCharts = Array.isArray(charts)
    ? charts
    : charts && typeof charts === 'object'
      ? Object.entries(charts).map(([chartTitle, chartValue]) => (
          chartValue && typeof chartValue === 'object'
            ? { title: chartTitle, ...chartValue }
            : { title: chartTitle, image: chartValue }
        ))
      : [];
  const chartGroups   = chunk(normalizedCharts, 4);
  const rentRows      = renderRentScheduleRows(rentSchedule);
  const highlightList = highlights.map((item) => `<li>${item}</li>`).join('');

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      @page { size: Letter; margin: 0; }
      @media print { html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact} }

      *, *::before, *::after { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: 'Inter','Helvetica Neue',Arial,sans-serif;
        color: #1f2937;
        background-color: #f8f9fb;
      }

      /* Page wrapper: one logical page per section */
      .page {
        width: 100%;
        min-height: 100vh;
        padding: 0.65in 0.5in 0.75in;
        display: flex;
        flex-direction: column;
        gap: 24px;
        break-after: page;
        page-break-after: always;
      }

      /* Brand variables */
      :root{ --primary:${primary}; --accent:${accent}; --ink:#111827; --muted:#6b7280; --panel:#fff; }

      .brand-bar {
        display: flex; align-items: center; justify-content: space-between;
        background: var(--primary); color: #fff; padding: 12px 20px;
        border-radius: 18px; box-shadow: 0 8px 24px rgba(17,24,39,.18);
      }
      .brand-bar .title { font-size: 20px; font-weight: 600; margin: 0; }
      .brand-bar .meta { font-size: 12px; opacity: .85; }
      .brand-bar img { height: 40px; max-width: 180px; object-fit: contain; }

      header.hero {
        display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px;
        background: #fff; border-radius: 20px; padding: 28px;
        box-shadow: 0 14px 40px rgba(15,23,42,.1);
      }
      .hero h1 { margin: 0 0 12px; font-size: 28px; color: #111827; }
      .hero p.subtitle { margin: 0 0 16px; color: #4b5563; }
      .hero .details { display: grid; gap: 6px; font-size: 13px; color: #6b7280; }
      .hero .highlights { background: rgba(20,52,239,.06); border-left: 3px solid var(--accent);
        padding: 16px; border-radius: 14px; }
      .hero .highlights h2 { margin: 0 0 10px; font-size: 14px; letter-spacing: .04em;
        text-transform: uppercase; color: #374151; }
      .hero .highlights ul { margin: 0; padding-left: 18px; color: #374151; font-size: 13px; display: grid; gap: 6px; }

      .summary .scenario-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; }
      .scenario-card { background:#fff; border-radius:18px; padding:20px;
        box-shadow:0 10px 32px rgba(15,23,42,.08); display:flex; flex-direction:column; gap:16px; }
      .scenario-card header { display:flex; flex-direction:column; gap:6px; }
      .scenario-card h3 { margin:0; font-size:16px; color:#111827; }
      .scenario-card .subtitle { margin:0; color:#6b7280; font-size:12px; }
      .scenario-card .summary { margin:0; color:#4b5563; font-size:13px; line-height:1.45; }
      .pill { display:inline-flex; align-self:flex-start; padding:4px 10px; border-radius:999px;
        background:var(--accent); color:#111827; font-weight:600; font-size:11px; letter-spacing:.04em; text-transform:uppercase; }
      .kpi-grid { display:grid; gap:8px; }
      .kpi-row { display:flex; justify-content:space-between; font-size:12px; color:#111827; }
      .kpi-row .label { font-weight:600; }
      .kpi-row .value { font-variant-numeric: tabular-nums; }

      /* Charts: 2x2 per page */
      .chart-grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
      .chart { background:#fff; border-radius:18px; padding:18px; box-shadow:0 12px 36px rgba(15,23,42,.08);
        display:flex; flex-direction:column; gap:12px; }
      .chart img { width:100%; height:auto; border-radius:12px; background:#f3f4f6; }
      .chart figcaption { font-size:12px; color:#4b5563; display:flex; flex-direction:column; gap:4px; }
      .chart figcaption strong { color:#111827; font-size:13px; }

      /* Rent schedule with repeating header & no split rows */
      table.rent-schedule { width:100%; border-collapse:collapse; background:#fff; border-radius:16px;
        overflow:hidden; box-shadow:0 10px 32px rgba(15,23,42,.06); }
      table.rent-schedule thead { background: var(--primary); color:#fff; text-transform:uppercase;
        letter-spacing:.04em; font-size:11px; display: table-header-group; }
      table.rent-schedule th, table.rent-schedule td { padding:12px 14px; font-size:12px; text-align:left; }
      table.rent-schedule tbody tr:nth-child(even){ background:#f9fafb; }
      table.rent-schedule tr { break-inside: avoid; page-break-inside: avoid; }
      table.rent-schedule td:last-child { width:30%; }

      footer.page-footer { margin-top:auto; padding-top:16px; border-top:1px solid rgba(15,23,42,.08);
        display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#6b7280; }
      footer.page-footer .right { display:flex; align-items:center; gap:8px; color:#4b5563; }
      footer.page-footer .dot { width:6px; height:6px; border-radius:999px; background:var(--accent); }
    </style>
  </head>
  <body>

    <!-- 1) COVER -->
    <section class="page cover">
      <div class="brand-bar">
        <div>
          <p class="title">${propertyName || title}</p>
          <p class="meta">${propertyAddress}</p>
        </div>
        ${logoUrl ? `<img src="${logoUrl}" alt="${propertyName} logo" />` : ''}
      </div>

      <header class="hero">
        <div>
          <h1>${title}</h1>
          ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}
          <div class="details">
            ${preparedFor ? `<span><strong>Prepared for:</strong> ${preparedFor}</span>` : ''}
            ${preparedBy ? `<span><strong>Prepared by:</strong> ${preparedBy}</span>` : ''}
            ${headlineDate ? `<span><strong>Date:</strong> ${headlineDate}</span>` : ''}
          </div>
        </div>
        <div class="highlights">
          <h2>Key Highlights</h2>
          <ul>${highlightList}</ul>
        </div>
      </header>
    </section>

    <!-- 2) EXEC SUMMARY -->
    <section class="page summary">
      <h2 style="font-size:14px; letter-spacing:.08em; text-transform:uppercase; color:#6b7280; margin:0 0 12px;">
        Scenario Overview
      </h2>
      <div class="scenario-grid">${scenarioCards}</div>
    </section>

    <!-- 3+) CHART PAGES (2x2 per page) -->
    ${chartGroups.map((group, i) => `
      <section class="page charts">
        <h2 style="font-size:14px; letter-spacing:.08em; text-transform:uppercase; color:#6b7280; margin:0 0 12px;">
          KPI Visuals${chartGroups.length > 1 ? ` — ${i + 1}` : ''}
        </h2>
        <div class="chart-grid">
          ${group.map(renderChartBlock).join('')}
        </div>
      </section>
    `).join('')}

    <!-- RENT SCHEDULE (auto-paginates, header repeats) -->
    <section class="page schedule">
      <h2 style="font-size:14px; letter-spacing:.08em; text-transform:uppercase; color:#6b7280; margin:0 0 12px;">
        Rent Schedule
      </h2>
      <table class="rent-schedule">
        <thead>
          <tr>
            <th>Period</th>
            <th>Base Rent</th>
            <th>OpEx</th>
            <th>Total</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>${rentRows}</tbody>
      </table>
    </section>

    ${Array.isArray(assumptions) && assumptions.length ? `
      <section class="page assumptions">
        <h2 style="font-size:14px; letter-spacing:.08em; text-transform:uppercase; color:#6b7280; margin:0 0 12px;">
          Assumptions & Notes
        </h2>
        <ul>${assumptions.map(a => `<li>${a}</li>`).join('')}</ul>
      </section>
    ` : ''}

    <!-- footer content (page numbers handled by Playwright header/footer) -->
    <section class="page">
      <footer class="page-footer">
        <span>${footerNote}</span>
        <div class="right"><span class="dot"></span><span>${propertyName || preparedBy}</span></div>
      </footer>
    </section>

  </body>
</html>
  `;
}
