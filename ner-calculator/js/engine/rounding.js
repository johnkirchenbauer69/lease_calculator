export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

export const pvFromExact = (cashflows = [], rate = 0, offset = 1) => {
  return cashflows.reduce((total, cash, index) => {
    const t = index + offset;
    const factor = 1 / Math.pow(1 + rate, t);
    return total + Number(cash || 0) * factor;
  }, 0);
};

if (typeof window !== 'undefined') {
  window.rounding = Object.assign({}, window.rounding, {
    round2,
    round4,
    pvFromExact
  });
}
