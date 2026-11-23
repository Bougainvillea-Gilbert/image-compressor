import { fmtSize } from './format.js';
import { WorkerPool } from './worker-pool.js';
import { ResultCache } from './cache.js';
import { createCard, downloadName, escapeHtml } from './card.js';
import { zipSync } from 'fflate';

const $ = id => document.getElementById(id);
const dropzone = $('dropzone');
const fileInput = $('fileInput');
const list = $('list');
const statusEl = $('status');
const targetEnabled = $('targetEnabled');
const targetValue = $('targetValue');
const targetUnit = $('targetUnit');
const fastMode = $('fastMode');
const startBtn = $('startBtn');
const addBtn = $('addBtn');
const downloadAllBtn = $('downloadAll');
const downloadZipBtn = $('downloadZip');
const clearBtn = $('clearResults');
const stopBtn = $('stopTask');
const rerunBtn = $('rerunTasks');
const outputSummary = $('outputSummary');
const batchPanel = $('batchPanel');
const batchStats = $('batchStats');
const batchCurrent = $('batchCurrent');
const batchProgressBar = $('batchProgressBar');
const failuresPanel = $('failuresPanel');
const failureCount = $('failureCount');
const failuresList = $('failuresList');
const retryFailedBtn = $('retryFailed');
const engineStatus = $('engineStatus');
const dropTitle = $('dropTitle');
const dropHint = $('dropHint');

const results = [];
const failedJobs = [];
const cards = new Set();
const taskFiles = [];
const resultCache = new ResultCache();
let pendingBatch = null;
let currentBatch = null;
let workerPool = null;
let stopRequested = false;
let busy = false;
let engineReady = false;
const concurrency = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

function setStatus(text) { statusEl.textContent = text; }
function setEngineStatus(text, className = '') {
  engineStatus.textContent = text;
  engineStatus.className = className;
}

async function ensureWorkers() {
  if (!workerPool) workerPool = new WorkerPool();
  if (workerPool.size !== concurrency) await workerPool.ensure(concurrency);
  return workerPool;
}

async function initWorkerEngine() {
  try {
    const pool = await ensureWorkers();
    engineReady = true;
    setEngineStatus(`本地引擎就绪 · ${pool.size} 并发`);
    setStatus(`引擎就绪，可批量添加图片 · ${pool.size} 个 Worker 并行处理`);
    updateButtons();
  } catch (error) {
    engineReady = false;
    setEngineStatus('初始化失败', 'failed');
    setStatus('引擎初始化失败：' + (error.message || String(error)));
    updateButtons();
  }
}
initWorkerEngine();

$('skipBoot').addEventListener('click', () => $('boot-screen').classList.add('skipped'));
$('boot-screen').addEventListener('animationend', event => {
  if (event.target === $('boot-screen')) $('boot-screen').setAttribute('aria-hidden', 'true');
});

function updateTargetControls() {
  const enabled = targetEnabled.checked;
  targetValue.disabled = !enabled;
  targetUnit.disabled = !enabled;
  if (fastMode) fastMode.disabled = !enabled;
}
targetEnabled.addEventListener('change', updateTargetControls);
updateTargetControls();

function readTargetBytes(silent = false) {
  if (!targetEnabled.checked) return 0;
  const value = Number(targetValue.value);
  const unit = Number(targetUnit.value);
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(unit)) {
    if (!silent) setStatus('请先填写有效的目标大小（必须大于 0）');
    return null;
  }
  const bytes = Math.floor(value * unit);
  if (!Number.isSafeInteger(bytes)) {
    if (!silent) setStatus('目标大小超出可用范围');
    return null;
  }
  if (bytes < 1) {
    if (!silent) setStatus('目标大小太小，至少为 1 字节');
    return null;
  }
  return bytes;
}

function makeCard(file) {
  const card = createCard(file, {
    onDestroy: instance => cards.delete(instance),
    onVariantSelect: () => updateOutputSummary(),
  });
  cards.add(card);
  return card;
}

