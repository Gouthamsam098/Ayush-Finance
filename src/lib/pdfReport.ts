import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ReportSummaryItem { label: string; value: string; }
export interface ReportParams {
  loanNumber: string;
  loanTypeLabel: string;
  customerName: string;
  customerMobile: string;
  loanDate: string;
  /** Two-column loan/borrower fields — mirrors Statement tab detail grid. */
  detailFields?: ReportSummaryItem[];
  /** Key-figure strip (e.g. Disbursement date, Deduction, Net disbursed, Interest). */
  summary: ReportSummaryItem[];
  progress?: { label: string; paid: number; total: number };
  tableTitle: string;
  tableHead: string[];
  tableBody: (string | number)[][];
  /** Document title; defaults to Payment Schedule (Statement tab). */
  documentTitle?: string;
}

// ── Statement palette — the SAME colours as the on-screen Statement tab, so a
// printed statement is recognisably the same document (StatementView.tsx:
// #022999 → #0538CC → #0AA8F8 header band, emerald paid, red overdue).
const C = {
  brandDark: [2, 41, 153] as [number, number, number],
  brandMid: [5, 56, 204] as [number, number, number],
  brandLight: [10, 168, 248] as [number, number, number],
  ink: [15, 23, 42] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  faint: [148, 163, 184] as [number, number, number],
  hair: [226, 232, 240] as [number, number, number],
  tintBg: [248, 250, 252] as [number, number, number],
  emerald: [16, 185, 129] as [number, number, number],
  emeraldInk: [4, 120, 87] as [number, number, number],
  emeraldBg: [236, 253, 245] as [number, number, number],
  red: [239, 68, 68] as [number, number, number],
  redInk: [185, 28, 28] as [number, number, number],
  redBg: [254, 242, 242] as [number, number, number],
  amberInk: [180, 83, 9] as [number, number, number],
  amberBg: [255, 251, 235] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

/** Horizontal brand gradient inside a rounded rect. jsPDF has no gradient fill,
 *  so it is painted as thin vertical slices clipped to a rounded path — the
 *  same #022999 → #0538CC → #0AA8F8 ramp as the on-screen Statement header. */
function gradientBand(doc: jsPDF, x: number, y: number, w: number, h: number, r = 8) {
  const [r1, g1, b1] = C.brandDark;
  const [r2, g2, b2] = C.brandMid;
  const [r3, g3, b3] = C.brandLight;
  doc.saveGraphicsState();
  // Clip to the rounded rect so the slices can't spill past the corners.
  doc.roundedRect(x, y, w, h, r, r, null as unknown as string);
  doc.clip();
  doc.discardPath();
  const steps = Math.max(1, Math.ceil(w));
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1 || 1);
    // Two-leg ramp: dark → mid over the first half, mid → light over the second.
    const [cr, cg, cb] = t < 0.5
      ? [r1 + (r2 - r1) * (t / 0.5), g1 + (g2 - g1) * (t / 0.5), b1 + (b2 - b1) * (t / 0.5)]
      : [r2 + (r3 - r2) * ((t - 0.5) / 0.5), g2 + (g3 - g2) * ((t - 0.5) / 0.5), b2 + (b3 - b2) * ((t - 0.5) / 0.5)];
    doc.setFillColor(cr, cg, cb);
    doc.rect(x + i, y, 1.5, h, 'F');
  }
  doc.restoreGraphicsState();
}

/** A small filled pill with a leading dot — the PDF twin of StatusPill. */
function statusPill(doc: jsPDF, label: string, x: number, y: number, bg: [number, number, number], fg: [number, number, number], dot: [number, number, number]) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  const w = doc.getTextWidth(label) + 20;
  const h = 14;
  doc.setFillColor(...bg);
  doc.roundedRect(x, y, w, h, 7, 7, 'F');
  doc.setFillColor(...dot);
  doc.circle(x + 8, y + h / 2, 2, 'F');
  doc.setTextColor(...fg);
  doc.text(label, x + 14, y + h / 2 + 2.6);
  return w;
}

function safeCurrency(val: string): string {
  return val.replace(/₹/g, 'Rs.');
}

function safeValue(val: string | number): string {
  return safeCurrency(String(val));
}

/** Pack detail fields into 4-column rows: Label | Value | Label | Value. */
function detailRows(fields: ReportSummaryItem[]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const a = fields[i];
    const b = fields[i + 1];
    rows.push([
      a?.label ?? '',
      a ? safeValue(a.value) : '',
      b?.label ?? '',
      b ? safeValue(b.value) : '',
    ]);
  }
  return rows;
}

