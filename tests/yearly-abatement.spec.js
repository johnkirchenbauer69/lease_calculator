import { describe, expect, it } from 'vitest';
import { buildYearlyAbatementRows, renderYearlyAbatementTable } from '../ner-calculator/js/ui/yearly-abatement.js';

const makeMonthlyRow = ({
  period,
  year,
  spaceSize = 1200,
  cashFactor = 1,
  baseRentPSF = 0,
  baseRentPSF_LL,
  monthlyNet$ = 0,
  monthlyGross$ = 0,
  isAbated = false
}) => ({
  period,
  year,
  spaceSize,
  cashFactor,
  baseRentPSF,
  baseRentPSF_LL: baseRentPSF_LL ?? baseRentPSF,
  monthlyNet$,
  monthlyGross$,
  isAbated
});

class StubClassList {
  constructor(host) {
    this.host = host;
    this.classes = new Set();
  }
  add(...classes) {
    classes.filter(Boolean).forEach(cls => this.classes.add(cls));
    this.host.className = Array.from(this.classes).join(' ');
  }
}

class StubElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = {};
    this._textContent = '';
    this._innerHTML = '';
    this.classList = new StubClassList(this);
    this.className = '';
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  set textContent(value) {
    this._textContent = value ?? '';
  }
  get textContent() {
    return this._textContent;
  }
  set innerHTML(value) {
    this._innerHTML = value ?? '';
    this.children = [];
  }
  get innerHTML() {
    return this._innerHTML;
  }
  get firstChild() {
    return this.children[0] || null;
  }
}

class StubDocument {
  createElement(tagName) {
    return new StubElement(tagName, this);
  }
}

const fmtUSD = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

describe('buildYearlyAbatementRows', () => {
  it('splits lease years into abatement and rent segments with exact dollar rollups', () => {
    const rows = [
      makeMonthlyRow({ period: 1, year: 2024, baseRentPSF: 0, monthlyNet$: 0, monthlyGross$: 0, isAbated: true }),
      makeMonthlyRow({ period: 2, year: 2024, baseRentPSF: 0, monthlyNet$: 0, monthlyGross$: 0, isAbated: true }),
    ];

    for (let period = 3; period <= 12; period += 1) {
      rows.push(makeMonthlyRow({
        period,
        year: 2024,
        baseRentPSF: 24,
        monthlyNet$: 10000,
        monthlyGross$: 13000
      }));
    }

    rows.push(makeMonthlyRow({ period: 13, year: 2025, baseRentPSF: 0, monthlyNet$: 0, monthlyGross$: 0, isAbated: true }));

    for (let period = 14; period <= 18; period += 1) {
      rows.push(makeMonthlyRow({
        period,
        year: 2025,
        baseRentPSF: 26,
        monthlyNet$: 11000,
        monthlyGross$: 14000
      }));
    }

    const { rows: annualRows, totals } = buildYearlyAbatementRows(rows, {
      perspective: 'tenant',
      psfKeys: ['baseRentPSF'],
      sumKeys: ['monthlyNet$', 'monthlyGross$']
    });

    expect(annualRows).toHaveLength(4);
    expect(annualRows.map(r => ({
      period: r.period,
      month: r.month,
      isAbated: r.isAbated,
      net: r['monthlyNet$']
    }))).toEqual([
      { period: 'Lease Year 1', month: '1–2', isAbated: true, net: 0 },
      { period: 'Lease Year 1', month: '3–12', isAbated: false, net: 100000 },
      { period: 'Lease Year 2', month: '13', isAbated: true, net: 0 },
      { period: 'Lease Year 2', month: '14–18', isAbated: false, net: 55000 }
    ]);

    expect(totals.sums['monthlyNet$']).toBe(155000);
    expect(totals.sums['monthlyGross$']).toBe(200000);
    expect(totals.abatement.months).toBe(3);
  });

  it('weights PSF columns by monthly cash factor to handle mid-month starts', () => {
    const rows = [
      makeMonthlyRow({ period: 1, year: 2024, baseRentPSF_LL: 60, baseRentPSF: 60, monthlyNet$: 5000, cashFactor: 0.5 }),
      makeMonthlyRow({ period: 2, year: 2024, baseRentPSF_LL: 120, baseRentPSF: 120, monthlyNet$: 10000, cashFactor: 1 })
    ];

    const { rows: annualRows } = buildYearlyAbatementRows(rows, {
      perspective: 'landlord',
      psfKeys: ['baseRentPSF_LL'],
      sumKeys: ['monthlyNet$']
    });

    expect(annualRows).toHaveLength(1);
    expect(annualRows[0].baseRentPSF_LL).toBeCloseTo(100, 6);
    expect(annualRows[0]['monthlyNet$']).toBe(15000);
  });
});

describe('renderYearlyAbatementTable', () => {
  it('renders Lease Year and Segment columns with abatement chips and a grand total footer', () => {
    const rows = [
      makeMonthlyRow({ period: 1, year: 2024, baseRentPSF: 0, monthlyNet$: 0, monthlyGross$: 0, isAbated: true }),
      makeMonthlyRow({ period: 2, year: 2024, baseRentPSF: 0, monthlyNet$: 0, monthlyGross$: 0, isAbated: true }),
      makeMonthlyRow({ period: 3, year: 2024, baseRentPSF: 24, monthlyNet$: 10000, monthlyGross$: 13000 })
    ];

    const tableModel = buildYearlyAbatementRows(rows, {
      perspective: 'tenant',
      psfKeys: [],
      sumKeys: ['monthlyNet$']
    });

    const schema = [
      { key: 'period', label: 'Lease Year', isLabel: true, render: row => row.period },
      { key: 'month', label: 'Segment', render: row => row.month },
      { key: 'monthlyNet$', label: 'Total Net Rent ($)', className: 'cell-dollar', sum: row => row['monthlyNet$'], render: row => fmtUSD(row['monthlyNet$']) },
      {
        key: 'abatement',
        label: 'Abatement',
        className: 'cell-abatement',
        render: row => (row.isAbated ? 'Abated' : ''),
        renderHTML: row => (row.isAbated ? '<span class="chip chip-abated">Abated</span>' : '')
      }
    ];

    const doc = new StubDocument();
    const tbody = new StubElement('tbody', doc);
    tbody.ownerDocument = doc;

    renderYearlyAbatementTable({
      schema,
      rows: tableModel.rows,
      totals: tableModel.totals,
      tbody,
      fmtUSD,
      abatementColumn: schema[3],
      labelColIdx: 0,
      psfKeys: [],
      sumKeys: ['monthlyNet$']
    });

    expect(tbody.children).toHaveLength(tableModel.rows.length + 1);

    const abatedRowCells = tbody.children[0].children;
    expect(abatedRowCells[0].textContent).toBe('Lease Year 1');
    expect(abatedRowCells[1].textContent).toBe('1–2');
    expect(abatedRowCells[3].innerHTML).toContain('chip-abated');

    const rentRowCells = tbody.children[1].children;
    expect(rentRowCells[1].textContent).toBe('3');
    expect(rentRowCells[3].innerHTML).toBe('');

    const footerCells = tbody.children[tbody.children.length - 1].children;
    expect(footerCells[0].textContent).toBe('Grand Total');
    expect(footerCells[2].textContent).toBe(fmtUSD(10000));
  });
});
