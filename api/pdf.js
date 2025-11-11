import streamProposalPdf from '../ner-calculator/pdf/api-pdf.js';
export const config = { api: { bodyParser: false } };
export default function handler(req, res) { return streamProposalPdf(req, res); }
