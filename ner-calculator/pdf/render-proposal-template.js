const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function formatValue(value, format) {
  if (value == null) return '—';
  switch (format) {
    case 'currency':
      return currencyFormatter.format(value);
    case 'percent':
      return percentFormatter.format(value);
    case 'number':
      return numberFormatter.format(value);
    default:
      if (typeof value === 'number') {
        return numberFormatter.format(value);
      }
      return String(value);
  }
}

function renderScenarioCard(scenario, index) {
  const {
    title = `Scenario ${index + 1}`,
    subtitle = '',
    summary = '',
    kpis = [],
  } = scenario ?? {};

  const kpiRows = kpis.map((kpi) => {
    const { label, value, format } = kpi;
    return `<div class="kpi-row"><span class="label">${label ?? ''}</span><span class="value">${formatValue(value, format)}</span></div>`;
  }).join('');

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

function buildRentSummaryFromSchedule(schedule = []) {
  if (!Array.isArray(schedule) || schedule.length === 0) return [];

  const summary = [];
  const buckets = new Map();

  schedule.forEach((row, idx) => {
    if (!row || typeof row !== 'object') return;

    const baseRent = Number(row.netTotal) || 0;
    const total = Number(row.grossTotal) || 0;
    const opex = total - baseRent;

    const monthIndex = Number(row.monthIndex) || idx + 1;
    const yearIndex = Math.floor((monthIndex - 1) / 12);
    const key = row.calYear ?? yearIndex;
    let bucket = buckets.get(key);
    if (!bucket) {
      const periodLabel = row.calYear != null ? String(row.calYear) : `Year ${yearIndex + 1}`;
      bucket = { period: periodLabel, rent: 0, opex: 0, total: 0 };
      buckets.set(key, bucket);
      summary.push(bucket);
    }

    bucket.rent += baseRent;
    bucket.opex += opex;
    bucket.total += total;
  });

  return summary.map(({ period, rent, opex, total }) => ({
    period,
    rent,
    opex,
    total,
    note: '',
  }));
}

function renderRentScheduleRows(schedule = []) {
  return schedule.map((row, idx) => {
    const period = row.period ?? `Year ${idx + 1}`;
    const rent = formatValue(row.rent, 'currency');
    const opex = row.opex != null ? formatValue(row.opex, 'currency') : '—';
    const total = row.total != null ? formatValue(row.total, 'currency') : '—';
    const note = row.note ?? '';
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

export default function renderProposalTemplate({ deal = {}, scenarios = [], charts = [], branding = {} }) {
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
    schedule = [],
    highlights = [],
  } = deal;

  const primary = normalizedBranding.primary ?? '#1434ef';
  const accent = normalizedBranding.accent ?? '#f9a13a';
  const logoUrl = normalizedBranding.logoUrl ?? '';
  const footerNote = normalizedBranding.footerNote ?? '';

  const headlineDate = preparedDate
    ? new Date(preparedDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  const scenarioCards = scenarios.slice(0, 3).map(renderScenarioCard).join('');
  const chartBlocks = charts.map(renderChartBlock).join('');
  const printableSchedule = Array.isArray(rentSchedule) && rentSchedule.length
    ? rentSchedule
    : buildRentSummaryFromSchedule(schedule);

  const rentRows = renderRentScheduleRows(printableSchedule);
  const highlightList = highlights.map((item) => `<li>${item}</li>`).join('');

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      @page {
        size: Letter;
        margin: 0;
      }
      *, *::before, *::after {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
        color: #1f2937;
        background-color: #f8f9fb;
      }
      .page {
        width: 100%;
        min-height: 100vh;
        padding: 0.65in 0.5in 0.75in;
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
      .brand-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: ${primary};
        color: #fff;
        padding: 12px 20px;
        border-radius: 18px;
        box-shadow: 0 8px 24px rgba(17, 24, 39, 0.18);
      }
      .brand-bar .title {
        font-size: 20px;
        font-weight: 600;
        margin: 0;
      }
      .brand-bar .meta {
        font-size: 12px;
        opacity: 0.85;
      }
      .brand-bar img {
        height: 40px;
        max-width: 180px;
        object-fit: contain;
      }
      header.hero {
        display: grid;
        grid-template-columns: 1.4fr 1fr;
        gap: 24px;
        background: #fff;
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 14px 40px rgba(15, 23, 42, 0.1);
      }
      .hero h1 {
        margin: 0 0 12px;
        font-size: 28px;
        color: #111827;
      }
      .hero p.subtitle {
        margin: 0 0 16px;
        color: #4b5563;
      }
      .hero .details {
        display: grid;
        gap: 6px;
        font-size: 13px;
        color: #6b7280;
      }
      .hero .highlights {
        background: rgba(20, 52, 239, 0.06);
        border-left: 3px solid ${accent};
        padding: 16px;
        border-radius: 14px;
      }
      .hero .highlights h2 {
        margin: 0 0 10px;
        font-size: 14px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #374151;
      }
      .hero .highlights ul {
        margin: 0;
        padding-left: 18px;
        color: #374151;
        font-size: 13px;
        display: grid;
        gap: 6px;
      }
      .scenario-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
      }
      .scenario-card {
        background: #fff;
        border-radius: 18px;
        padding: 20px;
        box-shadow: 0 10px 32px rgba(15, 23, 42, 0.08);
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .scenario-card header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .scenario-card h3 {
        margin: 0;
        font-size: 16px;
        color: #111827;
      }
      .scenario-card .subtitle {
        margin: 0;
        color: #6b7280;
        font-size: 12px;
      }
      .scenario-card .summary {
        margin: 0;
        color: #4b5563;
        font-size: 13px;
        line-height: 1.45;
      }
      .scenario-card .pill {
        display: inline-flex;
        align-self: flex-start;
        padding: 4px 10px;
        border-radius: 999px;
        background: ${accent};
        color: #111827;
        font-weight: 600;
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .kpi-grid {
        display: grid;
        gap: 8px;
      }
      .kpi-row {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: #111827;
      }
      .kpi-row .label {
        font-weight: 600;
      }
      .kpi-row .value {
        font-variant-numeric: tabular-nums;
      }
      .charts {
        display: grid;
        gap: 18px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .chart {
        background: #fff;
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 12px 36px rgba(15, 23, 42, 0.08);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .chart img {
        width: 100%;
        height: auto;
        border-radius: 12px;
        background: #f3f4f6;
      }
      .chart figcaption {
        font-size: 12px;
        color: #4b5563;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .chart figcaption strong {
        color: #111827;
        font-size: 13px;
      }
      table.rent-schedule {
        width: 100%;
        border-collapse: collapse;
        background: #fff;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 10px 32px rgba(15, 23, 42, 0.06);
      }
      table.rent-schedule thead {
        background: ${primary};
        color: #fff;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 11px;
      }
      table.rent-schedule th,
      table.rent-schedule td {
        padding: 12px 14px;
        font-size: 12px;
        text-align: left;
      }
      table.rent-schedule tbody tr:nth-child(even) {
        background: #f9fafb;
      }
      table.rent-schedule td:last-child {
        width: 30%;
      }
      footer.page-footer {
        margin-top: auto;
        padding-top: 16px;
        border-top: 1px solid rgba(15, 23, 42, 0.08);
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 10px;
        color: #6b7280;
      }
      footer.page-footer .right {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #4b5563;
      }
      footer.page-footer .dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: ${accent};
      }
    </style>
  </head>
  <body>
    <div class="page">
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

      <section>
        <h2 style="font-size:14px; letter-spacing:0.08em; text-transform:uppercase; color:#6b7280; margin:0 0 12px;">Scenario Overview</h2>
        <div class="scenario-grid">${scenarioCards}</div>
      </section>

      <section>
        <h2 style="font-size:14px; letter-spacing:0.08em; text-transform:uppercase; color:#6b7280; margin:16px 0 12px;">KPI Visuals</h2>
        <div class="charts">${chartBlocks}</div>
      </section>

      <section>
        <h2 style="font-size:14px; letter-spacing:0.08em; text-transform:uppercase; color:#6b7280; margin:16px 0 12px;">Rent Schedule</h2>
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

      <footer class="page-footer">
        <span>${footerNote}</span>
        <div class="right">
          <span class="dot"></span>
          <span>${propertyName || preparedBy}</span>
        </div>
      </footer>
    </div>
  </body>
</html>
  `;
}
