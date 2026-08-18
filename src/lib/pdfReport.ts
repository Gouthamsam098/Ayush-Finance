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

  // Header — date stamp only (right-aligned), no letterhead
  const genStamp = `Generated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(148, 163, 184);
  doc.text(genStamp, pageWidth - margin, y, { align: 'right' });
  y += 22;

  // Title — matches Statement tab "Payment Schedule" band
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(`${title} · ${p.loanNumber}`, margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(p.loanTypeLabel, margin, y + 16);
  y += 34;

  // Customer info block
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, pageWidth - margin * 2, 44, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(p.customerName, margin + 14, y + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`${p.customerMobile}  ·  ${p.loanNumber}`, margin + 14, y + 32);
  doc.text(`Loan date: ${p.loanDate}`, pageWidth - margin - 14, y + 18, { align: 'right' });
  y += 44 + 18;

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

  // Key figures — same four cards as Statement tab
  if (p.summary.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      body: [
        p.summary.map((s) => s.label.toUpperCase()),
        p.summary.map((s) => safeValue(s.value)),
      ],
      theme: 'plain',
      styles: { fontSize: 8.5, cellPadding: { top: 4, bottom: 2, left: 6, right: 6 } },
      bodyStyles: { textColor: [100, 116, 139] },
      didParseCell: (data) => {
        if (data.row.index === 1) { data.cell.styles.textColor = [15, 23, 42]; data.cell.styles.fontStyle = 'bold'; data.cell.styles.fontSize = 11; }
        else { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fontSize = 7; data.cell.styles.textColor = [100, 116, 139]; }
      },
    });
    // @ts-expect-error lastAutoTable is attached by the plugin at runtime
    y = doc.lastAutoTable.finalY + 16;
  }

  // Detail table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(p.tableTitle, margin, y);
  y += 12;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 40 },
    head: [p.tableHead],
    body: p.tableBody.map((row) => row.map(safeValue)),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 5, lineColor: [226, 232, 240], lineWidth: 0.5 },
    headStyles: { fillColor: [2, 41, 153], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didDrawPage: () => {
      const str = `Page ${doc.getNumberOfPages()}`;
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(str, pageWidth - margin, doc.internal.pageSize.getHeight() - 16, { align: 'right' });
      doc.text('Payment Schedule — Confidential', margin, doc.internal.pageSize.getHeight() - 16);
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
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 34 },
    head: [p.tableHead],
    body: p.tableBody.map((row) => row.map(safeValue)),
    theme: 'grid',
    styles: { fontSize: 7.8, cellPadding: 4.5, lineColor: [226, 232, 240], lineWidth: 0.5, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
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
