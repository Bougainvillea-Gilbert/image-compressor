import { processFile } from './pipeline.js';
import { initCodecs } from './codecs.js';

let initialized = false;

function post(type, payload, id) {
  self.postMessage({ type, id, ...payload });
}

self.onmessage = async event => {
  const data = event.data || {};
  if (data.type === 'init') {
    try {
      globalThis.__RECOMPRESSOR_WASM__ = data.wasm;
      await initCodecs();
      initialized = true;
      post('ready', {});
    } catch (error) {
      post('init-error', {
        message: error.message || String(error),
        stack: error.stack || '',
      });
    }
    return;
  }

  if (data.type !== 'process') return;
  const id = data.id;
  if (!initialized) {
    post('error', { message: '压缩引擎尚未初始化', code: 'NOT_READY' }, id);
    return;
  }

  try {
    const result = await processFile(
      data.file,
      (progress, label) => post('progress', { progress, label }, id),
      { targetBytes: data.targetBytes, preferWebp: !!data.preferWebp },
    );
    // Blob URL 不跨 Worker 使用：释放后让主线程用 Blob 重新创建
    if (result.originalUrl) URL.revokeObjectURL(result.originalUrl);
    result.originalUrl = '';
    for (const variant of result.variants || []) {
      if (variant.url) URL.revokeObjectURL(variant.url);
      variant.url = '';
    }
    post('result', { result }, id);
  } catch (error) {
    post('error', {
      message: error && error.message ? error.message : String(error),
      name: error && error.name ? error.name : 'Error',
      code: error && error.code ? error.code : '',
    }, id);
  }
};
