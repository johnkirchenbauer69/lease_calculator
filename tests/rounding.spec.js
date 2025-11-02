import { describe, expect, it } from 'vitest';
import {
  round2,
  round4,
  finalizeMonthlyCurrency,
  sumRounded,
  pvFromRounded
} from '../ner-calculator/js/engine/rounding.js';

describe('rounding helpers', () => {
  it('finalizeMonthlyCurrency rounds to cents and returns numbers', () => {
    const result = finalizeMonthlyCurrency({
      netTotal: 123.4567,
      grossTotal: 890.1234,
      tenantTaxes$: '45.6789'
    });

    expect(result.netTotal).toBeCloseTo(123.46, 2);
    expect(result.grossTotal).toBeCloseTo(890.12, 2);
    expect(result.tenantTaxes$).toBeCloseTo(45.68, 2);

    Object.values(result).forEach(value => {
      expect(typeof value).toBe('number');
    });
  });

  it('sumRounded aggregates rounded months without drift', () => {
    const monthly = [100.005, 100.005, 100.005, 99.994];
    const total = sumRounded(monthly);
    const expected = round2(100.01 + 100.01 + 100.01 + 99.99);
    expect(total).toBeCloseTo(expected, 9);
  });

  it('pvFromRounded discounts rounded cashflows within a cent', () => {
    const cashflows = [120.005, 118.335, 117.991];
    const rate = 0.01;
    const pv = pvFromRounded(cashflows, rate);
    const rounded = cashflows.map(round2);
    const manual = rounded.reduce((sum, cash, index) => sum + cash / Math.pow(1 + rate, index), 0);
    expect(Math.abs(pv - manual)).toBeLessThan(0.01);
  });

  it('round4 preserves four decimal precision for PSF values', () => {
    expect(round4(1.23456)).toBeCloseTo(1.2346, 4);
    expect(round4('3.21009')).toBeCloseTo(3.2101, 4);
  });
});
