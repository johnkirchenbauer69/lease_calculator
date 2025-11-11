import { chromium } from 'playwright';
import { renderProposalTemplate } from './render-proposal-template.js';

export default async function handler(req, res) {
  const payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  let browser;
  try {
    const html = renderProposalTemplate(payload);

    // critical for Render
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(200); // small settle
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.6in', left: '0.5in' }
    });

    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','inline; filename="Lease_Proposal_Comparison.pdf"');
    res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error('[api/pdf] error:', err);
    res.status(500).type('text/plain').send(String(err?.stack || err));
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
}
