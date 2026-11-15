import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  installExamplePlugins,
  listPlugins,
  MAX_PLUGIN_BYTES,
  parsePluginHeader,
  PLUGIN_CSP,
  PLUGIN_RUNTIME_JS,
  pluginIdFromFile,
  pluginPageHtml,
  pluginResponse,
  readPluginCode,
} from '../main/plugins';

const HEADER = `// ==SerpentPlugin==
// @name         Directory breakdown
// @description  Pages per folder
// @version      1.2.0
// @author       Jane
// ==/SerpentPlugin==
`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serpent-plugins-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(file: string, content: string): void {
  fs.writeFileSync(path.join(dir, file), content);
}

describe('pluginIdFromFile', () => {
  it('derives a URL-safe id from a .js file name', () => {
    expect(pluginIdFromFile('directory-breakdown.js')).toBe('directory-breakdown');
    expect(pluginIdFromFile('My Report (v2).JS')).toBe('my-report-v2');
  });

  it('rejects anything that is not a usable .js file', () => {
    expect(pluginIdFromFile('notes.txt')).toBeNull();
    expect(pluginIdFromFile('.hidden.js')).toBeNull();
    expect(pluginIdFromFile('---.js')).toBeNull();
    expect(pluginIdFromFile('plugin.js.bak')).toBeNull();
  });
});

describe('parsePluginHeader', () => {
  it('reads the metadata block', () => {
    expect(parsePluginHeader(HEADER + 'serpent.register({});')).toEqual({
      name: 'Directory breakdown',
      description: 'Pages per folder',
      version: '1.2.0',
      author: 'Jane',
    });
  });

  it('returns nothing without a block and ignores tags outside it', () => {
    expect(parsePluginHeader('// @name Not a header\nserpent.register({});')).toEqual({});
  });
});

describe('listPlugins', () => {
  it('returns an empty list for a folder that does not exist', () => {
    expect(listPlugins(path.join(dir, 'missing'))).toEqual([]);
  });

  it('lists .js files with their metadata and skips everything else', () => {
    write('b-plain.js', 'serpent.register({ render() {} });');
    write('a-described.js', HEADER);
    write('readme.txt', 'not a plugin');
    fs.mkdirSync(path.join(dir, 'folder.js'));
    const list = listPlugins(dir);
    expect(list.map(p => p.id)).toEqual(['a-described', 'b-plain']);
    expect(list[0]).toMatchObject({ file: 'a-described.js', name: 'Directory breakdown', description: 'Pages per folder', version: '1.2.0', author: 'Jane' });
    expect(list[0].error).toBeUndefined();
    expect(list[1]).toMatchObject({ name: 'b-plain', description: '' });
  });

  it('flags a file that is too large and one whose id is already taken', () => {
    write('big.js', 'x'.repeat(MAX_PLUGIN_BYTES + 1));
    write('report.js', HEADER);
    write('Report!.js', HEADER);
    const list = listPlugins(dir);
    expect(list.find(p => p.file === 'big.js')?.error).toMatch(/larger than/);
    const clash = list.filter(p => p.file.toLowerCase().startsWith('report'));
    expect(clash).toHaveLength(2);
    expect(clash.filter(p => p.error).length).toBe(1);
    expect(new Set(list.map(p => p.id)).size).toBe(list.length);
  });
});

describe('readPluginCode', () => {
  it('returns the source of a listed plugin', () => {
    write('one.js', 'serpent.register({ render() {} });');
    expect(readPluginCode(dir, 'one')).toBe('serpent.register({ render() {} });');
  });

  it('cannot be pointed outside the plugins folder or at a broken plugin', () => {
    fs.writeFileSync(path.join(dir, '..', 'serpent-outside-test.js'), 'secret');
    try {
      expect(readPluginCode(dir, '../serpent-outside-test')).toBeNull();
      expect(readPluginCode(dir, 'serpent-outside-test')).toBeNull();
    } finally {
      fs.rmSync(path.join(dir, '..', 'serpent-outside-test.js'), { force: true });
    }
    write('big.js', 'x'.repeat(MAX_PLUGIN_BYTES + 1));
    expect(readPluginCode(dir, 'big')).toBeNull();
  });
});

