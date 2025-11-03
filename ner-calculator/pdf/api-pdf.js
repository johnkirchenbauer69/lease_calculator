import { chromium } from 'playwright';
import renderProposalTemplate from './render-proposal-template.js';

function readRequestBody(req) {
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(req.body);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    req
      .on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      .on('end', () => {
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? JSON.parse(raw) : {});
        } catch (error) {
          reject(error);
        }
      })
      .on('error', reject);
  });
}

export async function streamProposalPdf(req, res) {
  if (req.method && req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end('Method Not Allowed');
    return;
  }

  let payload;
  try {
    payload = await readRequestBody(req);
  } catch (error) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Invalid JSON payload', details: error.message }));
    return;
  }

  const html = renderProposalTemplate(payload);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.6in',
        left: '0.5in',
      },
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="lease-proposal.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(pdf);
  } finally {
    await browser.close();
  }
}

// For AWS Lambda or other serverless platforms that disallow Playwright binaries,
// swap the Playwright import with `import chromium from '@sparticuz/chromium'`
// and `import puppeteer from 'puppeteer-core'`, then launch puppeteer with the
// provided Chromium executable path and arguments.

export default streamProposalPdf;
