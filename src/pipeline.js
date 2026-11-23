// 多档压缩 + 目标文件大小压缩（保持像素宽高不变）
import { initCodecs, compressJpeg, compressPng, compressSvg, decodeJpeg, decodePng } from './codecs.js';
import { computeError, quantize } from './metrics.js';
import { fmtSize } from './format.js';

const JPG_QUALITIES = [90, 80, 70, 60, 50, 40, 30, 20];
const PNG_TIERS = [
  { label: '无损', colors: 0, level: 4 },
  { label: '256色', colors: 256, level: 4 },
  { label: '128色', colors: 128, level: 4 },
  { label: '64色', colors: 64, level: 4 },
  { label: '32色', colors: 32, level: 4 },
];
const TARGET_PNG_COLORS = [0, 256, 192, 128, 96, 64, 48, 32, 24, 16, 8, 4, 2];

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function targetError(message) {
  const error = new Error(message);
  error.code = 'TARGET_SIZE_UNREACHABLE';
  return error;
}

function targetBytesOf(options) {
  const n = Number(options && options.targetBytes);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function abortError() {
  const error = new Error('任务已停止');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError();
}

export async function processFile(file, onProgress, options = {}) {
  const name = file.name || 'image';
  const ext = (name.split('.').pop() || '').toLowerCase();
  const originalBytes = file.size;
  const signal = options.signal;
  throwIfAborted(signal);
  const buf = await file.arrayBuffer();
  throwIfAborted(signal);
  const targetBytes = targetBytesOf(options);
  const preferWebp = !!options.preferWebp;

  if (ext === 'svg' || file.type === 'image/svg+xml') {
    return processSvg(name, buf, originalBytes, targetBytes, onProgress, signal);
  }
  if (ext === 'jpg' || ext === 'jpeg' || file.type === 'image/jpeg') {
    return processRaster(name, buf, originalBytes, 'jpg', onProgress, targetBytes, signal, preferWebp);
  }
  if (ext === 'png' || file.type === 'image/png') {
    return processRaster(name, buf, originalBytes, 'png', onProgress, targetBytes, signal, preferWebp);
  }
  throw new Error('暂只支持 JPG / PNG / SVG，收到: ' + (ext || file.type || '未知'));
}

async function processRaster(name, buf, originalBytes, type, onProgress, targetBytes, signal, preferWebp) {
  throwIfAborted(signal);
  const original = type === 'jpg' ? await decodeJpeg(buf) : await decodePng(buf);
  throwIfAborted(signal);
  if (targetBytes) {
    return processRasterTarget(name, buf, originalBytes, type, original, targetBytes, onProgress, signal, preferWebp);
  }

  const variants = [];
  const tiers = type === 'jpg' ? JPG_QUALITIES.map(q => ({ label: 'Q' + q, quality: q })) : PNG_TIERS;
  let idx = 0;
  for (const tier of tiers) {
    throwIfAborted(signal);
    idx++;
    onProgress && onProgress(idx / tiers.length, tier.label);
    let out;
    if (type === 'jpg') {
      out = await compressJpeg(original, tier.quality);
    } else {
      const quantized = tier.colors > 0 ? await quantize(original, tier.colors) : null;
      out = await compressPng(original, tier.level, quantized);
    }
    throwIfAborted(signal);
    variants.push(await makeRasterVariant({
      label: tier.label, out, original, originalBytes, type,
      quality: tier.quality, colors: tier.colors,
    }));
    await yieldToBrowser();
  }

  const recommended = pickRecommended(variants, type);
  return {
    name, type, originalBytes,
    originalSizeText: fmtSize(originalBytes),
    originalUrl: URL.createObjectURL(new Blob([buf], { type: type === 'jpg' ? 'image/jpeg' : 'image/png' })),
    width: original.width,
    height: original.height,
    variants,
    recommended: recommended ? recommended.label : null,
  };
}

async function processRasterTarget(name, buf, originalBytes, type, original, targetBytes, onProgress, signal, preferWebp) {
  throwIfAborted(signal);
  // 原图已经严格小于目标时，不额外损失画质
  if (originalBytes < targetBytes) {
    const variant = makeOriginalRasterVariant(buf, originalBytes, type);
    return targetRasterResult(name, buf, originalBytes, type, original, variant, targetBytes, 0);
  }

  if (preferWebp) {
    try {
      const webp = await processWebpTarget(original, originalBytes, targetBytes, onProgress, signal);
      if (webp) {
        return targetRasterResult(name, buf, originalBytes, type, original, webp.variant, targetBytes, webp.attempts);
      }
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      // WebP 不可用或达不到目标时，回退到保持原格式的路径
    }
  }

  let found;
  if (type === 'jpg') {
    found = await findJpegTarget(original, targetBytes, onProgress, signal);
  } else {
    found = await findPngTarget(original, targetBytes, onProgress, signal);
  }
  throwIfAborted(signal);
  const variant = await makeRasterVariant({
    label: found.label,
    out: found.out,
    original,
    originalBytes,
    type,
    quality: found.quality,
    colors: found.colors,
  });
  if (variant.bytes >= targetBytes) {
    // 最终再校验一次，任何边界情况都不把超标文件当成成功结果
    throw targetError(`内部校验未通过：输出 ${variant.sizeText} 未严格小于目标 ${fmtSize(targetBytes)}。`);
  }
  return targetRasterResult(name, buf, originalBytes, type, original, variant, targetBytes, found.attempts);
}

async function findJpegTarget(original, targetBytes, onProgress, signal) {
  let low = 1;
  let high = 95;
  let best = null;
  let smallest = null;
  let attempts = 0;

  // MozJPEG 输出大小基本随质量单调变化，二分找“目标以内质量最高”的档位
  while (low <= high) {
    throwIfAborted(signal);
    const quality = Math.floor((low + high) / 2);
    const out = await compressJpeg(original, quality);
    throwIfAborted(signal);
    attempts++;
    onProgress && onProgress(null, `Q${quality} · ${fmtSize(out.length)}`);
    const candidate = { out, quality, label: `Q${quality} · 目标内`, bytes: out.length };
    if (!smallest || out.length < smallest.bytes) smallest = candidate;
    if (out.length < targetBytes) {
      best = candidate;
      low = quality + 1;
    } else {
      high = quality - 1;
    }
    await yieldToBrowser();
  }

  if (!best) {
    throw targetError(
      `目标过小：保持 ${original.width}×${original.height} 像素不变时，JPG 最低尝试仍为 ` +
      `${fmtSize(smallest.bytes)}（Q${smallest.quality}），无法严格小于 ${fmtSize(targetBytes)}。请提高目标大小。`
    );
  }
  return { ...best, attempts };
}

async function findPngTarget(original, targetBytes, onProgress, signal) {
  let smallest = null;
  let attempts = 0;

  // 先无损，再按颜色数从高到低找第一档达标结果，尽量保留画质
  for (const colors of TARGET_PNG_COLORS) {
    throwIfAborted(signal);
    const quantized = colors > 0 ? await quantize(original, colors) : null;
    // 先用低压缩等级（level 2）快速试探：已达标则直接返回以提速，超标再尝试 level 4 强压
    const quick = await compressPng(original, 2, quantized);
    attempts++;
    const label = colors === 0 ? '无损 · 目标内' : `${colors}色 · 目标内`;
    onProgress && onProgress(null,
      `${colors === 0 ? '无损' : colors + '色'} · 快速 ${fmtSize(quick.length)}`);
    let out = quick;
    if (quick.length >= targetBytes) {
      throwIfAborted(signal);
      const stronger = await compressPng(original, 4, quantized);
      attempts++;
      if (stronger.length < quick.length) out = stronger;
    }
    const candidate = { out, colors, label, bytes: out.length };
    if (!smallest || out.length < smallest.bytes) smallest = candidate;
    if (out.length < targetBytes) return { ...candidate, attempts };
    await yieldToBrowser();
  }

  throw targetError(
    `目标过小：保持 ${original.width}×${original.height} 像素不变时，PNG 已尝试无损及 2～256 色，最小仍为 ` +
    `${fmtSize(smallest.bytes)}，无法严格小于 ${fmtSize(targetBytes)}。请提高目标大小。`
  );
}

async function processWebpTarget(original, originalBytes, targetBytes, onProgress, signal) {
  if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') return null;
  const canvas = new OffscreenCanvas(original.width, original.height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(original, 0, 0);

  let low = 1;
  let high = 100;
  let best = null;
  let smallest = null;
  let attempts = 0;

  while (low <= high) {
    throwIfAborted(signal);
    const quality = Math.floor((low + high) / 2);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: quality / 100 });
    if (!blob || blob.type !== 'image/webp') return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    attempts++;
    onProgress && onProgress(null, `WebP Q${quality} · ${fmtSize(bytes.length)}`);
    const candidate = { blob, bytes, quality };
    if (!smallest || bytes.length < smallest.bytes.length) smallest = candidate;
    if (bytes.length < targetBytes) {
      best = candidate;
      low = quality + 1;
    } else {
      high = quality - 1;
    }
    await yieldToBrowser();
  }

  if (!best) {
    throw targetError(`WebP 最低质量仍为 ${fmtSize(smallest.bytes.length)}，无法小于目标 ${fmtSize(targetBytes)}`);
  }

  throwIfAborted(signal);
  const bitmap = await createImageBitmap(best.blob);
  if (bitmap.width !== original.width || bitmap.height !== original.height) {
    bitmap.close();
    throw new Error('WebP 尺寸校验失败');
  }
  const decodeCanvas = new OffscreenCanvas(original.width, original.height);
  const decodeCtx = decodeCanvas.getContext('2d');
  decodeCtx.drawImage(bitmap, 0, 0);
  if (bitmap.close) bitmap.close();
  const decoded = decodeCtx.getImageData(0, 0, original.width, original.height);
  const error = computeError(original, decoded);
  return {
    attempts,
    variant: {
      label: `WebP Q${best.quality} · 目标内`,
      bytes: best.bytes.length,
      sizeText: fmtSize(best.bytes.length),
      ratio: best.bytes.length / Math.max(1, originalBytes),
      saving: 1 - best.bytes.length / Math.max(1, originalBytes),
      rmse: error.rmse,
      maxErr: error.max,
      blob: best.blob,
      url: '',
      ext: 'webp',
      quality: best.quality,
      width: original.width,
      height: original.height,
    },
  };
}

