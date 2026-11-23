// 构建：esbuild 打包 JS（含 svgo）+ 4 个 WASM base64 内联 -> 单文件 HTML
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const nm = resolve(root, 'node_modules');

const wasmFiles = {
  mozjpeg_enc: resolve(nm, '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'),
  mozjpeg_dec: resolve(nm, '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
  squoosh_png: resolve(nm, '@jsquash/png/codec/pkg/squoosh_png_bg.wasm'),
  squoosh_oxipng: resolve(nm, '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm'),
};

function b64(p) {
  return readFileSync(p).toString('base64');
}

const wasmTable = Object.fromEntries(
  Object.entries(wasmFiles).map(([k, p]) => [k, b64(p)])
);

// 压缩管线单独打包为 ES module Worker 源码，主线程不直接跑 WASM
const workerResult = await build({
  entryPoints: [resolve(root, 'src/worker.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  write: false,
  legalComments: 'none',
  define: { 'import.meta.url': '"https://localhost/"' },
});
const workerSource = workerResult.outputFiles[0].text;
const wasmPrelude = `globalThis.__RECOMPRESSOR_WASM__=${JSON.stringify(wasmTable)};globalThis.__RECOMPRESSOR_WORKER_SOURCE__=${JSON.stringify(workerSource)};`;

const result = await build({
  entryPoints: [resolve(root, 'src/app.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  write: false,
  legalComments: 'none',
});
const js = wasmPrelude + result.outputFiles[0].text;

let html = readFileSync(resolve(root, 'index.html'), 'utf8');
const bgPath = resolve(root, 'assets/terminal-bg.jpg');
const iconPath = resolve(root, 'assets/app-icon.png');
const bgValue = existsSync(bgPath)
  ? `url("data:image/jpeg;base64,${b64(bgPath)}")`
  : 'none';
const iconValue = existsSync(iconPath)
  ? `data:image/png;base64,${b64(iconPath)}`
  : '';
html = html.replaceAll('__TERMINAL_BG_DATA__', bgValue);
html = html.replaceAll('__APP_ICON_DATA__', iconValue);
if (html.includes('__TERMINAL_BG_DATA__') || html.includes('__APP_ICON_DATA__')) {
  throw new Error('界面素材占位符未完全替换');
}
const tag = '<script type="module" src="./src/app.js"></script>';
if (!html.includes(tag)) throw new Error('未找到源模块标签: ' + tag);
// 用函数返回替换串，避免 JS 内容里的 $& $` 等被 String.replace 当特殊模式展开
// 转义内联 JS 中可能提前闭合 <script> 的字面量
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');
html = html.replace(tag, () => `<script type="module">${safeJs}</script>`);
console.log('已内联打包脚本(ESM)');

const out = resolve(root, 'dist', '图片压缩器.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html, 'utf8');
const pages = resolve(root, 'docs', 'index.html');
mkdirSync(dirname(pages), { recursive: true });
writeFileSync(pages, html, 'utf8');
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log('已生成: ' + out + '  (' + kb + ' KB)');
