// Web Worker 池：真正并行压缩；预编译 WASM Module 跨 Worker 共享，停止时终止 Worker，下次运行按需重建。
let compiledWasmPromise = null;

function decodeBase64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getSharedWasmPayload(rawTable) {
  if (!compiledWasmPromise) {
    compiledWasmPromise = (async () => {
      const entries = Object.entries(rawTable || {});
      const compiled = await Promise.all(entries.map(async ([key, value]) => {
        if (value instanceof WebAssembly.Module) return [key, value];
        const bytes = typeof value === 'string' ? decodeBase64ToBytes(value) : value;
        const mod = await WebAssembly.compile(bytes);
        return [key, mod];
      }));
      return Object.fromEntries(compiled);
    })().catch(() => {
      compiledWasmPromise = null;
      return rawTable;
    });
  }
  return compiledWasmPromise;
}

export class WorkerPool {
  constructor() {
    this.slots = [];
    this.source = globalThis.__RECOMPRESSOR_WORKER_SOURCE__ || '';
    this.wasm = globalThis.__RECOMPRESSOR_WASM__ || {};
    this.size = 0;
    this.nextId = 1;
  }

  async ensure(count) {
    if (!this.source) throw new Error('Worker 源码未内联');
    if (this.slots.length === count) return this;
    this.terminate();
    const wasmPayload = await getSharedWasmPayload(this.wasm);
    const slots = [];
    for (let i = 0; i < count; i++) {
      const blob = new Blob([this.source], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      const slot = { worker, current: null, ready: null, rejectReady: null };
      slot.ready = new Promise((resolve, reject) => {
        slot.resolveReady = resolve;
        slot.rejectReady = reject;
      });
      worker.onmessage = event => this.handleMessage(slot, event.data || {});
      worker.onerror = event => {
        const error = new Error(event.message || 'Worker 运行失败');
        if (slot.current) {
          const current = slot.current;
          slot.current = null;
          current.reject(error);
        } else if (slot.rejectReady) {
          slot.rejectReady(error);
        }
      };
      try {
        worker.postMessage({ type: 'init', wasm: wasmPayload });
      } catch {
        // 个别环境不支持结构化克隆 WebAssembly.Module 时回退到原始 base64 表
        worker.postMessage({ type: 'init', wasm: this.wasm });
      }
      slots.push(slot);
    }
    try {
      await Promise.all(slots.map(slot => slot.ready));
    } catch (error) {
      slots.forEach(slot => slot.worker.terminate());
      throw error;
    }
    this.slots = slots;
    this.size = count;
    return this;
  }

  handleMessage(slot, message) {
    if (message.type === 'ready') {
      slot.resolveReady && slot.resolveReady();
      return;
    }
    if (message.type === 'init-error') {
      const error = new Error(message.message || 'Worker 初始化失败');
      if (message.stack) error.remoteStack = message.stack;
      console.error('Worker 初始化失败:', message.stack || message.message);
      slot.rejectReady && slot.rejectReady(error);
      return;
    }
    const current = slot.current;
    if (!current || (message.id !== undefined && message.id !== current.id)) return;
    if (message.type === 'progress') {
      current.onProgress && current.onProgress(message.progress, message.label);
      return;
    }
    if (message.type === 'result') {
      slot.current = null;
      current.resolve(message.result);
      return;
    }
    if (message.type === 'error') {
      slot.current = null;
      const error = new Error(message.message || '压缩失败');
      error.name = message.name || 'Error';
      error.code = message.code || '';
      current.reject(error);
    }
  }

  run(slot, file, targetBytes, preferWebp, onProgress) {
    if (slot.current) {
      return Promise.reject(new Error('Worker 正忙'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      slot.current = { id, onProgress, resolve, reject };
      slot.worker.postMessage({ type: 'process', id, file, targetBytes, preferWebp });
    });
  }

  cancelAll() {
    for (const slot of this.slots) {
      if (slot.current) {
        const error = new Error('任务已停止');
        error.name = 'AbortError';
        const current = slot.current;
        slot.current = null;
        current.reject(error);
      }
      slot.worker.terminate();
    }
    this.slots = [];
    this.size = 0;
  }

  terminate() {
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];
    this.size = 0;
  }
}
