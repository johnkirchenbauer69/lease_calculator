// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import streamProposalPdf from './ner-calculator/pdf/api-pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const staticDir  = path.join(__dirname, 'ner-calculator');

const app = express();
app.use(express.json({ limit: '10mb' }));

// API
app.post('/api/pdf', (req, res) => streamProposalPdf(req, res));

// Serve static at BOTH roots so /js/... and /ner-calculator/js/... resolve
app.use('/ner-calculator', express.static(staticDir));
app.use('/',              express.static(staticDir));

// SPA entry
app.get(['/', '/index.html'], (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// optional SPA fallback for hash/history routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on :${port}`));
