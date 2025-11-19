const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const weightForRow = (row) => {
  const w = Number(row?.cashFactor);
  return Number.isFinite(w) && w > 0 ? w : 1;
};

const approxEqual = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;

const monthRangeLabel = (start, end, count) => {
  if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end > 0) {
    return (start === end) ? `${start}` : `${start}\u2013${end}`;
  }
  if (count === 1) return '1';
  if (count > 1) return `${count}`;
  return '—';
};

const labelForGroup = (yearKey, perspective) => {
  if (perspective === 'tenant') {
    return yearKey != null ? `Lease Year ${yearKey}` : 'Lease Year —';
  }
  return yearKey != null ? `Year ${yearKey}` : 'Year —';
};

const resolveLeaseYear = (row) => {
  const periodNumber = toNumber(row?.period);
  if (!periodNumber) return null;
  const computed = Math.ceil(periodNumber / 12);
  return computed > 0 ? computed : null;
};

const emptyTotals = (psfKeys = [], sumKeys = []) => ({
  sums: Object.fromEntries(sumKeys.map(key => [key, 0])),
  psfWeighted: Object.fromEntries(psfKeys.map(key => [key, 0])),
  weight: 0,
  months: 0,
  abatement: { hasAbated: false, months: 0 }
});

export function buildYearlyAbatementRows(monthlyRows = [], options = {}) {
  const {
    perspective = 'landlord',
    psfKeys = [],
    sumKeys = []
  } = options || {};

  if (!Array.isArray(monthlyRows) || monthlyRows.length === 0) {
    return { rows: [], totals: emptyTotals(psfKeys, sumKeys) };
  }

  const rowsArray = monthlyRows.map(row => ({ ...row }));
  rowsArray.sort((a, b) => {
    const yearA = Number(a?.year);
    const yearB = Number(b?.year);
    const safeYearA = Number.isFinite(yearA) ? yearA : Number.POSITIVE_INFINITY;
    const safeYearB = Number.isFinite(yearB) ? yearB : Number.POSITIVE_INFINITY;
    if (safeYearA !== safeYearB) return safeYearA - safeYearB;
    const periodA = Number(a?.period);
    const periodB = Number(b?.period);
    const safePeriodA = Number.isFinite(periodA) ? periodA : Number.POSITIVE_INFINITY;
    const safePeriodB = Number.isFinite(periodB) ? periodB : Number.POSITIVE_INFINITY;
    return safePeriodA - safePeriodB;
  });

  const sums = Object.fromEntries(sumKeys.map(key => [key, 0]));
  const psfWeighted = Object.fromEntries(psfKeys.map(key => [key, 0]));
  let totalWeight = 0;
  let totalMonths = 0;
  let totalAbatedMonths = 0;
  let hasAbated = false;

  const baseRentKey = perspective === 'tenant' ? 'baseRentPSF' : 'baseRentPSF_LL';

  let currentGroup = null;
  const aggregatedRows = [];

  const flushGroup = () => {
    if (!currentGroup || !currentGroup.rows.length) {
      currentGroup = null;
      return;
    }

    const rows = currentGroup.rows;
    const firstRow = rows[0] || {};
    const monthCount = rows.length;
    const weightSum = rows.reduce((sum, row) => sum + weightForRow(row), 0);
    const abatedMonths = rows.reduce((count, row) => count + (row.isAbated ? 1 : 0), 0);

    const aggRow = {
      period: labelForGroup(currentGroup.yearKey, perspective),
      year: currentGroup.yearKey ?? '',
      month: monthRangeLabel(currentGroup.startPeriod, currentGroup.endPeriod, monthCount),
      spaceSize: firstRow.spaceSize ?? 0,
      cashFactor: firstRow.cashFactor,
      isAbated: abatedMonths > 0,
      abatedMonths,
      __monthCount: monthCount,
      __monthsInPeriod: monthCount,
      __weightSum: weightSum
    };

    psfKeys.forEach(key => {
      const weightedSum = rows.reduce((sum, row) => sum + toNumber(row[key]) * weightForRow(row), 0);
      aggRow[key] = weightSum ? (weightedSum / weightSum) : 0;
    });

    sumKeys.forEach(key => {
      const total = rows.reduce((sum, row) => sum + toNumber(row[key]), 0);
      aggRow[key] = total;
      sums[key] += total;
    });

    aggregatedRows.push(aggRow);
    totalWeight += weightSum;
    totalMonths += monthCount;
    totalAbatedMonths += abatedMonths;
    if (abatedMonths > 0) hasAbated = true;
    currentGroup = null;
  };

  rowsArray.forEach(row => {
    const monthIndex = toNumber(row.period);
    const calYear = Number(row?.year);
    const yearKey = perspective === 'tenant'
      ? resolveLeaseYear(row)
      : (Number.isFinite(calYear) ? calYear : null);
    const netValue = toNumber(row.monthlyNet$);
    const baseRentValue = toNumber(row[baseRentKey]);
    const rowAbated = !!row.isAbated || Math.abs(netValue) <= 1e-9 || Math.abs(baseRentValue) <= 1e-9;
    const psfSnapshot = {};
    psfKeys.forEach(key => { psfSnapshot[key] = toNumber(row[key]); });

    const shouldStartNew = !currentGroup
      || currentGroup.yearKey !== yearKey
      || currentGroup.isAbated !== rowAbated
      || psfKeys.some(key => !approxEqual(currentGroup.psfValues[key] ?? 0, psfSnapshot[key] ?? 0));

    if (shouldStartNew) {
      flushGroup();
      currentGroup = {
        yearKey,
        isAbated: rowAbated,
        psfValues: psfSnapshot,
        rows: [],
        startPeriod: Number.isFinite(monthIndex) && monthIndex > 0 ? monthIndex : null,
        endPeriod: Number.isFinite(monthIndex) && monthIndex > 0 ? monthIndex : null
      };
    }

    const normalizedRow = { ...row, isAbated: rowAbated };
    currentGroup.rows.push(normalizedRow);
    if (Number.isFinite(monthIndex) && monthIndex > 0) {
      if (!Number.isFinite(currentGroup.startPeriod) || currentGroup.startPeriod == null) {
        currentGroup.startPeriod = monthIndex;
      }
      currentGroup.endPeriod = monthIndex;
    }
    currentGroup.psfValues = psfSnapshot;
  });

  flushGroup();

  psfKeys.forEach(key => {
    psfWeighted[key] = rowsArray.reduce((sum, row) => sum + toNumber(row[key]) * weightForRow(row), 0);
  });

  return {
    rows: aggregatedRows,
    totals: {
      sums,
      psfWeighted,
      weight: totalWeight,
      months: totalMonths,
      abatement: { hasAbated, months: totalAbatedMonths }
    }
  };
}

