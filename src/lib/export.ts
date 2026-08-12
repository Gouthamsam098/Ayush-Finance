/**
 * Utilities for exporting data to downloadable file formats.
 * Currently supports CSV with proper escaping and Excel-compatible UTF-8 BOM.
 */

/** Escape a single CSV field — wrap in quotes if it contains commas, newlines, or quotes. */
function csvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Escape a numeric CSV field — numbers don't need quoting unless they're empty. */
function csvNumber(value: number | string): string {
  if (value === '' || value === null || value === undefined) return '';
  return String(value);
}

/**
 * Build a CSV string from a header row and data rows.
 * Prepends a UTF-8 BOM so Excel opens it correctly with non-ASCII characters.
 */
export function buildCSV(headers: string[], rows: (string | number)[][]): string {
  const BOM = '\uFEFF';
  const headerLine = headers.map(csvField).join(',');
  const dataLines = rows.map((row) =>
    row.map((cell) => csvField(String(cell ?? ''))).join(','),
  );
  return BOM + [headerLine, ...dataLines].join('\n');
}

/**
 * Trigger a file download in the browser.
 * Creates a temporary anchor element, clicks it, and cleans up.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate and download a CSV file in one call.
 */
export function downloadCSV(headers: string[], rows: (string | number)[][], filename: string): void {
  const csv = buildCSV(headers, rows);
  downloadFile(csv, filename, 'text/csv;charset=utf-8;');
}