describe('pluginResponse', () => {
  beforeEach(() => write('one.js', HEADER + 'serpent.register({ render() {} });'));

  it('serves the runtime, the plugin page and the plugin source', () => {
    const runtime = pluginResponse(dir, 'serpent-plugin://plugin/runtime.js');
    expect(runtime).toMatchObject({ status: 200, contentType: 'text/javascript; charset=utf-8' });
    expect(runtime.body).toBe(PLUGIN_RUNTIME_JS);

    const page = pluginResponse(dir, 'serpent-plugin://plugin/one/index.html?v=1');
    expect(page.status).toBe(200);
    expect(page.contentType).toContain('text/html');
    expect(page.body).toContain('serpent-plugin://plugin/runtime.js');
    expect(page.body).toContain('serpent-plugin://plugin/one/plugin.js');

    const code = pluginResponse(dir, 'serpent-plugin://plugin/one/plugin.js');
    expect(code.status).toBe(200);
    expect(code.body).toContain('serpent.register');
  });

  it('answers 404 for unknown plugins, other hosts, traversal and stray resources', () => {
    for (const url of [
      'serpent-plugin://plugin/nope/index.html',
      'serpent-plugin://plugin/one/other.js',
      'serpent-plugin://other/one/index.html',
      'serpent-plugin://plugin/..%2F..%2Fsecret/plugin.js',
      'serpent-plugin://plugin/one/../../x/plugin.js',
      'https://plugin/one/index.html',
      'not a url',
    ]) {
      expect(pluginResponse(dir, url).status, url).toBe(404);
    }
  });
});

describe('the plugin page', () => {
  const info = { id: 'one', file: 'one.js', name: 'A <b>"name"</b>', description: '', version: '', author: '', mtimeMs: 5 };

  it('allows no network and no inline script', () => {
    expect(PLUGIN_CSP).toContain("default-src 'none'");
    expect(PLUGIN_CSP).toContain('script-src serpent-plugin:');
    expect(PLUGIN_CSP).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(PLUGIN_CSP).not.toMatch(/connect-src|https?:/);
    const html = pluginPageHtml(info);
    expect(html).toContain(`content="${PLUGIN_CSP}"`);
    // Every <script> is an external file from the plugin scheme.
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts).toHaveLength(2);
    expect(scripts.every(s => s.includes('src="serpent-plugin://plugin/'))).toBe(true);
  });

  it('escapes the plugin name', () => {
    expect(pluginPageHtml(info)).toContain('<title>A &lt;b&gt;&quot;name&quot;&lt;/b&gt;</title>');
  });

  it('ships a runtime that parses and exposes serpent.register', () => {
    expect(() => new Function(PLUGIN_RUNTIME_JS)).not.toThrow();
    expect(PLUGIN_RUNTIME_JS).toContain('window.serpent');
    expect(PLUGIN_RUNTIME_JS).toContain("type: 'serpent:ready'");
  });
});

describe('installExamplePlugins', () => {
  it('copies the bundled examples once and never overwrites a file', () => {
    const examples = path.join(dir, 'examples');
    const target = path.join(dir, 'user');
    fs.mkdirSync(examples);
    fs.writeFileSync(path.join(examples, 'a.js'), 'A');
    fs.writeFileSync(path.join(examples, 'b.js'), 'B');
    fs.writeFileSync(path.join(examples, 'README.md'), 'docs');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'a.js'), 'edited by the user');

    expect(installExamplePlugins(examples, target)).toEqual(['b.js']);
    expect(fs.readFileSync(path.join(target, 'a.js'), 'utf8')).toBe('edited by the user');
    expect(fs.readFileSync(path.join(target, 'b.js'), 'utf8')).toBe('B');
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(false);
    expect(installExamplePlugins(examples, target)).toEqual([]);
  });

  it('ships example plugins that parse and carry a metadata header', () => {
    const shipped = path.resolve(__dirname, '../../resources/plugins');
    const files = fs.readdirSync(shipped).filter(f => f.endsWith('.js'));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const code = fs.readFileSync(path.join(shipped, f), 'utf8');
      expect(parsePluginHeader(code).name, f).toBeTruthy();
      expect(() => new Function('serpent', code), f).not.toThrow();
    }
  });
});
