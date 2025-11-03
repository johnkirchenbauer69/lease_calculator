const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const psfFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4
});

export const formatCurrency = (value) => {
  if (!Number.isFinite(Number(value))) return '—';
  return currencyFormatter.format(Number(value));
};

export const formatPSF = (value) => {
  if (!Number.isFinite(Number(value))) return '—';
  return `$${psfFormatter.format(Number(value))}/SF`;
};

const formattingAPI = {
  formatCurrency,
  formatPSF
};

if (typeof window !== 'undefined') {
  window.NERFormatting = Object.assign({}, window.NERFormatting, formattingAPI);
  if (!window.formatCurrency) window.formatCurrency = formatCurrency;
  if (!window.formatPSF) window.formatPSF = formatPSF;
}

export default formattingAPI;
