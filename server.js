// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import streamProposalPdf from './ner-calculator/pdf/api-pdf.js';
import { chromium } from 'playwright'; // or from puppeteer-core variant below

app.get('/api/pdf/health', async (_req, res) => {
  try {
    const browser = await chromium.launch({
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setContent('<html><body><h1>PDF OK</h1></body></html>', { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    await browser.close();
    res.status(200).type('application/pdf').send(Buffer.from(pdf));
  } catch (e) {
    console.error('[pdf/health] error:', e);
    res.status(500).type('text/plain').send(String(e?.stack || e));
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const staticDir  = path.join(__dirname, 'ner-calculator');

const app = express();

// allow big JSON (photos + charts)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// health: prove Playwright can make any PDF
app.get('/api/pdf/health', async (_req, res) => {
  try {
    const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setContent('<h1>PDF OK</h1>');
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    await browser.close();
    res.type('application/pdf').send(Buffer.from(pdf));
  } catch (e) {
    console.error('[pdf/health] error:', e);
    res.status(500).type('text/plain').send(String(e?.stack || e));
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

