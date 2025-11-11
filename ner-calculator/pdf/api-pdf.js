import { chromium } from 'playwright';
import { renderProposalTemplate } from './render-proposal-template.js';

export default async function handler(req, res) {
  // Parse JSON coming from Express
  const payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  let browser;

  try {
    const html = renderProposalTemplate(payload);

    // IMPORTANT for Render: disable Chromium sandbox & reduce /dev/shm usage
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.6in', left: '0.5in' }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Lease_Proposal_Comparison.pdf"');
    res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error('[api/pdf] error:', err);
    res.status(500).type('text/plain').send(String(err?.stack || err));
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
}

