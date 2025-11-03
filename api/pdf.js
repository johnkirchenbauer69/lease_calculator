import streamProposalPdf from '../ner-calculator/pdf/api-pdf.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  return streamProposalPdf(req, res);
}
