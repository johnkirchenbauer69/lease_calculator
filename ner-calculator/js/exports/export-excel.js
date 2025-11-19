/*! export-excel-xlsx.js | Lee & Associates | .xlsx with embedded image */
(function () {
  /** Guard: requires window.__ner_last with schedule data. */
  function ensureData() {
    const d = window.__ner_last;
    if (!d || !d.schedule) {
      alert('Please Calculate first to populate data.');
      return null;
    }
    return d;
  }

  const num = (n) => Number(n || 0);

  // Common number formats
  const fmtInt   = '#,##0';
  const fmtPSF   = '"$"#,##0.0000';
  const fmtPct   = '0.00%';
  const fmtMoney = '"$"#,##0.00;[Red]\\-"$"#,##0.00';

  function addHeaderRow(ws, headers) {
    const r = ws.addRow(headers);
    r.font = { bold: true };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    r.alignment = { vertical: 'middle' };
    return r;
  }

  function setCols(ws, defs) {
    ws.columns = defs.map((d) => ({
      key: d.k, width: d.w || 14, style: d.f ? { numFmt: d.f } : {},
    }));
  }

  /** Helper to group monthly rows by calendar year. */
  function groupByYear(schedule) {
    const m = new Map();
    for (const r of schedule) {
      if (!m.has(r.calYear)) m.set(r.calYear, []);
      m.get(r.calYear).push(r);
    }
    return m;
  }

  // ---------- NEW: Buildout helpers ----------
  function addBuildoutSheet(wb, model) {
    const ws = wb.addWorksheet('Buildout');

    // Title
    ws.addRow(['Capital Improvements (Buildout)']);
    ws.mergeCells('A1:E1');
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.addRow([]);

    // Items table
    addHeaderRow(ws, ['Item', 'Entry Type', 'Amount', 'Total ($)']);
    const items = (model.capex?.items || []);
    for (const it of items) {
      ws.addRow([
        it.name || '',
        it.mode === 'per_sf' ? '$/SF' : '$ Total',
        num(it.amount),
        num(it.total)
      ]);
    }
    ws.getColumn(3).numFmt = '#,##0.00';
    ws.getColumn(4).numFmt = fmtMoney;

    ws.addRow([]);

    // Summary block (Budget + Allowance + Net)
    const totalCapex = model.capex?.total ?? 0;
    const llEntered  = model.capex?.llAllowanceTotal ?? 0; // full entered allowance
    const llApplied  = model.capex?.llAllowanceApplied ?? Math.min(llEntered, totalCapex);
    const unused     = Math.max(0, llEntered - llApplied);
    const netTenant  = Math.max(0, totalCapex - llEntered);

    const summary = [
      ['Total Improvement Costs', '', '', totalCapex],
      ['Less Landlord Allowance (Entered)', '', '', llEntered],
      ['Landlord Allowance Applied', '', '', llApplied],
      ['Unused Allowance', '', '', unused],
      ['Net Tenant Cost', '', '', netTenant],
    ];
    for (const row of summary) ws.addRow(row);

    // style summary lines
    const start = ws.lastRow.number - summary.length + 1;
    for (let r = start; r <= ws.lastRow.number; r++) {
      ws.getCell(`A${r}`).alignment = { horizontal: 'left' };
      ws.getCell(`D${r}`).numFmt = fmtMoney;
      if (r === ws.lastRow.number) ws.getRow(r).font = { bold: true };
    }

    // Treatment note
    const treat = model.capex?.allowTreatment || 'cash';
    const aprPct = (model.capex?.allowApr ?? 0) * 100;
    ws.addRow([]);
    ws.addRow([
      `Allowance Treatment: ${treat === 'amort'
        ? `Amortized at ${aprPct.toFixed(2)}% APR over original term`
        : 'Cash (upfront)'}`
    ]);
    ws.mergeCells(`A${ws.lastRow.number}:E${ws.lastRow.number}`);
    ws.getCell(`A${ws.lastRow.number}`).font = { italic: true, color: { argb: 'FF666666' } };

    // Layout tweaks
    ws.getColumn(1).width = 38;
    ws.getColumn(2).width = 16;
    ws.getColumn(3).width = 14;
    ws.getColumn(4).width = 16;
    ws.getColumn(5).width = 2;
  }

  function addAllowanceScheduleSheet(wb, model, termMonths) {
    const ws = wb.addWorksheet('Allowance Schedule');

    const llApplied = model.capex?.llAllowanceApplied ?? 0;
    const treat = model.capex?.allowTreatment || 'cash';
    const apr   = model.capex?.allowApr ?? 0; // annual rate as decimal

    ws.getColumn(1).width = 10; // Period
    ws.getColumn(2).width = 16; // Begin Bal
    ws.getColumn(3).width = 14; // Payment
    ws.getColumn(4).width = 14; // Interest
    ws.getColumn(5).width = 14; // Principal
    ws.getColumn(6).width = 16; // End Bal
    for (let c=2; c<=6; c++) ws.getColumn(c).numFmt = fmtMoney;

    ws.addRow(['Landlord Allowance: Schedule']);
    ws.mergeCells('A1:F1');
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.addRow([]);

    if (!llApplied || llApplied <= 0) {
      ws.addRow(['No landlord allowance applied.']);
      ws.mergeCells('A3:F3');
      return;
    }

    if (treat !== 'amort') {
      addHeaderRow(ws, ['Note', 'Upfront Allowance', '', '', '', '']);
      const r = ws.addRow(['Cash (upfront) applied at commencement', llApplied, '', '', '', '']);
      r.getCell(2).numFmt = fmtMoney;
      return;
    }

    // Amortization schedule
    addHeaderRow(ws, ['Period', 'Beginning Balance', 'Payment', 'Interest', 'Principal', 'Ending Balance']);

    const n = Math.max(1, Number(termMonths || model.term || 0));
    const i_m = Math.max(0, Number(apr)) / 12; // monthly rate
    const pmt = i_m > 0 ? (llApplied * i_m) / (1 - Math.pow(1 + i_m, -n))
                        : (llApplied / n);

    let bal = llApplied;
    for (let k = 1; k <= n; k++) {
      const interest = i_m * bal;
      const principal = Math.min(bal, pmt - interest);
      const end = Math.max(0, bal - principal);

      ws.addRow([k, bal, pmt, interest, principal, end]);
      bal = end;
    }
  }

  /** Build workbook in-memory and download as .xlsx. */
  async function downloadExcel() {
    const data = ensureData(); if (!data) return;

    // -------- workbook --------
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Lee & Associates';
    wb.created = new Date();

    // ===== Property (Cover) — FIRST SHEET =====
    const shP = wb.addWorksheet('Property', { properties: { defaultRowHeight: 20 } });

    // layout: gutter + photo + gutter + labels + values
    shP.columns = [
      { width: 2 },   // A gutter
      { width: 48 },  // B photo column
      { width: 2 },   // C gutter
      { width: 28 },  // D label
      { width: 22 },  // E value
    ];

    // Title + subtitle (merge across B..E)
    shP.mergeCells('B2:E2');
    shP.getCell('B2').value = data.reportTitle || 'Lease Analysis';
    shP.getCell('B2').font  = { bold: true, size: 16 };

    shP.mergeCells('B3:D3');
    shP.getCell('B3').value = data.propertyAddress || '';
    shP.getCell('E3').value = new Date().toLocaleDateString();
    shP.getCell('E3').alignment = { horizontal: 'right' };

    // Helpers
    const clampRow = (n) => Math.max(4, Math.floor(Number.isFinite(n) ? n : 4));
    const L = (r, text) => { const c = shP.getCell(r, 4); c.value = text; c.font = { bold: true }; return c; };
    const V = (r, val, fmt) => { const c = shP.getCell(r, 5); c.value = val; if (fmt) c.numFmt = fmt; return c; };
    const stripe = (r, on) => {
      const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: on ? 'FFF8FAFC' : 'FFFFFFFF' } };
      const border = { style: 'thin', color: { argb: 'FFE5E7EB' } };
      const cL = shP.getCell(r, 4), cV = shP.getCell(r, 5);
      cL.fill = cV.fill = fill;
      cL.border = cV.border = { top: border, bottom: border, left: border, right: border };
    };
    const sectionHeader = (r, text) => {
      r = clampRow(r);
      shP.mergeCells(`D${r}:E${r}`);
      const c = shP.getCell(`D${r}`);
      c.value = text;
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      return r + 1;
    };

    // Image placement (no overlap with KPIs)
    const rowH      = 20;   // px per row
    const imgTopRow = 5;    // start below title/subtitle
    const imgWidth  = 560;  // px
    const imgHeight = 220;  // px

    let rr;
    try {
      if (data.photoDataURL) {
        const [meta, base64] = String(data.photoDataURL).split(',');
        const ext   = /png/i.test(meta) ? 'png' : 'jpeg';
        const imgId = wb.addImage({ base64: base64 || '', extension: ext });
        shP.addImage(imgId, { tl: { col: 1, row: imgTopRow - 1 }, ext: { width: imgWidth, height: imgHeight } });
        const rowsUsed = Math.max(1, Math.ceil(imgHeight / rowH));
        for (let r = imgTopRow; r < imgTopRow + rowsUsed; r++) shP.getRow(r).height = rowH;
        rr = imgTopRow + rowsUsed + 2; // start KPIs below image
      } else {
        rr = imgTopRow;
      }
    } catch {
      rr = imgTopRow;
    }

    // Key Inputs
    rr = sectionHeader(rr, 'Key Inputs');
    stripe(rr, false); L(rr, 'Space Size (SF)');        V(rr++, Number(data.area || 0), fmtInt);
    stripe(rr, true ); L(rr, 'Lease Term (months)');    V(rr++, Number(data.termMonths || data.term || 0), fmtInt);
    stripe(rr, false); L(rr, 'Start Base ($/SF/yr)');   V(rr++, Number(data.baseStart || data.basePSF || 0), fmtPSF);
    stripe(rr, true ); L(rr, 'Base Escalation (%/yr)'); V(rr++, Number(data.baseEscPct || 0) / 100, fmtPct);
    stripe(rr, false); L(rr, 'Taxes ($/SF/yr)');        V(rr++, Number(data.taxes || 0), fmtPSF);
    stripe(rr, true ); L(rr, 'CAM ($/SF/yr)');          V(rr++, Number(data.cam || 0),   fmtPSF);
    stripe(rr, false); L(rr, 'Insurance ($/SF/yr)');    V(rr++, Number(data.ins || 0),   fmtPSF);
    if (data.includeBrokerComm) {
      stripe(rr, true ); L(rr, 'Commission Total');     V(rr++, Number(data.commissionTotal || 0), fmtMoney);
    }

    // Key KPIs
    rr += 1;
    rr = sectionHeader(rr, 'Key KPIs');
    stripe(rr, false); L(rr, 'NER (PV)');               V(rr++, Number(data.nerPV || 0), fmtPSF);
    stripe(rr, true ); L(rr, 'NER (non-PV)');           V(rr++, Number(data.simpleNet || 0), fmtPSF);
    stripe(rr, false); L(rr, 'Avg Monthly Net');        V(rr++, Number(data.avgNetMonthly || 0), fmtMoney);
    stripe(rr, true ); L(rr, 'Avg Monthly Gross');      V(rr++, Number(data.avgGrossMonthly || 0), fmtMoney);
    stripe(rr, false); L(rr, 'Total Net Rent');         V(rr++, Number(data.totalPaidNet || 0), fmtMoney);
    stripe(rr, true ); L(rr, 'Total Gross Rent');       V(rr++, Number(data.totalPaidGross || 0), fmtMoney);

    // NEW: Buildout Summary on cover
    rr += 1;
    rr = sectionHeader(rr, 'Buildout Summary');
    const totalCapex = data.capex?.total ?? 0;
    const llEntered  = data.capex?.llAllowanceTotal ?? 0;
    const llApplied  = data.capex?.llAllowanceApplied ?? Math.min(llEntered, totalCapex);
    const unused     = Math.max(0, llEntered - llApplied);
    const netTenant  = Math.max(0, totalCapex - llEntered);
    const treat      = data.capex?.allowTreatment || 'cash';
    const aprPct     = (data.capex?.allowApr ?? 0) * 100;

    stripe(rr, false); L(rr, 'Total Improvement Costs'); V(rr++, totalCapex, fmtMoney);
    stripe(rr, true ); L(rr, 'Less Landlord Allowance (Entered)'); V(rr++, llEntered, fmtMoney);
    stripe(rr, false); L(rr, 'Landlord Allowance Applied'); V(rr++, llApplied, fmtMoney);
    stripe(rr, true ); L(rr, 'Unused Allowance'); V(rr++, unused, fmtMoney);
    stripe(rr, false); L(rr, 'Net Tenant Cost'); V(rr++, netTenant, fmtMoney);
    stripe(rr, true ); L(rr, 'Allowance Treatment'); V(rr++, (treat === 'amort'
      ? `Amortized @ ${aprPct.toFixed(2)}% APR`
      : 'Cash (upfront)'));

    // Print defaults
    shP.pageSetup = {
      fitToPage: true, fitToWidth: 1, orientation: 'landscape',
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 }
    };

    // ===== Buildout sheets =====
    if (data.capex) addBuildoutSheet(wb, data);
    if (data.capex) addAllowanceScheduleSheet(wb, data, (data.termMonths || data.term || 0));

    // ===== Monthly (Annualized PSF) =====
    const shM = wb.addWorksheet('Monthly', { properties: { defaultRowHeight: 18 } });
    const colsM = [
      { h: 'Year', k: 'year', w: 8, f: fmtInt },
      { h: 'Month', k: 'month', w: 10 },
      { h: 'Space Size (SF)', k: 'area', w: 16, f: fmtInt },
      { h: 'Allowance Applied ($/SF)', k: 'ti', w: 22, f: fmtPSF },
      { h: 'Net Rent ($/SF/yr)', k: 'netpsf', w: 20, f: fmtPSF },
      { h: 'Taxes ($/SF/yr)', k: 'taxpsf', w: 18, f: fmtPSF },
      { h: 'CAM ($/SF/yr)', k: 'campsf', w: 18, f: fmtPSF },
      { h: 'Insurance ($/SF/yr)', k: 'inspsf', w: 22, f: fmtPSF },
      { h: 'Gross Rent ($/SF/yr)', k: 'grosspsf', w: 22, f: fmtPSF },
      { h: 'Net Rent (Total)', k: 'nettot', w: 18, f: fmtMoney },
      { h: 'Gross Rent (Total)', k: 'grosstot', w: 20, f: fmtMoney },
    ];
    setCols(shM, colsM);
    addHeaderRow(shM, colsM.map(d => d.h));

    for (const r of data.schedule) {
      const net = num(r.contractNetAnnualPSF);
      const tax = num(r.contractTaxesAnnualPSF);
      const cam = num(r.contractCamAnnualPSF);
      const ins = num(r.contractInsAnnualPSF);
      shM.addRow({
        year: r.calYear, month: r.month, area: num(r.area),
        ti: num(data.tiPerSF_forDisplay), // applied allowance per SF (constant)
        netpsf: net, taxpsf: tax, campsf: cam, inspsf: ins,
        grosspsf: net + tax + cam + ins,
        nettot: num(r.netTotal), grosstot: num(r.grossTotal),
      });
    }
    shM.views = [{ state: 'frozen', ySplit: 1 }];

    // ===== Annual (month-weighted) =====
    const shA = wb.addWorksheet('Yearly + Abatement', { properties: { defaultRowHeight: 18 } });
    const colsA = [
      { h: 'Lease Year', k: 'leaseYear', w: 16 },
      { h: 'Segment', k: 'segment', w: 16 },
      { h: 'Months', k: 'months', w: 10, f: fmtInt },
      { h: 'Space Size (SF)', k: 'area', w: 16, f: fmtInt },
      { h: 'Allowance Applied ($/SF)', k: 'ti', w: 22, f: fmtPSF },
      { h: 'Net Rent ($/SF/yr)', k: 'netpsf', w: 18, f: fmtPSF },
      { h: 'Taxes ($/SF/yr)', k: 'taxpsf', w: 18, f: fmtPSF },
      { h: 'CAM ($/SF/yr)', k: 'campsf', w: 18, f: fmtPSF },
      { h: 'Insurance ($/SF/yr)', k: 'inspsf', w: 20, f: fmtPSF },
      { h: 'Gross Rent ($/SF/yr)', k: 'grosspsf', w: 20, f: fmtPSF },
      { h: 'Abatement ($)', k: 'abatement', w: 18, f: fmtMoney },
      { h: 'Total Net Rent', k: 'totnet', w: 20, f: fmtMoney },
      { h: 'Total Gross Rent', k: 'totgross', w: 20, f: fmtMoney },
    ];
    setCols(shA, colsA);
    addHeaderRow(shA, colsA.map(d => d.h));

    const byYear = groupByYear(data.schedule);
    const perspective = (data.perspective === 'tenant') ? 'tenant' : 'landlord';
    const rollup = (typeof window.buildYearlyAbatementRows === 'function')
      ? window.buildYearlyAbatementRows(data, perspective)
      : null;
    const segmentRows = Array.isArray(rollup?.rows) ? rollup.rows : [];
    const netKey = perspective === 'tenant' ? 'baseRentPSF' : 'baseRentPSF_LL';
    const taxKey = perspective === 'tenant' ? 'taxesPSF' : 'taxesPSF_LL';
    const camKey = perspective === 'tenant' ? 'camPSF' : 'camPSF_LL';
    const insKey = perspective === 'tenant' ? 'insPSF' : 'insPSF_LL';
    const grossKey = perspective === 'tenant' ? 'grossPSF' : 'grossPSF_LL';
    const tiValue = num(data.tiPerSF_forDisplay);

    if (segmentRows.length) {
      segmentRows.forEach(seg => {
        const leaseLabel = seg.leaseYearLabel || (seg.year != null ? `Lease Year ${seg.year}` : '');
        const segmentLabel = seg.segmentLabel || seg.period || '';
        const months = seg.segmentMonthCount ?? seg.__monthCount ?? 0;
        shA.addRow({
          leaseYear: leaseLabel,
          segment: segmentLabel,
          months,
          area: num(seg.spaceSize),
          ti: tiValue,
          netpsf: num(seg[netKey]),
          taxpsf: num(seg[taxKey]),
          campsf: num(seg[camKey]),
          inspsf: num(seg[insKey]),
          grosspsf: num(seg[grossKey]),
          abatement: num(seg.abatement$),
          totnet: num(seg.monthlyNet$),
          totgross: num(seg.monthlyGross$)
        });
      });
    } else {
      for (const [yr, arr] of byYear.entries()) {
        if (!Array.isArray(arr) || !arr.length) continue;
        const months = arr.length;
        const area = num(arr[0].area);
        const sum = (k) => arr.reduce((s, r) => s + num(r[k]), 0);
        const wNet = sum('contractNetAnnualPSF') / months;
        const wTax = sum('contractTaxesAnnualPSF') / months;
        const wCam = sum('contractCamAnnualPSF') / months;
        const wIns = sum('contractInsAnnualPSF') / months;
        const wGross = wNet + wTax + wCam + wIns;
        const totNet = sum('netTotal');
        const totGross = sum('grossTotal');
        const abate = sum('freeBase$');
        const leaseLabel = `Lease Year ${yr}`;

        shA.addRow({
          leaseYear: leaseLabel,
          segment: 'Term',
          months,
          area,
          ti: tiValue,
          netpsf: wNet,
          taxpsf: wTax,
          campsf: wCam,
          inspsf: wIns,
          grosspsf: wGross,
          abatement: abate,
          totnet: totNet,
          totgross: totGross
        });
      }
    }
    shA.views = [{ state: 'frozen', ySplit: 1 }];

    // ===== Monthly + Subtotals =====
    const shMS = wb.addWorksheet('Monthly + Subtotals', { properties: { defaultRowHeight: 18 } });
    const colsMS = [
      { h: 'Year', k: 'year', w: 8, f: fmtInt },
      { h: 'Month', k: 'month', w: 10 },
      { h: 'Space Size (SF)', k: 'area', w: 16, f: fmtInt },
      { h: 'Allowance Applied ($/SF)', k: 'ti', w: 22, f: fmtPSF },
      { h: 'Net Rent ($/SF/yr)', k: 'netpsf', w: 20, f: fmtPSF },
      { h: 'Taxes ($/SF/yr)', k: 'taxpsf', w: 18, f: fmtPSF },
      { h: 'CAM ($/SF/yr)', k: 'campsf', w: 18, f: fmtPSF },
      { h: 'Insurance ($/SF/yr)', k: 'inspsf', w: 22, f: fmtPSF },
      { h: 'Gross Rent ($/SF/yr)', k: 'grosspsf', w: 22, f: fmtPSF },
      { h: 'Net Rent (Total)', k: 'nettot', w: 18, f: fmtMoney },
      { h: 'Gross Rent (Total)', k: 'grosstot', w: 20, f: fmtMoney },
    ];
    setCols(shMS, colsMS);
    addHeaderRow(shMS, colsMS.map(d => d.h));

    for (const [yr, arr] of byYear.entries()) {
      for (const r of arr) {
        const net = num(r.contractNetAnnualPSF);
        const tax = num(r.contractTaxesAnnualPSF);
        const cam = num(r.contractCamAnnualPSF);
        const ins = num(r.contractInsAnnualPSF);
        shMS.addRow({
          year: r.calYear, month: r.month, area: num(r.area),
          ti: num(data.tiPerSF_forDisplay),
          netpsf: net, taxpsf: tax, campsf: cam, inspsf: ins,
          grosspsf: net + tax + cam + ins,
          nettot: num(r.netTotal), grosstot: num(r.grossTotal),
        });
      }

      // Subtotal row
      const months = arr.length;
      const area = num(arr[0].area);
      const sum = (k) => arr.reduce((s, r) => s + num(r[k]), 0);
      const wNet = sum('contractNetAnnualPSF')   / months;
      const wTax = sum('contractTaxesAnnualPSF') / months;
      const wCam = sum('contractCamAnnualPSF')   / months;
      const wIns = sum('contractInsAnnualPSF')   / months;
      const wGross = wNet + wTax + wCam + wIns;
      const totNet   = sum('netTotal');
      const totGross = sum('grossTotal');

      const rSub = shMS.addRow({
        year: `${yr} Subtotal`, month: '', area,
        ti: num(data.tiPerSF_forDisplay),
        netpsf: wNet, taxpsf: wTax, campsf: wCam, inspsf: wIns, grosspsf: wGross,
        nettot: totNet / months, grosstot: totGross,
      });
      rSub.font = { bold: true };
      rSub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    }
    shMS.views = [{ state: 'frozen', ySplit: 1 }];

    // -------- download --------
    const title =
      (data.reportTitle || 'Lease Analysis') + ' - ' +
      new Date().toISOString().slice(0, 10);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = title.replace(/[^\w\-]+/g, '_') + '.xlsx';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // keep the same global API your button calls
  window.ExportExcel = { downloadExcel };
})();
