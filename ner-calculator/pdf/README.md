# PDF Proposal Service

This folder contains the HTML renderer and API helper that generate the Net Effective Rent proposal PDF.

## Local setup

1. Install dependencies for Playwright. The project already declares Playwright as a direct dependency of the PDF API helper, so install browser binaries with:

   ```bash
   npx playwright install chromium
   ```

2. (Optional) If you need all browsers for other tests, use `npx playwright install`.

The renderer (`render-proposal-template.js`) only uses browser-safe APIs (`Intl.NumberFormat` and `Date#toLocaleDateString`) to format numbers and dates, so there is no additional localization setup required.

## Invoking the generator locally

The default export from `api-pdf.js` (`streamProposalPdf`) expects a Node-style HTTP `req` and `res` object (for example, from Express, Next.js API routes, or a serverless runtime). Provide a JSON payload in the request body with the following top-level properties:

- `deal`: meta information about the proposal (title, property, contacts, rent schedule, highlight bullets).
- `scenarios`: up to three scenario objects that will render the KPI cards.
- `charts`: an array of chart objects with `image` (data URL or remote URL) and optional captions.
- `branding`: colors and assets that drive the layout.

Example (assuming Node 18+):

```bash
curl -X POST http://localhost:3000/api/pdf \
  -H 'content-type: application/json' \
  -o proposal.pdf \
  -d '{
        "deal": {
          "title": "HQ Renewal",
          "preparedFor": "Acme Corp",
          "rentSchedule": [{"period": "Year 1", "rent": 120000}]
        },
        "scenarios": [
          {
            "title": "Lease Renewal",
            "kpis": [
              {"label": "Starting Rent", "value": 120000, "format": "currency"},
              {"label": "Concessions", "value": 0, "format": "currency"}
            ]
          }
        ],
        "charts": [
          {"title": "Cash Flow", "image": "data:image/png;base64,..."}
        ],
        "branding": {
          "primary": "#1738ff",
          "accent": "#ffba49",
          "footerNote": "Confidential — internal use only"
        }
      }'
```

The API helper disables caching and streams the generated PDF directly back to the caller.

## Deployment notes

- **Vercel / Next.js**: Export the handler from `/api/pdf.js` (already wired in this repo). Add `export const config = { api: { bodyParser: false } };` to ensure you can stream the raw request body for Playwright.
- **Netlify Functions**: Wrap `streamProposalPdf` inside a Netlify handler that converts the event body into a mock `req`/`res` pair, or use Netlify's Node 18 runtime with the built-in request/response helpers.
- **Node / Express**: Attach `streamProposalPdf` to a POST route and ensure `express.json()` is disabled for that route so Playwright can read the raw body if needed.

When deploying to environments that do not permit installing Playwright's Chromium binary, swap the import to `puppeteer-core` and `@sparticuz/chromium` as described in the inline comment inside `api-pdf.js`.

## Branding options

The renderer accepts a `branding` object with these optional properties:

- `branding.primary`: Hex or CSS color string used for the top banner and table headers.
- `branding.accent`: Accent color for pills and decorative dots.
- `branding.logoUrl`: Remote or data URL logo rendered on the brand bar.
- `branding.footerNote`: String rendered on the left side of the footer.

All properties fall back to sensible defaults when omitted.

## Editing KPI rows

Scenario cards render from a `kpis` array. Each entry should contain:

- `label`: Short descriptor shown on the left.
- `value`: Number or string displayed on the right. Numbers are formatted using `Intl.NumberFormat` based on the optional format.
- `format`: Optional string — use `"currency"`, `"percent"`, or `"number"` for automatic formatting. Strings are inserted as-is.

The renderer preserves the order of the `kpis` array, so rearrange or insert new rows directly in your data payload to control the visual layout.
