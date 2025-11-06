const BUTTON_ID = 'exportPdfPro';
const STORAGE_KEY = 'ner_scenarios_v2';
const CHART_IDS = [
  'cfChart',
  'pvWaterfallChart',
  'psfTrendChart',
  'tornadoChart',
  'abatementChart'
];

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const num = toFiniteNumber(value);
    if (num != null) return num;
  }
  return null;
}

function countTermMonths(schedule) {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  const termMonths = schedule.reduce((count, row) => (row && row.isTermMonth ? count + 1 : count), 0);
  if (termMonths > 0) return termMonths;
  return schedule.length;
}

function collectChips(source) {
  if (!source) return [];
  const raw = source.summaryChips;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((chip) => (typeof chip === 'string' ? chip.trim() : ''))
    .filter((chip) => chip.length > 0);
}

function deriveScenarioCard(snapshot, index) {
  const model = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const kpiSource = model.kpis && !Array.isArray(model.kpis) && typeof model.kpis === 'object' ? model.kpis : {};
  const topline = kpiSource.topline && typeof kpiSource.topline === 'object' ? kpiSource.topline : {};
  const toplineAlt = model.toplineKpis && typeof model.toplineKpis === 'object' ? model.toplineKpis : {};

  const chipSet = new Set([
    ...collectChips(kpiSource),
    ...collectChips(model),
  ]);
  const subtitle = chipSet.size ? Array.from(chipSet).join(' • ') : '';

  const summary = typeof model.summary === 'string' && model.summary.trim()
    ? model.summary.trim()
    : (typeof kpiSource.summary === 'string' && kpiSource.summary.trim() ? kpiSource.summary.trim() : '');

  const titleCandidates = [
    model.title,
    kpiSource.title,
    model.name,
    model.propertyName,
    model.propertyLabel,
    model.address,
    model.propertyAddress,
  ];
  let title = titleCandidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  if (title) {
    title = title.trim();
  } else {
    title = `Scenario ${index + 1}`;
  }

  const scheduleTerm = countTermMonths(model.schedule);

  const candidateKpis = [
    {
      label: 'Term (months)',
      format: 'number',
      value: firstFiniteNumber(
        kpiSource.termMonths,
        topline.termMonths,
        toplineAlt.termMonths,
        model.termMonths,
        scheduleTerm,
      ),
    },
    {
      label: 'Free Rent (months)',
      format: 'number',
      value: firstFiniteNumber(kpiSource.freeMonths, model.freeMonths),
    },
    {
      label: 'Avg Monthly Net',
      format: 'currency',
      value: firstFiniteNumber(
        topline.avgMonthlyNet,
        toplineAlt.avgMonthlyNet,
        kpiSource.avgMonthlyNet,
        model.avgNetMonthly,
      ),
    },
    {
      label: 'Avg Monthly Gross',
      format: 'currency',
      value: firstFiniteNumber(
        topline.avgMonthlyGross,
        toplineAlt.avgMonthlyGross,
        kpiSource.avgMonthlyGross,
        model.avgGrossMonthly,
      ),
    },
    {
      label: 'Total Net Rent',
      format: 'currency',
      value: firstFiniteNumber(
        topline.totalNetRent,
        toplineAlt.totalNetRent,
        kpiSource.totalNetRent,
        model.totalPaidNet,
      ),
    },
    {
      label: 'Total Gross Rent',
      format: 'currency',
      value: firstFiniteNumber(
        topline.totalGrossRent,
        toplineAlt.totalGrossRent,
        kpiSource.totalGrossRent,
        model.totalPaidGross,
      ),
    },
    {
      label: 'NER (PV)',
      format: 'currency',
      value: firstFiniteNumber(kpiSource.nerPV, model.nerPV),
    },
    {
      label: 'NER (non-PV)',
      format: 'currency',
      value: firstFiniteNumber(kpiSource.nerNonPV, model.simpleNet),
    },
    {
      label: 'Free Rent Value',
      format: 'currency',
      value: firstFiniteNumber(kpiSource.freeRentValueNominal, kpiSource.freeGrossNominal),
    },
    {
      label: 'TI Allowance',
      format: 'currency',
      value: firstFiniteNumber(kpiSource.tiAllowanceTotal, model.tiAllowanceTotal),
    },
    {
      label: 'Pct of Term Abated',
      format: 'percent',
      value: firstFiniteNumber(kpiSource.pctAbated),
    },
  ];

  const kpis = candidateKpis
    .filter((item) => item.value != null)
    .map(({ label, value, format }) => ({ label, value, format }))
    .slice(0, 6);

  return {
    title,
    subtitle,
    summary,
    kpis,
  };
}

