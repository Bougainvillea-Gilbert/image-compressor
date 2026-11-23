// 误差计算：RMSE（均方根逐像素误差）与 MAX（最大单像素误差）
// 输入两张等尺寸 ImageData（RGBA），输出 0-100 量纲的误差
export function computeError(a, b) {
  const da = a.data, db = b.data;
  const n = Math.min(da.length, db.length);
  let sumSq = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(da[i] - db[i]);
    sumSq += d * d;
    if (d > max) max = d;
  }
  const rmse = Math.sqrt(sumSq / Math.max(1, n));
  return { rmse: (rmse / 255) * 100, max: (max / 255) * 100, rmseRaw: rmse, maxRaw: max };
}

// 把 ArrayBuffer 解码成 ImageData（保留给调用方复用解码器）
export async function toImageData(buffer, type, decoders) {
  if (type === 'jpg') return decoders.jpeg(buffer);
  if (type === 'png') return decoders.png(buffer);
  throw new Error('该格式不支持像素解码');
}

/*
 * PNG 减色：直方图 + median-cut 调色板量化。
 * 目标颜色数是实际的调色板上限，而不是简单截断 RGB 位深；
 * 这样 256/128/64/32 档会有真实的差异。透明像素的 alpha 原样保留。
 * 这是本地轻量实现，和 pngquant 的抖动/感知模型不完全相同。
 */
export function quantize(imageData, maxColors) {
  const { width, height, data } = imageData;
  const target = Math.max(2, Math.min(256, Math.round(maxColors)));
  const bins = new Map();

  // 先用 RGB 各 5 位做直方图，限制大图的计算量；alpha=0 的像素不参与调色板
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const old = bins.get(key);
    if (old) {
      old.count++;
      old.sr += r; old.sg += g; old.sb += b;
    } else {
      bins.set(key, { key, count: 1, sr: r, sg: g, sb: b });
    }
  }

  const out = new ImageData(width, height);
  out.data.set(data);
  if (bins.size <= target || bins.size === 0) return out;

  const entries = [...bins.values()].map(e => ({
    key: e.key,
    count: e.count,
    r: e.sr / e.count,
    g: e.sg / e.count,
    b: e.sb / e.count,
  }));
  const countOf = list => list.reduce((sum, e) => sum + e.count, 0);
  let boxes = [{ entries, count: countOf(entries) }];
  const channels = ['r', 'g', 'b'];

  // 每次优先拆分颜色范围大、且包含像素较多的盒子
  while (boxes.length < target) {
    let best = -1;
    let bestScore = 0;
    let bestChannel = 'r';
    for (let bi = 0; bi < boxes.length; bi++) {
      const box = boxes[bi];
      if (box.entries.length < 2) continue;
      let score = 0;
      let channel = 'r';
      for (const c of channels) {
        let min = Infinity, max = -Infinity;
        for (const e of box.entries) {
          if (e[c] < min) min = e[c];
          if (e[c] > max) max = e[c];
        }
        const candidate = (max - min) * Math.sqrt(box.count);
        if (candidate > score) { score = candidate; channel = c; }
      }
      if (score > bestScore) {
        bestScore = score;
        best = bi;
        bestChannel = channel;
      }
    }
    if (best < 0 || bestScore <= 0) break;

    const box = boxes[best];
    box.entries.sort((a, b) => a[bestChannel] - b[bestChannel]);
    const half = box.count / 2;
    let accumulated = 0;
    let split = 1;
    for (let i = 0; i < box.entries.length - 1; i++) {
      accumulated += box.entries[i].count;
      if (accumulated >= half) { split = i + 1; break; }
    }
    const left = box.entries.slice(0, split);
    const right = box.entries.slice(split);
    if (!left.length || !right.length) break;
    boxes.splice(best, 1,
      { entries: left, count: countOf(left) },
      { entries: right, count: countOf(right) });
  }

  const palette = boxes.map(box => {
    const total = Math.max(1, box.count);
    return [
      Math.round(box.entries.reduce((s, e) => s + e.r * e.count, 0) / total),
      Math.round(box.entries.reduce((s, e) => s + e.g * e.count, 0) / total),
      Math.round(box.entries.reduce((s, e) => s + e.b * e.count, 0) / total),
    ];
  });

  // 每个直方图 bin 只找一次最近调色板颜色，避免逐像素重复搜索
  const nearest = new Map();
  for (const e of entries) {
    let best = 0;
    let bestDistance = Infinity;
    for (let pi = 0; pi < palette.length; pi++) {
      const p = palette[pi];
      const dr = e.r - p[0], dg = e.g - p[1], db = e.b - p[2];
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) { bestDistance = distance; best = pi; }
    }
    nearest.set(e.key, best);
  }

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      out.data[i] = 0; out.data[i + 1] = 0; out.data[i + 2] = 0;
      continue;
    }
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const p = palette[nearest.get(key) || 0];
    out.data[i] = p[0];
    out.data[i + 1] = p[1];
    out.data[i + 2] = p[2];
    // out.data[i + 3] 保留原 alpha
  }
  return out;
}