export function buildLedgerReportPDF(p: ReportParams): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 40;
  const title = p.documentTitle ?? 'Payment Schedule';

  const contentW = pageWidth - margin * 2;

  // ── Brand header band — the printed twin of the Statement tab's gradient
  // header: title + loan type on the left, borrower + loan number on the right.
  const bandH = 74;
  gradientBand(doc, margin, y, contentW, bandH, 10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...C.white);
  doc.text(title, margin + 18, y + 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`${p.loanTypeLabel}  ·  Loan date ${p.loanDate}`, margin + 18, y + 45);
  // Right side: borrower identity.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(p.customerName, pageWidth - margin - 18, y + 28, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${p.loanNumber}  ·  ${p.customerMobile}`, pageWidth - margin - 18, y + 45, { align: 'right' });
  // Generated stamp, bottom-right inside the band.
  doc.setFontSize(7.5);
  doc.text(
    `Generated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
    pageWidth - margin - 18, y + 62, { align: 'right' },
  );
  y += bandH + 16;

  // Borrower / loan detail grid (Statement tab two-column fields)
  if (p.detailFields && p.detailFields.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      body: detailRows(p.detailFields),
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: { top: 4, bottom: 4, left: 6, right: 6 } },
      columnStyles: {
        0: { cellWidth: 95, textColor: [100, 116, 139], fontStyle: 'bold', fontSize: 8 },
        1: { cellWidth: (pageWidth - margin * 2) / 2 - 95, textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 9.5 },
        2: { cellWidth: 95, textColor: [100, 116, 139], fontStyle: 'bold', fontSize: 8 },
        3: { cellWidth: (pageWidth - margin * 2) / 2 - 95, textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 9.5 },
      },
    });
    // @ts-expect-error lastAutoTable is attached by the plugin at runtime
    y = doc.lastAutoTable.finalY + 14;
  }

  // ── Key-figure cards — the Statement tab's four tinted tiles, drawn as real
  // cards rather than a bare label/value grid.
  if (p.summary.length) {
    const n = p.summary.length;
    const gap = 8;
    const cardW = (contentW - gap * (n - 1)) / n;
    const cardH = 44;
    p.summary.forEach((s, i) => {
      const cx = margin + i * (cardW + gap);
      doc.setFillColor(...C.tintBg);
      doc.setDrawColor(...C.hair);
      doc.setLineWidth(0.5);
      doc.roundedRect(cx, y, cardW, cardH, 6, 6, 'FD');
      // Accent rule at the top edge of each card.
      doc.setFillColor(...C.brandMid);
      doc.rect(cx + 8, y, Math.min(26, cardW - 16), 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(...C.muted);
      doc.text(s.label.toUpperCase(), cx + 8, y + 18, { maxWidth: cardW - 16 });
      doc.setFontSize(11);
      doc.setTextColor(...C.ink);
      doc.text(safeValue(s.value), cx + 8, y + 34, { maxWidth: cardW - 16 });
    });
    y += cardH + 18;
  }

  // ── Progress line (instalments / cycles funded) ──
  if (p.progress && p.progress.total > 0) {
    const { label, paid, total } = p.progress;
    const pct = Math.max(0, Math.min(1, paid / total));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(`${label.toUpperCase()}  ${paid} / ${total}`, margin, y);
    const barY = y + 6;
    doc.setFillColor(...C.hair);
    doc.roundedRect(margin, barY, contentW, 6, 3, 3, 'F');
    if (pct > 0) {
      doc.setFillColor(...C.emerald);
      doc.roundedRect(margin, barY, Math.max(6, contentW * pct), 6, 3, 3, 'F');
    }
    y = barY + 20;
  }

  // ── Schedule table ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...C.ink);
  doc.text(p.tableTitle, margin, y);
  y += 12;

  // Status column is colour-coded exactly like the on-screen StatusPill.
  const statusCol = p.tableHead.findIndex((h) => h.trim().toLowerCase() === 'status');

  // ── Totals row ───────────────────────────────────────────────────────────
  // Sum only the ADDITIVE money columns. Opening / Closing are running
  // BALANCES — adding them up produces a meaningless number, so they are left
  // blank rather than printed as a false total.
  const SUMMABLE = new Set(['instalment', 'principal', 'interest', 'amount', 'daily due', 'monthly due', 'interest due', 'amount due', 'paid', 'collected']);
  const parseMoney = (v: string | number): number | null => {
    const s = String(v).replace(/rs\.?|₹|,|\s/gi, '');
    if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  };
  const totalCols = p.tableHead
    .map((h, i) => ({ i, key: h.trim().toLowerCase() }))
    .filter(({ key }) => SUMMABLE.has(key))
    .map(({ i }) => i);
  const totalsRow: string[] | null = totalCols.length
    ? p.tableHead.map((_, i) => {
      if (i === 0) return 'TOTAL';
      if (!totalCols.includes(i)) return '';
      let sum = 0; let seen = false;
      for (const row of p.tableBody) {
        const n = parseMoney(row[i]);
        if (n != null) { sum += n; seen = true; }
      }
      return seen ? `Rs.${sum.toLocaleString('en-IN')}` : '';
    })
    : null;
  const toneFor = (v: string): { bg: [number, number, number]; fg: [number, number, number] } | null => {
    const s = v.trim().toLowerCase();
    if (s === 'paid' || s === 'settled' || s === 'foreclosed') return { bg: C.emeraldBg, fg: C.emeraldInk };
    if (s === 'overdue') return { bg: C.redBg, fg: C.redInk };
    if (s === 'partial') return { bg: C.amberBg, fg: C.amberInk };
    return null;
  };

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 44 },
    head: [p.tableHead],
    body: p.tableBody.map((row) => row.map(safeValue)),
    foot: totalsRow ? [totalsRow] : undefined,
    showFoot: totalsRow ? 'lastPage' : 'never', // totals belong at the very end, not on every page
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 5, lineColor: C.hair, lineWidth: 0.5, textColor: C.ink },
    headStyles: { fillColor: C.brandDark, textColor: C.white, fontStyle: 'bold', fontSize: 8, cellPadding: 6 },
    footStyles: { fillColor: C.tintBg, textColor: C.ink, fontStyle: 'bold', fontSize: 8.5, cellPadding: 6, lineColor: C.hair, lineWidth: 0.5 },
    alternateRowStyles: { fillColor: C.tintBg },
    columnStyles: statusCol >= 0 ? { [statusCol]: { halign: 'center', fontStyle: 'bold' } } : undefined,
    didParseCell: (data) => {
      // Totals row: right-align the summed money cells, keep the TOTAL label left.
      if (data.section === 'foot') {
        if (totalCols.includes(data.column.index)) data.cell.styles.halign = 'right';
        return;
      }
      if (data.section !== 'body' || data.column.index !== statusCol) return;
      const tone = toneFor(String(data.cell.raw ?? ''));
      if (tone) {
        data.cell.styles.fillColor = tone.bg;
        data.cell.styles.textColor = tone.fg;
      }
    },
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight();
      // Footer rule + confidentiality note + page number.
      doc.setDrawColor(...C.hair);
      doc.setLineWidth(0.5);
      doc.line(margin, h - 30, pageWidth - margin, h - 30);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...C.faint);
      doc.text(`${title} — Confidential`, margin, h - 16);
      doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - margin, h - 16, { align: 'right' });
    },
  });

  return doc;
}

/** A portfolio-wide dataset report (Customers / Loans / Collections / Expenses):
 *  title band, an optional KPI summary strip, and one wide multi-page table.
 *  Kept separate from buildLedgerReportPDF (per-loan) so neither disturbs the
 *  other. Column alignment is per-column so money/counts sit right-aligned. */
export interface DatasetReportParams {
  title: string;                 // e.g. "Loans Report"
  subtitle: string;              // e.g. "All time · 42 loans"
  summary?: ReportSummaryItem[]; // optional KPI strip
  tableHead: string[];
  tableBody: (string | number)[][];
  rightAlignCols?: number[];     // 0-based column indices to right-align (money/counts)
}

export function buildDatasetReportPDF(p: DatasetReportParams): jsPDF {
  // Landscape A4 — dataset tables are wide.
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = 38;

  // Generated stamp (right)
  const genStamp = `Generated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(148, 163, 184);
  doc.text(genStamp, pageWidth - margin, y, { align: 'right' });

  // Title + subtitle (left)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(p.title, margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(p.subtitle, margin, y + 16);
  y += 34;

  // Optional KPI summary strip (label row + value row)
  if (p.summary && p.summary.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      body: [
        p.summary.map((s) => s.label),
        p.summary.map((s) => safeValue(s.value)),
      ],
      theme: 'plain',
      styles: { fontSize: 8.5, cellPadding: { top: 3, bottom: 1, left: 6, right: 6 } },
      didParseCell: (data) => {
        if (data.row.index === 1) { data.cell.styles.textColor = [15, 23, 42]; data.cell.styles.fontStyle = 'bold'; data.cell.styles.fontSize = 11; }
        else { data.cell.styles.textColor = [100, 116, 139]; data.cell.styles.fontStyle = 'normal'; data.cell.styles.fontSize = 7.5; }
      },
    });
    // @ts-expect-error lastAutoTable is attached by the plugin at runtime
    y = doc.lastAutoTable.finalY + 14;
  }

  const rightCols = new Set(p.rightAlignCols ?? []);
  // Totals for the money columns the caller flagged as right-aligned. A column
  // whose cells aren't parseable numbers (e.g. a mode/status column) is skipped
  // rather than printed as 0.
  const parseAmt = (v: string | number): number | null => {
    const s = String(v).replace(/rs\.?|₹|,|\s/gi, '');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  };
  const sumCols = [...rightCols].filter((i) => p.tableBody.some((r) => parseAmt(r[i]) != null));
  const datasetTotals: string[] | null = sumCols.length
    ? p.tableHead.map((_, i) => {
      if (i === 0) return `TOTAL · ${p.tableBody.length} ${p.tableBody.length === 1 ? 'record' : 'records'}`;
      if (!sumCols.includes(i)) return '';
      const sum = p.tableBody.reduce((s, r) => s + (parseAmt(r[i]) ?? 0), 0);
      return `Rs.${sum.toLocaleString('en-IN')}`;
    })
    : null;
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 34 },
    head: [p.tableHead],
    body: p.tableBody.map((row) => row.map(safeValue)),
    foot: datasetTotals ? [datasetTotals] : undefined,
    showFoot: datasetTotals ? 'lastPage' : 'never',
    theme: 'grid',
    styles: { fontSize: 7.8, cellPadding: 4.5, lineColor: [226, 232, 240], lineWidth: 0.5, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 8.2, cellPadding: 5, lineColor: [226, 232, 240], lineWidth: 0.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didParseCell: (data) => {
      if (rightCols.has(data.column.index)) data.cell.styles.halign = 'right';
    },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - margin, pageHeight - 14, { align: 'right' });
      doc.text('Anush Finserv — Confidential', margin, pageHeight - 14);
    },
  });

  return doc;
}

