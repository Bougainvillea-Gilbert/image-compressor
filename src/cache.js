// 会话级结果缓存（LRU 淘汰 + 兼容 file:// 离线环境的回退哈希）

const MAX_CACHE_BYTES = 256 * 1024 * 1024;

function fallbackHash(buffer) {
  const bytes = new Uint8Array(buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 ^= b;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= b ^ (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `fnv:${bytes.length}:${p1}${p2}`;
}

async function digestFile(file) {
  const buffer = await file.arrayBuffer();
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      return [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // 非安全上下文（如双击 file:// 打开）下回退到纯 JS 确定性哈希
  }
  return fallbackHash(buffer);
}

function cloneResultWithoutUrls(result) {
  return {
    ...result,
    originalUrl: '',
    variants: (result.variants || []).map(variant => ({ ...variant, url: '' })),
  };
}

export class ResultCache {
  constructor(maxBytes = MAX_CACHE_BYTES) {
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.totalBytes = 0;
  }

  async keyFor(file, targetBytes, preferWebp) {
    if (!targetBytes) return '';
    try {
      const hash = await digestFile(file);
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      return JSON.stringify([hash, ext, file.type, targetBytes, !!preferWebp]);
    } catch {
      return '';
    }
  }

  get(key) {
    if (!key) return null;
    const entry = this.entries.get(key);
    if (!entry) return null;
    // LRU：命中后刷新到队尾
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.result;
  }

  set(key, result) {
    if (!key || !result || !result.targetMode) return;
    let cost = 0;
    for (const variant of result.variants || []) cost += variant.bytes || 0;
    const old = this.entries.get(key);
    if (old) {
      this.totalBytes -= old.cost;
      this.entries.delete(key);
    }
    this.entries.set(key, { result: cloneResultWithoutUrls(result), cost });
    this.totalBytes += cost;
    while (this.totalBytes > this.maxBytes && this.entries.size > 1) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.totalBytes -= oldest[1].cost;
    }
  }
}
