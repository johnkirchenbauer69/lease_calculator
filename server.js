// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import streamProposalPdf from './ner-calculator/pdf/api-pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const staticDir  = path.join(__dirname, 'ner-calculator');

const app = express();

// Allow big images/charts in the payload
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ---- API ROUTES (must come BEFORE static/catch-all) ----
app.post('/api/pdf', (req, res) => streamProposalPdf(req, res));

app.get('/api/pdf/health', async (_req, res) => {
  try {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setContent('<h1>PDF OK</h1>', { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    await browser.close();
    res.status(200).type('application/pdf').send(Buffer.from(pdf));
  } catch (e) {
    console.error('[pdf/health] error:', e);
    res.status(500).type('text/plain').send(String(e?.stack || e));
  }
});

// ---- STATIC ASSETS ----
app.use('/ner-calculator', express.static(staticDir));
app.use('/',              express.static(staticDir));

// ---- SPA CATCH-ALL (GET only) ----
app.get(['/', '/index.html', '*'], (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Render health check
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on :${port}`));
