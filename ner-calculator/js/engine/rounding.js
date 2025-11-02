export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

export const finalizeMonthlyCurrency = (raw = {}) => {
  const result = {};
  for (const [key, value] of Object.entries(raw)) {
    result[key] = round2(value);
  }
  return result;
};

export const sumRounded = (values = []) => {
  return values.reduce((total, value) => total + round2(value), 0);
};

export const pvFromRounded = (cashflows = [], rate = 0, offset = 0) => {
  return cashflows.reduce((total, cash, index) => {
    const t = index + offset;
    const factor = 1 / Math.pow(1 + rate, t);
    return total + round2(cash) * factor;
  }, 0);
};

if (typeof window !== 'undefined') {
  window.rounding = Object.assign({}, window.rounding, {
    round2,
    round4,
    finalizeMonthlyCurrency,
    sumRounded,
    pvFromRounded
  });
}
