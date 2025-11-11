import renderProposalTemplate from './render-proposal-template.js';
export const config = { api: { bodyParser: false } };
export default function handler(req, res) { return streamProposalPdf(req, res); }
