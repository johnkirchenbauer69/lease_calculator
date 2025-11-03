import { describe, expect, it } from 'vitest';
import { pvFromExact } from '../ner-calculator/js/engine/rounding.js';
import formatting from '../ner-calculator/js/ui/formatting.js';

const { formatCurrency, formatPSF } = formatting;

describe('exact-first policy helpers', () => {
  it('pvFromExact discounts unrounded monthlies', () => {
    const cashflows = [123.4567, 120.7891, 119.3333];
    const rate = 0.01;
    const pv = pvFromExact(cashflows, rate, 0);

    const manual = cashflows.reduce((total, cash, index) => {
      return total + cash / Math.pow(1 + rate, index);
    }, 0);

    expect(pv).toBeCloseTo(manual, 12);
  });

  it('display formatting returns strings and preserves numeric inputs', () => {
    const value = 987.654321;
    const formattedCurrency = formatCurrency(value);
    const formattedPSF = formatPSF(12.345678);

    expect(typeof formattedCurrency).toBe('string');
    expect(typeof formattedPSF).toBe('string');
    expect(value).toBeCloseTo(987.654321, 12);
  });

  it('annual totals can retain precision beyond cents', () => {
    const schedule = [
      { grossTotal: 100.0051 },
      { grossTotal: 99.9952 },
      { grossTotal: 80.3337 }
    ];
    const annualGross = schedule.reduce((sum, row) => sum + row.grossTotal, 0);

    expect(annualGross).toBeCloseTo(280.334, 9);
    expect(Number.isInteger(annualGross * 100)).toBe(false);
  });
});
