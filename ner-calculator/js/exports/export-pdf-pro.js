const BUTTON_ID = 'exportPdfPro';
const STORAGE_KEY = 'ner_scenarios_v2';
const CHART_IDS = [
  'cfChart',
  'pvWaterfallChart',
  'psfTrendChart',
  'tornadoChart',
  'abatementChart'
];

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
  const brandTop = document.querySelector('.brand-text .brand-top');
  const brandBottom = document.querySelector('.brand-text .brand-bottom');
  return {
    logo: logo?.src || '',
    primary: brandTop?.textContent?.trim() || '',
    secondary: brandBottom?.textContent?.trim() || ''
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

    const payload = {
      deal,
      scenarios: readScenarios(),
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