function normalizeScenarioForPdf(snapshot, index) {
  const model = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const hasArrayKpis = Array.isArray(model.kpis);
  const derived = deriveScenarioCard(model, index);

  if (!hasArrayKpis) {
    return derived;
  }

  const cleanedKpis = model.kpis
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const label = entry.label != null ? String(entry.label) : '';
      return {
        label,
        value: entry.value,
        format: entry.format,
      };
    })
    .filter(Boolean);

  const title = typeof model.title === 'string' && model.title.trim()
    ? model.title.trim()
    : derived.title;
  const subtitle = typeof model.subtitle === 'string' && model.subtitle.trim()
    ? model.subtitle.trim()
    : derived.subtitle;
  const summary = typeof model.summary === 'string' && model.summary.trim()
    ? model.summary.trim()
    : derived.summary;

  return {
    title,
    subtitle,
    summary,
    kpis: cleanedKpis.length ? cleanedKpis : derived.kpis,
  };
}

function onReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

function ensureModel() {
  const model = window.__ner_last;
  if (model && model.schedule?.length) return model;

  const form = document.getElementById('ner-form');
  if (form) {
    const evt = new Event('submit', { cancelable: true });
    form.dispatchEvent(evt);
  }
  return window.__ner_last || null;
}

function readScenarios() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean).slice(0, 3);
  } catch (err) {
    console.warn('Unable to parse stored scenarios', err);
    return [];
  }
}

function captureCharts() {
  const out = [];
  for (const id of CHART_IDS) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof canvas.toDataURL !== 'function') continue;
    try {
      out.push({
        title: id,
        image: canvas.toDataURL('image/png', 1.0)
      });
    } catch (err) {
      console.warn(`Unable to capture chart: ${id}`, err);
    }
  }
  return out;
}

function collectBranding() {
  const logo = document.querySelector('.brand .logo');
  const footer = document.querySelector('.site-footer');

  let primary = '';
  let accent = '';

  try {
    const rootStyles = window.getComputedStyle(document.documentElement);
    primary = rootStyles.getPropertyValue('--lee-red')?.trim() || '';
    if (!primary) {
      primary = rootStyles.getPropertyValue('--accent')?.trim() || '';
    }

    accent = rootStyles.getPropertyValue('--accent-2')?.trim() || '';
    if (!accent) {
      accent = rootStyles.getPropertyValue('--accent')?.trim() || '';
    }
  } catch (err) {
    console.warn('Unable to read branding colors', err);
  }

  const footerNote = footer?.textContent?.replace(/\s+/g, ' ')?.trim() || '';

  return {
    logoUrl: logo?.src || '',
    primary,
    accent,
    footerNote
  };
}

async function exportPdf() {
  const btn = document.getElementById(BUTTON_ID);
  const activeText = btn?.textContent;
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Preparing…';
    }

    const deal = ensureModel();
    if (!deal) {
      alert('Please run Calculate before exporting.');
      return;
    }

    const rawScenarios = readScenarios();
    const scenarios = rawScenarios.map((scenario, index) => normalizeScenarioForPdf(scenario, index));

    const payload = {
      deal,
      scenarios,
      charts: captureCharts(),
      branding: collectBranding()
    };

    const response = await fetch('/api/pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Export failed (${response.status})`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'Lease_Proposal_Comparison.pdf';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Failed to export client PDF', err);
    alert('Unable to export PDF. Please try again.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = activeText || 'Export Client PDF';
    }
  }
}

onReady(() => {
  const btn = document.getElementById(BUTTON_ID);
  if (!btn) return;
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    exportPdf();
  });
});