// 输入：批量拖拽 / 多选 / 粘贴
addBtn.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', event => {
  queueFiles(event.target.files);
  event.target.value = '';
});
['dragover', 'dragenter'].forEach(type => dropzone.addEventListener(type, event => {
  event.preventDefault();
  dropzone.classList.add('drag');
  dropTitle.textContent = '释放以加入任务';
}));
['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => {
  event.preventDefault();
  dropzone.classList.remove('drag');
  dropTitle.textContent = dropzone.classList.contains('has-files') ? '继续添加图片' : '拖入图片或点击添加';
}));
dropzone.addEventListener('drop', event => queueFiles(event.dataTransfer.files));
window.addEventListener('paste', event => {
  const files = [...(event.clipboardData?.files || [])]
    .filter(file => file.type.startsWith('image/') || /\.svg$/i.test(file.name));
  if (files.length) queueFiles(files);
});

function supportedFiles(fileList) {
  return [...fileList].filter(file =>
    /\.(jpe?g|png|svg)$/i.test(file.name) || /image\/(jpeg|png|svg\+xml)/.test(file.type));
}

function queueFiles(fileList) {
  const targetBytes = targetEnabled.checked ? readTargetBytes(true) : 0;
  // 导入时允许目标输入尚不完整；点击“开始压缩”时会重新读取并校验
  const files = supportedFiles(fileList);
  if (!files.length) {
    setStatus('没有找到可处理的 JPG / PNG / SVG 文件');
    return;
  }

  // 统一队列：等待开始或正在处理时继续添加，都并入同一批，不另开批次
  if (busy) {
    if (!currentBatch) {
      setStatus('当前任务正在结束，请稍后再添加');
      return;
    }
    appendFilesToBatch(currentBatch, files, true);
    return;
  }
  if (pendingBatch) {
    appendFilesToBatch(pendingBatch, files, false);
    return;
  }

  const batch = createBatch(files, targetBytes === null ? 0 : targetBytes);
  taskFiles.push(...files);
  pendingBatch = batch;
  batchPanel.hidden = false;
  updateBatchPanel(batch.state, 0, `已接收 ${batch.state.total} 个文件，等待开始压缩`);
  setStatus(`已导入 ${batch.state.total} 张，全部等待开始；点击“开始压缩”时应用当前目标设置`);
  updateButtons();
}

function createBatch(files, targetBytes) {
  const jobs = files.map(file => ({ file, card: makeCard(file) }));
  // 保留输入顺序，并且先把整批任务放入 DOM，再开始处理
  const fragment = document.createDocumentFragment();
  jobs.forEach(job => fragment.appendChild(job.card.el));
  list.appendChild(fragment);
  dropzone.classList.add('has-files');
  dropTitle.textContent = '继续添加图片';
  dropHint.textContent = '多次添加会合并到同一队列；全部准备好后点击左侧“开始压缩”';
  return {
    jobs,
    targetBytes,
    notify: null,
    state: { total: files.length, success: 0, failed: 0, stopped: 0, processing: false },
  };
}

function appendFilesToBatch(batch, files, running) {
  const jobs = files.map(file => ({ file, card: makeCard(file) }));
  const fragment = document.createDocumentFragment();
  jobs.forEach(job => fragment.appendChild(job.card.el));
  // 处理中追加时，通过事件信号立即唤醒空闲 Worker 继续消费
  list.appendChild(fragment);
  batch.jobs.push(...jobs);
  taskFiles.push(...files);
  batch.state.total += files.length;
  batchPanel.hidden = false;
  if (running) {
    if (batch.notify) batch.notify();
    updateBatchPanel(batch.state, 0, `队列已加入 ${files.length} 张，当前共 ${batch.state.total} 张`);
    setStatus(`已加入 ${files.length} 张到当前任务，队列会继续处理`);
  } else {
    updateBatchPanel(batch.state, 0, `已加入 ${files.length} 张，当前共 ${batch.state.total} 张等待开始`);
    setStatus(`已合并到同一队列，当前共 ${batch.state.total} 张；点击“开始压缩”`);
  }
  updateButtons();
}

startBtn.addEventListener('click', async () => {
  if (busy || !pendingBatch || !engineReady) return;
  // 关键：以点击“开始压缩”这一刻的目标设置为准，而不是导入时的旧值
  const targetBytes = readTargetBytes();
  if (targetBytes === null) {
    setStatus('目标大小无效，已保留等待队列，请修正后再点击“开始压缩”');
    return;
  }
  const batch = pendingBatch;
  batch.targetBytes = targetBytes;
  batch.preferWebp = targetBytes > 0 && !!fastMode && fastMode.checked;
  pendingBatch = null;
  updateButtons();
  await runBatch(batch);
});