export function renderYearlyAbatementTable({
  schema = [],
  rows = [],
  totals = emptyTotals(),
  tbody,
  fmtUSD = (value) => (Number.isFinite(Number(value))
    ? Number(value).toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2
      })
    : '—'),
  abatementColumn,
  labelColIdx = 0,
  psfKeys = [],
  sumKeys = []
} = {}) {
  if (!tbody) return null;
  const doc = tbody.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;

  tbody.innerHTML = '';

  rows.forEach(row => {
    const tr = doc.createElement('tr');
    schema.forEach(col => {
      const td = doc.createElement('td');
      if (col.className) {
        col.className.split(/\s+/).filter(Boolean).forEach(cls => td.classList.add(cls));
      }

      const htmlContent = typeof col.renderHTML === 'function' ? (col.renderHTML(row) || '') : '';
      if (htmlContent) {
        td.innerHTML = htmlContent;
        if (col.key === abatementColumn?.key && row.abatedMonths > 0) {
          const count = row.abatedMonths;
          const label = `${count} month${count === 1 ? '' : 's'} abated`;
          td.setAttribute('aria-label', label);
        }
      } else {
        let textContent = '';
        if (typeof col.render === 'function') {
          textContent = col.render(row);
        }
        td.textContent = textContent ?? '';
      }

      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  const grandRow = doc.createElement('tr');
  grandRow.classList.add('grand-total', 'row-grandtotal');

  schema.forEach((col, idx) => {
    const td = doc.createElement('td');
    if (col.className) {
      col.className.split(/\s+/).filter(Boolean).forEach(cls => td.classList.add(cls));
    }

    if (idx === labelColIdx) {
      td.textContent = 'Grand Total';
    } else if (psfKeys.includes(col.key)) {
      const avg = totals.weight ? (totals.psfWeighted[col.key] / totals.weight) : 0;
      td.textContent = fmtUSD(avg);
    } else if (sumKeys.includes(col.key)) {
      td.textContent = fmtUSD(totals.sums[col.key] || 0);
      td.classList.add('cell-dollar');
    } else if (col.key === 'month') {
      td.textContent = `${totals.months} Months`;
    } else if (col.key === (abatementColumn?.key)) {
      const { hasAbated, months } = totals.abatement || {};
      const html = hasAbated && months > 0
        ? (typeof abatementColumn?.renderHTML === 'function'
          ? abatementColumn.renderHTML({ isAbated: hasAbated, abatedMonths: months })
          : 'Abated')
        : '';
      if (html) {
        td.innerHTML = html;
        const label = `${months} month${months === 1 ? '' : 's'} abated`;
        td.setAttribute('aria-label', label);
      } else {
        td.textContent = '';
      }
    } else {
      td.textContent = '—';
      td.classList.add('cell-muted');
    }

    grandRow.appendChild(td);
  });

  tbody.appendChild(grandRow);
  return grandRow;
}

if (typeof window !== 'undefined') {
  window.buildYearlyAbatementRows = buildYearlyAbatementRows;
  window.renderYearlyAbatementTable = renderYearlyAbatementTable;
}
