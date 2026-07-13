import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ReportSummaryItem { label: string; value: string; }
export interface ReportParams {
  loanNumber: string;
  loanTypeLabel: string;
  customerName: string;
  customerMobile: string;
  loanDate: string; // already formatted for display
  summary: ReportSummaryItem[];
  progress?: { label: string; paid: number; total: number };
  tableTitle: string;
  tableHead: string[];
  tableBody: (string | number)[][];
}

/** Builds a clean, print-quality PDF for a loan's collection ledger. */
export function buildLedgerReportPDF(p: ReportParams): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 48;

  // Letterhead
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text('Anush Capitals', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('Loan Management · Collection Ledger Report', margin, y + 14);
  const genStamp = `Generated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  doc.setFontSize(8.5);
  doc.text(genStamp, pageWidth - margin, y, { align: 'right' });
  y += 26;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageWidth - margin, y);
  y += 22;

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(`Collection Ledger · ${p.loanNumber}`, margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(p.loanTypeLabel, margin, y + 14);
  y += 30;

  // Customer info block
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, pageWidth - margin * 2, 46, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(p.customerName, margin + 14, y + 19);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`${p.customerMobile}  ·  ${p.loanNumber}`, margin + 14, y + 33);
  doc.text(`Loan date: ${p.loanDate}`, pageWidth - margin - 14, y + 19, { align: 'right' });
  y += 46 + 20;

  // Summary cards as a compact table
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    body: [p.summary.map((s) => s.label), p.summary.map((s) => s.value)],
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: { top: 3, bottom: 1, left: 6, right: 6 } },
    bodyStyles: { textColor: [100, 116, 139] },
    didParseCell: (data) => {
      if (data.row.index === 1) { data.cell.styles.textColor = [15, 23, 42]; data.cell.styles.fontStyle = 'bold'; data.cell.styles.fontSize = 10.5; }
      else { data.cell.styles.fontStyle = 'normal'; data.cell.styles.fontSize = 7.5; }
    },
    didDrawPage: () => {},
  });
  // @ts-expect-error lastAutoTable is attached by the plugin at runtime
  y = doc.lastAutoTable.finalY + 8;

  if (p.progress) {
    const pct = p.progress.total > 0 ? Math.min(100, Math.round((p.progress.paid / p.progress.total) * 100)) : 0;
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(241, 245, 249);
    const barW = pageWidth - margin * 2;
    doc.roundedRect(margin, y, barW, 8, 4, 4, 'F');
    doc.setFillColor(79, 70, 229);
    doc.roundedRect(margin, y, Math.max(8, (barW * pct) / 100), 8, 4, 4, 'F');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`${p.progress.label}: ${p.progress.paid} / ${p.progress.total}`, margin, y + 20);
    y += 34;
  } else {
    y += 10;
  }

  // Detail table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(p.tableTitle, margin, y);
  y += 10;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 40 },
    head: [p.tableHead],
    body: p.tableBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 5, lineColor: [226, 232, 240], lineWidth: 0.5 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didDrawPage: () => {
      const str = `Page ${doc.getNumberOfPages()}`;
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(str, pageWidth - margin, doc.internal.pageSize.getHeight() - 16, { align: 'right' });
      doc.text('Anush Capitals — Confidential', margin, doc.internal.pageSize.getHeight() - 16);
    },
  });

  return doc;
}

/** Downloads the PDF, or uses the native Share sheet if the browser/device supports sharing files. */
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