stopBtn.addEventListener('click', () => {
  if (!busy) return;
  stopRequested = true;
  stopBtn.disabled = true;
  if (currentBatch && currentBatch.notify) currentBatch.notify();
  if (workerPool) {
    workerPool.cancelAll();
    workerPool = null;
  }
  setStatus('正在停止当前任务，已完成的结果会保留…');
});

rerunBtn.addEventListener('click', async () => {
  if (busy || !engineReady || !taskFiles.length) return;
  const targetBytes = readTargetBytes();
  if (targetBytes === null) {
    setStatus('目标大小无效，任务未重跑');
    return;
  }
  // 全部现有任务复制后重建为一条队列，再按当前目标统一重跑
  const files = taskFiles.slice();
  resetTaskArea(false);
  taskFiles.length = 0;
  const batch = createBatch(files, targetBytes);
  batch.preferWebp = targetBytes > 0 && !!fastMode && fastMode.checked;
  taskFiles.push(...files);
  await runBatch(batch);
});

async function runBatch(batch) {
  busy = true;
  currentBatch = batch;
  stopRequested = false;
  updateButtons();
  batchPanel.hidden = false;
  setStatus(`开始处理 ${batch.state.total} 个文件（并发队列）…`);
  updateBatchPanel(batch.state, 0, '队列已启动');
  let stopped = false;

  let pool;
  try {
    pool = await ensureWorkers();
    if (stopRequested) pool.terminate();
  } catch (error) {
    busy = false;
    currentBatch = null;
    engineReady = false;
    setEngineStatus('初始化失败', 'failed');
    setStatus('并行引擎启动失败：' + (error.message || String(error)));
    updateButtons();
    return;
  }

  let nextIndex = 0;
  let active = 0;
  let waiters = [];

  const notifyQueue = () => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };
  const waitForSignal = () => new Promise(resolve => waiters.push(resolve));
  batch.notify = notifyQueue;

  const processOne = async (slot, job) => {
    active++;
    batch.state.active = active;
    batch.state.processing = true;
    job.card.setProgress(0, '准备处理', 'processing');
    updateBatchPanel(batch.state, null, `${active} 个并行任务处理中…`);
    try {
      const cacheKey = await resultCache.keyFor(job.file, batch.targetBytes, batch.preferWebp);
      if (stopRequested) {
        job.card.markStopped();
        batch.state.stopped++;
        return;
      }
      const cached = resultCache.get(cacheKey);
      if (cached) {
        job.card.setProgress(1, '缓存命中，跳过重复压缩', 'processing');
        const result = hydrateResultUrls({
          ...cached,
          name: job.file.name,
          variants: cached.variants.map(v => ({ ...v })),
        }, job.file);
        result.cacheHit = true;
        results.push(result);
        job.card.render(result);
        batch.state.success++;
        return;
      }
      const result = await pool.run(slot, job.file, batch.targetBytes, batch.preferWebp, (progress, label) => {
        job.card.setProgress(progress, label, 'processing');
        updateBatchPanel(batch.state, null, `${active} 个并行任务处理中 · 已完成 ${batch.state.success + batch.state.failed}`);
      });
      hydrateResultUrls(result, job.file);
      if (cacheKey) resultCache.set(cacheKey, result);
      results.push(result);
      job.card.render(result);
      batch.state.success++;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        stopRequested = true;
        job.card.markStopped();
        batch.state.stopped++;
      } else {
        const message = error.message || String(error);
        job.card.fail(message, error.code);
        batch.state.failed++;
        failedJobs.push({ file: job.file, message, card: job.card });
        renderFailures();
      }
    } finally {
      active--;
      batch.state.active = active;
      batch.state.processing = active > 0;
      notifyQueue();
      updateBatchPanel(batch.state, active > 0 ? null : 0,
        stopRequested ? '任务已停止' : `${active} 个并行任务处理中 · 已完成 ${batch.state.success + batch.state.failed}/${batch.state.total}`);
      setStatus(stopRequested
        ? '任务已停止'
        : `并发处理中：成功 ${batch.state.success}，失败 ${batch.state.failed}，共 ${batch.state.total}`);
      updateOutputSummary();
    }
  };

  // 事件驱动动态消费：处理中追加文件时通过 notifyQueue 立即唤醒空闲 Worker，无轮询开销
  const loops = pool.slots.map(slot => (async () => {
    while (!stopRequested) {
      const job = batch.jobs[nextIndex];
      if (job) {
        nextIndex++;
        await processOne(slot, job);
        continue;
      }
      if (active === 0) break;
      await waitForSignal();
    }
  })());

  try {
    await Promise.all(loops);
  } finally {
    batch.notify = null;
    notifyQueue();
    if (stopRequested) {
      for (const job of batch.jobs.slice(nextIndex)) {
        job.card.markStopped();
        batch.state.stopped++;
      }
    }
    busy = false;
    currentBatch = null;
    batch.state.processing = false;
    batch.state.active = 0;
    stopped = stopRequested;
    updateBatchPanel(batch.state, 0, stopped ? '任务已停止，已完成结果保留' : '本批处理完成');
    updateButtons();
    updateOutputSummary();
  }
  if (stopped) {
    setStatus(`任务已停止：成功 ${batch.state.success} 张，失败 ${batch.state.failed} 张。可点击“重跑任务”按当前目标重新处理全部任务。`);
  } else {
    setStatus(`本批完成：成功 ${batch.state.success} 张，失败 ${batch.state.failed} 张${batch.targetBytes ? ` · 目标 ${fmtSize(batch.targetBytes)}（严格小于）` : ''}`);
  }
}

