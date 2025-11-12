import { chromium } from 'playwright';
import renderProposalTemplate from './render-proposal-template.js';

export default async function streamProposalPdf(req, res) {
  let payload = req.body || {};
  try {
    if (typeof payload === 'string') payload = JSON.parse(payload);
  } catch (_) { /* ignore; leave payload as-is */ }

  let browser;
  try {
    const html = renderProposalTemplate(payload);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 3000 }); // optional
    await page.emulateMedia({ media: 'print' });

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0.8in', right: '0.5in', bottom: '0.6in', left: '0.5in' },
      displayHeaderFooter: true,
      headerTemplate: `
        <style>
          section{font:10px Inter,Arial,sans-serif;color:#6b7280;padding:0 24px;width:100%;}
          .brand{opacity:.75}
        </style>
        <section><span class="brand">${(payload?.deal?.propertyName || 'Lease Proposal')}</span></section>
      `,
      footerTemplate: `
        <style>
          section{font:10px Inter,Arial,sans-serif;color:#6b7280;padding:0 24px;width:100%;
                  display:flex;justify-content:flex-end}
        </style>
        <section>Page <span class="pageNumber"></span> of <span class="totalPages"></span></section>
      `
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

