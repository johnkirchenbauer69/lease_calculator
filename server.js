// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// This is your Playwright handler that returns a PDF
import streamProposalPdf from './ner-calculator/pdf/api-pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));

// PDF endpoint
app.post('/api/pdf', (req, res) => {
  try {
    return streamProposalPdf(req, res);
  } catch (e) {
    console.error('PDF error', e);
    res.status(500).send(String(e?.stack || e));
  }
});

// Serve the calculator front-end
const staticDir = path.join(__dirname, 'ner-calculator');
app.use(express.static(staticDir));

// Default route -> index.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Optional health check
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
