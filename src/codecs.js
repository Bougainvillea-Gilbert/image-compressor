// WASM 编解码器封装：.wasm 以 base64 内联进单文件，file:// 下也能实例化。
// 直接用 jsquash 底层 wasm-bindgen/emscripten 模块，绕过 wrapper 的 ESM/CJS 互操作问题。
import encFactory from '@jsquash/jpeg/codec/enc/mozjpeg_enc.js';
import decFactory from '@jsquash/jpeg/codec/dec/mozjpeg_dec.js';
import * as pngPkg from '@jsquash/png/codec/pkg/squoosh_png.js';
import * as oxiPkg from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js';
import { optimize as svgoOptimize } from 'svgo/browser';

function wasmSource(key) {
  // 每次读取全局表：Worker 在收到主线程发来的预编译 Module 或 base64 数据后才初始化
  const table = globalThis.__RECOMPRESSOR_WASM__ || {};
  const entry = table[key];
  if (!entry) throw new Error('缺少内联 WASM: ' + key);
  if (entry instanceof WebAssembly.Module) return entry;
  if (entry instanceof ArrayBuffer) return entry;
  if (ArrayBuffer.isView(entry)) return entry;
  const bin = atob(entry);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a.buffer;
}

// emscripten 模块：优先复用预编译 WebAssembly.Module，杜绝自动 fetch
async function emscripten(factory, key) {
  const src = wasmSource(key);
  const mod = src instanceof WebAssembly.Module ? src : await WebAssembly.compile(src);
  return factory({
    noInitialRun: true,
    instantiateWasm(imports, callback) {
      const instance = new WebAssembly.Instance(mod, imports);
      callback(instance);
      return instance.exports;
    },
  });
}

let ready = null;
export async function initCodecs() {
  if (ready) return ready;
  ready = (async () => {
    const [jpegEnc, jpegDec] = await Promise.all([
      emscripten(encFactory, 'mozjpeg_enc'),
      emscripten(decFactory, 'mozjpeg_dec'),
      pngPkg.default(wasmSource('squoosh_png')),      // wasm-bindgen：支持 Module 或 bytes
      oxiPkg.default(wasmSource('squoosh_oxipng')),
    ]);
    return {
      jpegEnc,
      jpegDec,
      pngDecode: (b) => pngPkg.decode(new Uint8Array(b)),              // 单参数 JS 包装
      oxiOptimiseRaw: (data, w, h, level) =>
        oxiPkg.optimise_raw(data, w, h, level, false, true),
    };
  })();
  return ready;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer || value);
}

// ---- JPG：MozJPEG 多档质量 ----
export async function compressJpeg(imageData, quality) {
  const c = await initCodecs();
  const result = c.jpegEnc.encode(imageData.data, imageData.width, imageData.height, {
    quality,
    baseline: false,
    arithmetic: false,
    progressive: true,
    optimize_coding: true,
    smoothing: 0,
    color_space: 2, // YCbCr
    quant_table: 3,
    trellis_multipass: false,
    trellis_opt_zero: false,
    trellis_opt_table: false,
    trellis_loops: 1,
    auto_subsample: true,
    chroma_subsample: 2,
    separate_chroma_quality: false,
    chroma_quality: 75,
  });
  return asBytes(result);
}

export async function decodeJpeg(buffer) {
  const c = await initCodecs();
  return c.jpegDec.decode(new Uint8Array(buffer), false);
}

export async function decodePng(buffer) {
  const c = await initCodecs();
  return c.pngDecode(buffer);
}

// ---- PNG：先减色量化（有损档）再交给 OxiPNG 无损重压 ----
export async function compressPng(imageData, level, quantized) {
  const c = await initCodecs();
  const source = quantized || imageData;
  const out = c.oxiOptimiseRaw(
    source.data, source.width, source.height, level
  );
  return asBytes(out);
}

// ---- SVG：SVGO 清理（浏览器版）----
export async function compressSvg(svgText, options = {}) {
  const plugins = [
    'removeDoctype', 'removeXMLProcInst', 'removeComments',
    'removeMetadata', 'removeEditorsNSData', 'cleanupAttrs',
    'mergeStyles', 'inlineStyles', 'minifyStyles', 'cleanupIds',
    'removeUselessDefs', 'cleanupNumericValues',
    'convertColors', 'removeUnknownsAndDefaults',
    'removeNonInheritableGroupAttrs', 'removeUselessStrokeAndFill',
    'cleanupEnableBackground',
    'removeHiddenElems', 'removeEmptyText', 'convertShapeToPath',
    'convertEllipseToCircle', 'moveElemsAttrsToGroup',
    'moveGroupAttrsToElems', 'collapseGroups',
    'convertPathData', 'convertTransform',
    'removeEmptyAttrs', 'removeEmptyContainers',
    'mergePaths', 'sortDefsChildren', 'sortAttrs',
  ];
  const dimensionNames = ['width', 'height', 'viewBox'];
  const dimensions = {};
  const rootDimensionsPlugin = (name, update) => ({
    name,
    fn: () => ({
      element: {
        enter(node, parent) {
          if (parent.type === 'root' && node.name === 'svg') {
            for (const key of dimensionNames) update(node.attributes, key);
          }
        },
      },
    }),
  });
  plugins.unshift(rootDimensionsPlugin('readRootDimensions', (attrs, key) => {
    dimensions[key] = attrs[key];
  }));
  plugins.push(rootDimensionsPlugin('restoreRootDimensions', (attrs, key) => {
    if (dimensions[key] === undefined) delete attrs[key];
    else attrs[key] = dimensions[key];
  }));
  const res = svgoOptimize(svgText, {
    multipass: options.multipass || false,
    floatPrecision: options.floatPrecision != null ? options.floatPrecision : 3,
    plugins,
  });
  return res.data;
}

export { svgoOptimize };
