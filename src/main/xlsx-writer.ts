/**
 * Minimal XLSX writer with no dependency: a workbook is a ZIP of a few XML
 * parts, and Node's zlib supplies both the deflate and the CRC-32.
 *
 * Scope is deliberately small: one or more sheets of plain rows, a bold
 * frozen header row, numbers as numbers and everything else as inline text.
 * Text cells are typed as strings, so a value such as "=cmd|..." is shown as
 * text and never evaluated; the CSV formula-injection guard is not needed here.
 */
import zlib from 'zlib';

export interface XlsxSheet {
  name: string;
  rows: Record<string, unknown>[];
}

/** Excel limits: 1,048,576 rows per sheet (one is the header) and 32,767 characters per cell. */
export const XLSX_MAX_DATA_ROWS = 1_048_575;
export const XLSX_MAX_CELL_CHARS = 32_767;
const MAX_SHEET_NAME = 31;

// ─── ZIP container ────────────────────────────────────────────────────────────

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Build a ZIP archive (deflate, no ZIP64: enough for workbooks under 4 GB). */
export function buildZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  // Fixed DOS timestamp (1980-01-01 00:00) keeps output byte-identical for identical input.
  const dosTime = 0;
  const dosDate = 0x21;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const compressed = zlib.deflateRawSync(e.data);
    const crc = zlib.crc32(e.data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

// ─── Workbook parts ───────────────────────────────────────────────────────────

// Characters XML 1.0 forbids in a document.
const XML_ILLEGAL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]', 'g');

function xml(s: string): string {
  return s
    .replace(XML_ILLEGAL, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Sheet names must be 1-31 characters, unique (case-insensitive) and free of
 * [ ] : * ? / \ . A clash gets a numeric suffix.
 */
export function sheetNames(requested: string[]): string[] {
  const used = new Set<string>();
  return requested.map((raw, i) => {
    const cleaned = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim();
    const base = (cleaned || `Sheet${i + 1}`).slice(0, MAX_SHEET_NAME);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = base.slice(0, MAX_SHEET_NAME - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function cell(ref: string, value: unknown, style: number): string {
  if (value === null || value === undefined || value === '') return '';
  const s = style ? ` s="${style}"` : '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = (typeof value === 'object' ? JSON.stringify(value) : String(value)).slice(0, XLSX_MAX_CELL_CHARS);
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function sheetXml(rows: Record<string, unknown>[]): string {
  // Column order: first row's keys, then any key a later row introduces.
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }
  const data = rows.slice(0, XLSX_MAX_DATA_ROWS);
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  ];
  if (keys.length > 0) {
    out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
    // Width from the header and a sample of values, clamped so one long URL column stays readable.
    const sample = data.slice(0, 200);
    out.push('<cols>');
    keys.forEach((k, i) => {
      let w = k.length;
      for (const row of sample) {
        const v = row[k];
        if (v !== null && v !== undefined) w = Math.max(w, String(v).length);
      }
      out.push(`<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(8, w + 2))}" customWidth="1"/>`);
    });
    out.push('</cols>');
  }
  out.push('<sheetData>');
  if (keys.length > 0) {
    out.push(`<row r="1">${keys.map((k, i) => cell(`${columnLetter(i)}1`, k, 1)).join('')}</row>`);
    data.forEach((row, r) => {
      const n = r + 2;
      out.push(`<row r="${n}">${keys.map((k, i) => cell(`${columnLetter(i)}${n}`, row[k], 0)).join('')}</row>`);
    });
  }
  out.push('</sheetData>');
  if (keys.length > 0) {
    out.push(`<autoFilter ref="A1:${columnLetter(keys.length - 1)}${data.length + 1}"/>`);
  }
  out.push('</worksheet>');
  return out.join('');
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Build an .xlsx workbook, one worksheet per entry. An empty list still yields a valid one-sheet workbook. */
export function buildXlsx(sheets: XlsxSheet[]): Buffer {
  const list = sheets.length > 0 ? sheets : [{ name: 'Sheet1', rows: [] }];
  const names = sheetNames(list.map(s => s.name));
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  const contentTypes =
    head +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '</Types>';

  const rootRels =
    head +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbook =
    head +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';

  const workbookRels =
    head +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES_XML, 'utf8') },
    ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(sheetXml(s.rows), 'utf8') })),
  ];
  return buildZip(entries);
}