async function makeRasterVariant({ label, out, original, originalBytes, type, quality, colors }) {
  const decoded = type === 'jpg' ? await decodeJpeg(out) : await decodePng(out);
  if (decoded.width !== original.width || decoded.height !== original.height) {
    throw new Error(`尺寸校验失败：输出 ${decoded.width}×${decoded.height}，原图 ${original.width}×${original.height}`);
  }
  const err = computeError(original, decoded);
  const blob = new Blob([out], { type: type === 'jpg' ? 'image/jpeg' : 'image/png' });
  return {
    label,
    bytes: out.length,
    sizeText: fmtSize(out.length),
    ratio: originalBytes > 0 ? out.length / originalBytes : 1,
    saving: originalBytes > 0 ? 1 - out.length / originalBytes : 0,
    rmse: err.rmse,
    maxErr: err.max,
    url: URL.createObjectURL(blob),
    blob,
    ext: type === 'jpg' ? 'jpg' : 'png',
    quality,
    colors,
    width: decoded.width,
    height: decoded.height,
  };
}

function makeOriginalRasterVariant(buf, originalBytes, type) {
  const blob = new Blob([buf], { type: type === 'jpg' ? 'image/jpeg' : 'image/png' });
  return {
    label: '原图已达标',
    bytes: originalBytes,
    sizeText: fmtSize(originalBytes),
    ratio: 1,
    saving: 0,
    rmse: 0,
    maxErr: 0,
    url: URL.createObjectURL(blob),
    blob,
    ext: type === 'jpg' ? 'jpg' : 'png',
  };
}