function hydrateResultUrls(result, file) {
  result.originalUrl = URL.createObjectURL(file);
  for (const variant of result.variants || []) {
    if (variant.blob && !variant.url) variant.url = URL.createObjectURL(variant.blob);
  }
  return result;
}

function updateBatchPanel(state, fraction, currentText) {
  const settled = state.success + state.failed + state.stopped;
  const active = state.active || (state.processing ? 1 : 0);
  const queued = Math.max(0, state.total - settled - active);
  const uncertain = fraction === null;
  const currentFraction = state.processing && !uncertain ? Math.max(0, Math.min(1, Number(fraction) || 0)) : 0;
  const percent = state.total ? Math.min(100, ((settled + currentFraction) / state.total) * 100) : 0;
  batchProgressBar.style.width = percent + '%';
  batchProgressBar.classList.toggle('indeterminate', uncertain);
  batchStats.textContent = `共 ${state.total} 张 · 成功 ${state.success} · 失败 ${state.failed}${state.stopped ? ` · 已停止 ${state.stopped}` : ''} · 排队 ${queued} · ${Math.round(percent)}%`;
  batchCurrent.textContent = currentText || '';
}

function updateButtons() {
  const disabled = busy || results.length === 0;
  downloadAllBtn.disabled = disabled;
  downloadZipBtn.disabled = disabled;
  startBtn.disabled = busy || !pendingBatch || !engineReady;
  stopBtn.disabled = !busy;
  rerunBtn.disabled = busy || taskFiles.length === 0 || !engineReady;
}

function updateOutputSummary() {
  let total = 0;
  for (const result of results) {
    const variant = selectedVariant(result);
    if (variant) total += variant.bytes;
  }
  outputSummary.textContent = `有效结果 ${results.length} · 输出 ${fmtSize(total)}${failedJobs.length ? ` · 失败 ${failedJobs.length}` : ''}`;
}

// 失败区域：错误原因与重试操作分离，失败不阻断其它文件
function renderFailures() {
  failuresPanel.hidden = failedJobs.length === 0;
  failureCount.textContent = failedJobs.length;
  failuresList.innerHTML = failedJobs.map((item, index) => `
    <div class="failure-row"><div class="failure-info"><strong title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong><span>${escapeHtml(item.message)}</span></div><button type="button" data-retry="${index}">按当前设置重试</button></div>`).join('');
  updateOutputSummary();
}

failuresList.addEventListener('click', event => {
  const button = event.target.closest('button[data-retry]');
  if (button) retryFailed([Number(button.dataset.retry)]);
});
retryFailedBtn.addEventListener('click', () => retryFailed());

