import { describe, it, expect } from 'vitest';
import zlib from 'zlib';
import { buildXlsx, buildZip, columnLetter, sheetNames, XLSX_MAX_CELL_CHARS } from '../main/xlsx-writer';

/** Read a ZIP built by buildZip back into name -> content, checking each CRC on the way. */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(0);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    expect(buf.readUInt32LE(localOffset)).toBe(0x04034b50);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const data = zlib.inflateRawSync(buf.subarray(dataStart, dataStart + compressedSize));
    expect(data.length).toBe(size);
    expect(zlib.crc32(data) >>> 0).toBe(crc);
    out.set(name, data.toString('utf8'));
    p += 46 + nameLen;
  }
  return out;
}

describe('buildZip', () => {
  it('round-trips entries with valid sizes and checksums', () => {
    const files = unzip(buildZip([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: 'dir/b.txt', data: Buffer.from('x'.repeat(5000)) },
    ]));
    expect(files.get('a.txt')).toBe('hello');
    expect(files.get('dir/b.txt')).toHaveLength(5000);
  });
});

describe('columnLetter', () => {
  it('maps indexes to spreadsheet columns', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});

describe('sheetNames', () => {
  it('strips forbidden characters, trims to 31 characters and keeps names unique', () => {
    const names = sheetNames(['inlinks/to:4xx', 'Pages', 'pages', '', 'x'.repeat(40), 'x'.repeat(40)]);
    expect(names[0]).toBe('inlinks to 4xx');
    expect(names[1]).toBe('Pages');
    expect(names[2]).toBe('pages (2)');
    expect(names[3]).toBe('Sheet4');
    expect(names[4]).toHaveLength(31);
    expect(names[5]).toHaveLength(31);
    expect(new Set(names.map(n => n.toLowerCase())).size).toBe(names.length);
  });
});

describe('buildXlsx', () => {
  it('writes the parts a spreadsheet app needs, one worksheet per sheet', () => {
    const files = unzip(buildXlsx([
      { name: 'Pages', rows: [{ url: 'https://a.test/', status_code: 200 }] },
      { name: 'Links', rows: [{ source: 'https://a.test/', target: 'https://b.test/' }] },
    ]));
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Pages" sheetId="1" r:id="rId1"/>');
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Links" sheetId="2" r:id="rId2"/>');
    expect(files.get('[Content_Types].xml')).toContain('/xl/worksheets/sheet2.xml');
  });

  it('types numbers as numbers and everything else as text, with a bold header row', () => {
    const sheet = unzip(buildXlsx([{ name: 'S', rows: [{ url: 'https://a.test/', words: 1234, ok: true, empty: '', missing: null }] }]))
      .get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">url</t></is></c>');
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">https://a.test/</t></is></c>');
    expect(sheet).toContain('<c r="B2"><v>1234</v></c>');
    expect(sheet).toContain('<c r="C2" t="b"><v>1</v></c>');
    expect(sheet).not.toContain('r="D2"');
    expect(sheet).not.toContain('r="E2"');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:E2"/>');
  });

  it('keeps a formula-looking value as plain text and escapes markup', () => {
    const sheet = unzip(buildXlsx([{ name: 'S', rows: [{ title: '=HYPERLINK("http://evil.test")', h1: 'Tom & <b>Jerry</b>\u0001' }] }]))
      .get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;http://evil.test&quot;)</t>');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;</t>');
  });

  it('includes columns that only later rows have, and caps a cell at the Excel limit', () => {
    const sheet = unzip(buildXlsx([{ name: 'S', rows: [{ a: 1 }, { a: 2, b: 'y'.repeat(XLSX_MAX_CELL_CHARS + 50) }] }]))
      .get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="B1" s="1" t="inlineStr">');
    const cell = sheet.match(/<c r="B3"[^>]*><is><t[^>]*>(y+)<\/t>/);
    expect(cell?.[1]).toHaveLength(XLSX_MAX_CELL_CHARS);
  });

  it('still produces a valid workbook with no sheets or no rows', () => {
    expect(unzip(buildXlsx([])).has('xl/worksheets/sheet1.xml')).toBe(true);
    const empty = unzip(buildXlsx([{ name: 'Empty', rows: [] }])).get('xl/worksheets/sheet1.xml')!;
    expect(empty).toContain('<sheetData></sheetData>');
    expect(empty).not.toContain('autoFilter');
  });
});
