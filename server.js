// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import streamProposalPdf from './ner-calculator/pdf/api-pdf.js';
import { chromium } from 'playwright'; // for /api/pdf/health

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const staticDir  = path.join(__dirname, 'ner-calculator');

const app = express();

// Increase body limits for photos/charts; accept JSON & form bodies
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// PDF endpoint with robust error logging
app.post('/api/pdf', async (req, res) => {
  const size = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
  console.log(`[pdf] payload ~${Math.round(size/1024)}KB, scenarios=${(req.body?.scenarios||[]).length}, charts=${Array.isArray(req.body?.charts) ? req.body.charts.length : Object.keys(req.body?.charts||{}).length}`);
  try {
    await streamProposalPdf(req, res); // will set headers & send PDF
  } catch (err) {
    console.error('[pdf] handler error:', err);
    res.status(500).type('text/plain').send(String(err?.stack || err));
  }
});

// Quick health route: proves Chromium can launch and print
app.get('/api/pdf/health', async (_req, res) => {
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent('<html><body><h1>PDF OK</h1></body></html>', { waitUntil: 'load' });
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    await browser.close();
    res.status(200).type('application/pdf').send(Buffer.from(pdf));
  } catch (err) {
    console.error('[pdf/health] error:', err);
    res.status(500).type('text/plain').send(String(err?.stack || err));
  }
});

// Serve app from both roots so absolute/relative paths work
app.use('/ner-calculator', express.static(staticDir));
app.use('/',              express.static(staticDir));

// SPA entry/fallback
app.get(['/', '/index.html', '*'], (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Healthz for Render
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on :${port}`));