/** One unpaid instalment on an overdue notice. */
export interface OverdueRow {
  label: string;   // e.g. "Day 12" / "Month 3"
  dueDate: string; // already formatted for display
  amount: string;  // already formatted (e.g. "₹1,000")
  paid?: string;   // part-payment already received, if any
}

export interface OverdueNoticeParams {
  customerName: string;
  customerMobile: string;
  loanNumber: string;
  loanTypeLabel: string;
  loanDate: string;
  /** The unpaid instalments, oldest first. */
  rows: OverdueRow[];
  /** Total unpaid, already formatted. */
  totalDue: string;
  /** Oldest unpaid due date, and how late it is. */
  dueSince: string;
  daysOverdue: number;
  /** Optional contact line for the footer. */
  contactLine?: string;
}

/**
 * A focused one-page OVERDUE NOTICE for sending to a customer — not an account
 * history. It answers only: who, which loan, which instalments are unpaid, and
 * the total. Uses the same brand band and palette as the statement so the two
 * documents are recognisably from the same business.
 */
export function buildOverdueNoticePDF(p: OverdueNoticeParams): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  const contentW = pageWidth - margin * 2;
  let y = 40;

  // ── Brand header band ──
  const bandH = 74;
  gradientBand(doc, margin, y, contentW, bandH, 10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...C.white);
  doc.text('Payment Reminder', margin + 18, y + 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`${p.loanTypeLabel}  ·  Loan date ${p.loanDate}`, margin + 18, y + 45);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(p.customerName, pageWidth - margin - 18, y + 28, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${p.loanNumber}  ·  ${p.customerMobile}`, pageWidth - margin - 18, y + 45, { align: 'right' });
  doc.setFontSize(7.5);
  doc.text(
    `Issued ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    pageWidth - margin - 18, y + 62, { align: 'right' },
  );
  y += bandH + 18;

  // ── The headline: amount due, in a red callout. This is the one number the
  // reader must not miss, so it gets its own block rather than a table cell.
  const calloutH = 58;
  doc.setFillColor(...C.redBg);
  doc.setDrawColor(...C.red);
  doc.setLineWidth(0.8);
  doc.roundedRect(margin, y, contentW, calloutH, 8, 8, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.redInk);
  doc.text('TOTAL AMOUNT DUE', margin + 16, y + 20);
  doc.setFontSize(22);
  doc.text(safeCurrency(p.totalDue), margin + 16, y + 44);
  // Right side: how late, so urgency is explicit.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...C.redInk);
  doc.text(`Overdue since ${p.dueSince}`, pageWidth - margin - 16, y + 26, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`${p.daysOverdue} ${p.daysOverdue === 1 ? 'day' : 'days'} late`,
    pageWidth - margin - 16, y + 44, { align: 'right' });
  y += calloutH + 20;

  // ── Unpaid instalments ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...C.ink);
  doc.text('Pending instalments', margin, y);
  y += 10;

  const showPaidCol = p.rows.some((r) => r.paid);
  const head = showPaidCol
    ? [['#', 'Due Date', 'Instalment', 'Paid', 'Pending']]
    : [['#', 'Due Date', 'Amount Due']];
  const body = p.rows.map((r) => (showPaidCol
    ? [r.label, r.dueDate, safeValue(r.amount), safeValue(r.paid ?? '—'), safeValue(r.amount)]
    : [r.label, r.dueDate, safeValue(r.amount)]));

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 60 },
    head,
    body,
    foot: [showPaidCol
      ? ['', '', '', 'TOTAL', safeCurrency(p.totalDue)]
      : ['', '', safeCurrency(p.totalDue)]],
    showFoot: 'lastPage',
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 6, lineColor: C.hair, lineWidth: 0.5, textColor: C.ink },
    headStyles: { fillColor: C.brandDark, textColor: C.white, fontStyle: 'bold', fontSize: 8.5 },
    footStyles: { fillColor: C.redBg, textColor: C.redInk, fontStyle: 'bold', fontSize: 10 },
    alternateRowStyles: { fillColor: C.tintBg },
    columnStyles: showPaidCol
      ? { 0: { cellWidth: 60 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }
      : { 0: { cellWidth: 60 }, 2: { halign: 'right' } },
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight();
      // Closing note + footer rule.
      doc.setDrawColor(...C.hair);
      doc.setLineWidth(0.5);
      doc.line(margin, h - 52, pageWidth - margin, h - 52);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...C.muted);
      doc.text('Kindly clear the dues at the earliest. Please ignore this notice if payment has already been made.',
        margin, h - 36);
      if (p.contactLine) doc.text(p.contactLine, margin, h - 24);
      doc.setFontSize(8);
      doc.setTextColor(...C.faint);
      doc.text('Payment Reminder — Confidential', margin, h - 12);
      doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - margin, h - 12, { align: 'right' });
    },
  });

  return doc;
}

