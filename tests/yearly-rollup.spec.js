import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function extractFunctionSource(source, fnName) {
  const marker = `function ${fnName}`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Unable to find ${fnName} in app.js`);
  }
  let parenDepth = 0;
  let braceDepth = 0;
  let bodyFound = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      if (parenDepth > 0) parenDepth -= 1;
    } else if (ch === '{') {
      if (!bodyFound && parenDepth === 0) {
        bodyFound = true;
        braceDepth = 1;
        for (let j = i + 1; j < source.length; j += 1) {
          const inner = source[j];
          if (inner === '{') {
            braceDepth += 1;
          } else if (inner === '}') {
            braceDepth -= 1;
            if (braceDepth === 0) {
              return source.slice(start, j + 1);
            }
          }
        }
        break;
      }
    }
  }
  throw new Error(`Unable to extract ${fnName} source`);
}

function loadComputeYearlyAbatementRollup() {
  const appPath = path.join(repoRoot, 'ner-calculator', 'js', 'app.js');
  const source = readFileSync(appPath, 'utf8');
  const fnSource = extractFunctionSource(source, 'computeYearlyAbatementRollup');
  const factory = new Function(
    'annualPSFFromDollars',
    '"use strict";\n' + fnSource + '\nreturn computeYearlyAbatementRollup;'
  );
  return factory(() => 0);
}

describe('yearly abatement rollup', () => {
  it('treats flagged rows as abatement segments regardless of totals', () => {
    const computeYearlyAbatementRollup = loadComputeYearlyAbatementRollup();
    const sharedRow = {
      spaceSize: 1000,
      cashFactor: 1,
      baseRentPSF_LL: 12,
      monthlyNet$: 15000,
      abatement$: 0,
      monthlyGross$: 15000
    };
    const monthlyRows = [
      { ...sharedRow, period: 1, year: 1, isAbated: true },
      { ...sharedRow, period: 2, year: 1, isAbated: false }
    ];

    const rollup = computeYearlyAbatementRollup({
      monthlyRows,
      perspective: 'landlord',
      psfKeys: ['baseRentPSF_LL'],
      sumKeys: ['monthlyNet$']
    });

    expect(Array.isArray(rollup.rows)).toBe(true);
    const abatementSegments = rollup.rows.filter(row => row.segmentKey === 'abatement');
    expect(abatementSegments).toHaveLength(1);
    expect(abatementSegments[0].segmentMonthCount).toBe(1);
    expect(abatementSegments[0].segmentAbatedMonths).toBe(1);

    const rentSegments = rollup.rows.filter(row => row.segmentKey === 'rent');
    expect(rentSegments).toHaveLength(1);
  });
});