function targetRasterResult(name, buf, originalBytes, type, original, variant, targetBytes, attempts) {
  return {
    name, type, originalBytes,
    originalSizeText: fmtSize(originalBytes),
    originalUrl: URL.createObjectURL(new Blob([buf], { type: type === 'jpg' ? 'image/jpeg' : 'image/png' })),
    width: original.width,
    height: original.height,
    variants: [variant],
    recommended: variant.label,
    targetMode: true,
    targetMet: true,
    targetBytes,
    targetText: fmtSize(targetBytes),
    targetTrials: attempts,
  };
}

function pickRecommended(variants, type) {
  if (type === 'jpg') {
    const acceptable = variants.filter(v => v.rmse <= 1.2 && v.ratio < 1);
    if (acceptable.length) return acceptable[acceptable.length - 1];
    return variants.find(v => v.ratio < 1) || variants[0];
  }
  const acceptable = variants.filter(v => v.maxErr <= 2.0 && v.ratio < 1);
  if (acceptable.length) return acceptable[acceptable.length - 1];
  return variants.find(v => v.ratio < 1) || variants[0];
}

async function processSvg(name, buf, originalBytes, targetBytes, onProgress, signal) {
  throwIfAborted(signal);
  const text = new TextDecoder().decode(buf);
  const settings = [
    { label: '标准', floatPrecision: 3, multipass: false },
    { label: '深度', floatPrecision: 2, multipass: true },
    { label: '极限', floatPrecision: 1, multipass: true },
  ];

  if (targetBytes && originalBytes < targetBytes) {
    const variant = makeSvgVariant('原图已达标', buf, originalBytes);
    return targetSvgResult(name, buf, originalBytes, variant, targetBytes, 0);
  }

  const variants = [];
  let smallest = null;
  for (let i = 0; i < settings.length; i++) {
    throwIfAborted(signal);
    const s = settings[i];
    onProgress && onProgress((i + 1) / settings.length, s.label);
    const out = await compressSvg(text, s);
    throwIfAborted(signal);
    const variant = makeSvgVariant(targetBytes ? `${s.label} · 目标内` : s.label, out, originalBytes);
    const bytes = variant.bytes;
    if (!smallest || bytes < smallest.bytes) smallest = variant;
    if (targetBytes && bytes < targetBytes) {
      return targetSvgResult(name, buf, originalBytes, variant, targetBytes, i + 1);
    }
    variants.push(variant);
    await yieldToBrowser();
  }

  if (targetBytes) {
    throw targetError(
      `目标过小：SVG 在保留原始宽度、高度和 viewBox 的情况下，最小仍为 ` +
      `${fmtSize(smallest.bytes)}，无法严格小于 ${fmtSize(targetBytes)}。请提高目标大小。`
    );
  }

  return {
    name, type: 'svg', originalBytes,
    originalSizeText: fmtSize(originalBytes),
    originalUrl: URL.createObjectURL(new Blob([buf], { type: 'image/svg+xml' })),
    variants,
    recommended: variants[variants.length - 1].label,
  };
}

function makeSvgVariant(label, data, originalBytes) {
  const blob = new Blob([data], { type: 'image/svg+xml' });
  const bytes = blob.size;
  return {
    label,
    blob,
    bytes,
    sizeText: fmtSize(bytes),
    ratio: originalBytes > 0 ? bytes / originalBytes : 1,
    saving: originalBytes > 0 ? 1 - bytes / originalBytes : 0,
    rmse: 0,
    maxErr: 0,
    ext: 'svg',
  };
}

function targetSvgResult(name, buf, originalBytes, variant, targetBytes, attempts) {
  return {
    name, type: 'svg', originalBytes,
    originalSizeText: fmtSize(originalBytes),
    originalUrl: URL.createObjectURL(new Blob([buf], { type: 'image/svg+xml' })),
    variants: [variant],
    recommended: variant.label,
    targetMode: true,
    targetMet: true,
    targetBytes,
    targetText: fmtSize(targetBytes),
    targetTrials: attempts,
  };
}

export { fmtSize };