// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import streamProposalPdf from './ner-calculator/pdf/api-pdf.js';
import { chromium } from 'playwright'; // or from puppeteer-core variant below

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const staticDir  = path.join(__dirname, 'ner-calculator');

const app = express();

// allow big JSON (photos + charts)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const logPdfRequest = (handler) => (req, res, next) => {
  const { ip, method } = req;
  console.info(`[api/pdf] ${method} from ${ip ?? 'unknown'}`);
  return handler(req, res, next);
};

app.post('/api/pdf', logPdfRequest(streamProposalPdf));

async function playwrightHealthPdf() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setContent('<html><body><h1>PDF OK</h1></body></html>', { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    return Buffer.from(pdf);
  } finally {
    try {
      await browser.close();
    } catch (closeErr) {
      console.error('[pdf/health] browser close error:', closeErr);
    }
  }
}

app.get('/api/pdf/health', async (_req, res) => {
  try {
    const pdf = await playwrightHealthPdf();
    res.status(200).type('application/pdf').send(pdf);
  } catch (err) {
    console.error('[pdf/health] error:', err);
    res.status(500).type('text/plain').send(String(err?.stack || err));
  }
});

app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// Serve app from both roots so absolute/relative paths work
app.use('/ner-calculator', express.static(staticDir));
app.use('/',              express.static(staticDir));

// SPA entry/fallback
app.get(['/', '/index.html', '*'], (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on :${port}`));