/** Save straight to the device — no share sheet, no extra tap. Used by
 *  "Generate Statement", where the expectation is simply "I get the PDF".
 *  (shareOrDownloadPDF below is kept for the Reports exports, which benefit
 *  from the share sheet on mobile.) */
export function downloadPDF(doc: jsPDF, filename: string): void {
  doc.save(filename);
}

/** Turn a person's name into a filename-safe token: "R. Kumar (Jr)" → "R-Kumar-Jr".
 *  Strips characters Windows/macOS reject in filenames, collapses runs of
 *  separators, and caps the length so the full name can never blow past the
 *  OS filename limit. Returns '' when nothing usable is left. */
export function fileNamePart(raw: string, max = 40): string {
  return (raw ?? '')
    .normalize('NFC') // NFC, not NFKD: keeps Indic vowel marks attached to their letter
    // Keep letters, numbers and combining marks (\p{M} — Kannada/Devanagari
    // matras); replace everything else, including / \ : * ? " < > |, with a gap.
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, ' ')
    .trim()
    .replace(/[\s-]+/g, '-')
    .slice(0, max)
    .replace(/^-+|-+$/g, '');
}

/** Share the PDF via the OS share sheet (WhatsApp, email, …) AND keep a copy in
 *  Downloads. Sharing without saving loses the document if the user cancels or
 *  the target app fails, so the download always happens. Returns what the share
 *  attempt did, so the caller can word its toast honestly. */
export async function sharePDF(doc: jsPDF, filename: string): Promise<'shared' | 'unsupported' | 'cancelled'> {
  const blob = doc.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string }) => Promise<void>;
  };
  if (!nav.share || !nav.canShare || !nav.canShare({ files: [file] })) {
    doc.save(filename); // no share support (most desktops) — at least save it
    return 'unsupported';
  }
  try {
    await nav.share({ files: [file], title: filename });
    return 'shared';
  } catch (e) {
    // AbortError = the user dismissed the sheet; anything else is a real failure.
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    doc.save(filename);
    return 'unsupported';
  }
}

export async function shareOrDownloadPDF(doc: jsPDF, filename: string): Promise<'shared' | 'downloaded'> {
  try {
    const blob = doc.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean; share?: (data: { files: File[]; title?: string }) => Promise<void> };
    if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch {
    // fall through to download
  }
  doc.save(filename);
  return 'downloaded';
}