async function retryFailed(indexes) {
  if (busy || pendingBatch || !failedJobs.length || !engineReady) return;
  const targetBytes = readTargetBytes();
  if (targetBytes === null) return;
  const selected = (indexes || failedJobs.map((_, i) => i)).filter(i => i >= 0 && i < failedJobs.length);
  if (!selected.length) return;
  const items = selected.map(i => failedJobs[i]);
  selected.slice().sort((a, b) => b - a).forEach(i => failedJobs.splice(i, 1));
  items.forEach(item => { item.card.destroy(); item.card.el.remove(); });
  renderFailures();
  // 重试是用户明确发出的启动动作，直接运行新队列
  const retryBatch = createBatch(items.map(item => item.file), targetBytes);
  retryBatch.preferWebp = targetBytes > 0 && !!fastMode && fastMode.checked;
  await runBatch(retryBatch);
}

function resetTaskArea(resetFiles = true) {
  for (const result of results) {
    if (result.originalUrl) URL.revokeObjectURL(result.originalUrl);
    for (const variant of result.variants || []) if (variant.url) URL.revokeObjectURL(variant.url);
  }
  for (const card of cards) card.destroy();
  cards.clear();
  results.length = 0;
  failedJobs.length = 0;
  pendingBatch = null;
  currentBatch = null;
  if (resetFiles) taskFiles.length = 0;
  list.innerHTML = '';
  batchPanel.hidden = true;
  dropzone.classList.remove('has-files');
  dropTitle.textContent = '拖入图片或点击添加';
  dropHint.innerHTML = '支持 JPG / PNG / SVG · 可一次添加多张 · <kbd>Ctrl</kbd>+<kbd>V</kbd> 粘贴<br>多次添加会合并到同一队列，图片只在本机浏览器处理';
  renderFailures();
  updateButtons();
  updateOutputSummary();
}

clearBtn.addEventListener('click', () => {
  if (busy) {
    setStatus('任务处理中不能清空，请先点击“停止当前任务”');
    return;
  }
  resetTaskArea(true);
  setStatus('已清空任务和结果，原始文件未被修改');
});

function selectedVariant(result) {
  if (result.targetMode) return result.variants[0];
  const preferred = result.selectedLabel || result.recommended;
  return result.variants.find(item => item.label === preferred) || result.variants[0];
}

function triggerDownload(href, filename) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

downloadAllBtn.addEventListener('click', async () => {
  if (busy || !results.length) return;
  for (const result of results) {
    const variant = selectedVariant(result);
    if (!variant) continue;
    triggerDownload(variant.url, downloadName(result.name, variant.ext));
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  setStatus(`已发起 ${results.length} 个文件的下载请求`);
});

downloadZipBtn.addEventListener('click', async () => {
  if (busy || !results.length) return;
  downloadZipBtn.disabled = true;
  downloadZipBtn.textContent = '打包中…';
  setStatus(`正在打包 ${results.length} 个有效结果…`);
  try {
    const entries = Object.create(null);
    const usedNames = new Set();
    for (const result of results) {
      const variant = selectedVariant(result);
      if (!variant) continue;
      const filename = uniqueDownloadName(result.name, variant.ext, usedNames);
      const data = new Uint8Array(await variant.blob.arrayBuffer());
      // 已压缩的位图采用 level 0（Store）瞬间打包，仅对 SVG 启用 DEFLATE 压缩
      entries[filename] = [data, { level: variant.ext === 'svg' ? 6 : 0 }];
    }
    const zipped = zipSync(entries);
    const url = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }));
    triggerDownload(url, `图片压缩结果-${new Date().toISOString().slice(0, 10)}.zip`);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus(`ZIP 已准备下载：${Object.keys(entries).length} 个有效结果${failedJobs.length ? '，失败/未达标文件未包含' : ''}`);
  } catch (error) {
    setStatus('ZIP 打包失败：' + (error.message || String(error)));
  } finally {
    downloadZipBtn.innerHTML = '打包下载 ZIP <span class="arrow">→</span>';
    updateButtons();
  }
});

function uniqueDownloadName(original, ext, usedNames) {
  const initial = downloadName(original, ext);
  const base = initial.replace(/\.[^.]+$/, '');
  let name = initial;
  let index = 2;
  while (usedNames.has(name)) name = `${base}-${index++}.${ext}`;
  usedNames.add(name);
  return name;
}

updateButtons();
updateOutputSummary();
