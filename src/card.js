// 任务卡片组件：渲染进度、对比预览、档位切换（同步下载与汇总）及错误/停止状态
import { fmtSize } from './format.js';

export function downloadName(original, ext) {
  return `${original.replace(/\.[^.]+$/, '')}-min.${ext}`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

export function createCard(file, { onDestroy, onVariantSelect } = {}) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.state = 'queued';
  const ext = (file.name.split('.').pop() || 'IMG').toUpperCase();
  const thumbUrl = URL.createObjectURL(file);

  el.innerHTML = `
    <div class="task-main" title="点击展开/收起处理详情">
      <img class="task-thumb" src="${thumbUrl}" alt="">
      <div class="file-ident"><span class="fname" title="${escapeHtml(file.name)}"></span><div class="file-sub"><span class="file-type">${escapeHtml(ext)}</span> · <span class="file-dimensions">—</span> · <span class="fmeta"></span></div></div>
      <div class="task-number original-number"><small>原始</small>${fmtSize(file.size)}</div>
      <div class="task-number output-number pending"><small>输出</small>—</div>
      <div class="file-status"><span class="state"></span><span class="step"></span></div>
      <a class="row-download disabled">下载</a>
    </div>
    <div class="file-progress"><div class="file-progress-fill"></div></div>
    <div class="card-body"><div class="loading">等待开始</div></div>`;
  el.querySelector('.fname').textContent = file.name;
  el.querySelector('.fmeta').textContent = fmtSize(file.size);

  const card = {
    el,
    thumbUrl,
    destroy() {
      URL.revokeObjectURL(thumbUrl);
      if (onDestroy) onDestroy(card);
    },
    setProgress(progress, label, state = 'processing') {
      const uncertain = progress === null;
      const p = uncertain ? 0 : Math.max(0, Math.min(1, Number(progress) || 0));
      el.dataset.state = state;
      el.querySelector('.file-progress-fill').style.width = (uncertain ? 32 : Math.round(p * 100)) + '%';
      el.querySelector('.file-progress-fill').classList.toggle('indeterminate', uncertain);
      el.querySelector('.state').textContent = state === 'queued' ? '等待'
        : state === 'processing' ? (uncertain ? '处理中' : `处理中 ${Math.round(p * 100)}%`)
        : state === 'success' ? '完成' : '失败';
      el.querySelector('.step').textContent = label || '';
      const loading = el.querySelector('.loading');
      if (loading) loading.textContent = label || (state === 'queued' ? '等待开始' : '处理中');
    },
    fail(message, code) {
      el.dataset.state = 'failed';
      el.classList.add('expanded');
      el.querySelector('.file-progress-fill').style.width = '100%';
      el.querySelector('.file-progress-fill').classList.remove('indeterminate');
      el.querySelector('.state').textContent = code === 'TARGET_SIZE_UNREACHABLE' ? '未达标' : '失败';
      el.querySelector('.step').textContent = '查看失败原因';
      el.querySelector('.card-body').innerHTML = `<div class="error">失败：${escapeHtml(message)}</div>`;
    },
    markStopped() {
      el.dataset.state = 'stopped';
      el.querySelector('.file-progress-fill').style.width = '0%';
      el.querySelector('.file-progress-fill').classList.remove('indeterminate');
      el.querySelector('.state').textContent = '已停止';
      el.querySelector('.step').textContent = '等待重跑';
      el.querySelector('.card-body').innerHTML = '<div class="loading">当前文件已停止，可点击“重跑任务”</div>';
    },
    render(result) {
      el.dataset.state = 'success';
      if (result.targetMode) el.classList.add('expanded');
      el.querySelector('.file-progress-fill').style.width = '100%';
      el.querySelector('.file-progress-fill').classList.remove('indeterminate');
      el.querySelector('.state').textContent = result.targetMode ? '达标' : '完成';
      el.querySelector('.step').textContent = result.targetMode ? '目标大小已验证' : '查看处理详情';
      const dims = result.width ? `${result.width}×${result.height}` : '矢量';
      el.querySelector('.file-dimensions').textContent = dims;
      el.querySelector('.fmeta').textContent = `${result.originalSizeText}`;

      const recommendedIndex = Math.max(0, result.variants.findIndex(v => v.label === result.recommended));
      const initial = result.variants[recommendedIndex];
      const output = el.querySelector('.output-number');
      const rowDownload = el.querySelector('.row-download');

      const syncHeaderToVariant = variant => {
        output.classList.remove('pending');
        output.innerHTML = `<small>输出</small>${variant.sizeText}`;
        rowDownload.classList.remove('disabled');
        rowDownload.href = variant.url;
        rowDownload.download = downloadName(result.name, variant.ext);
        rowDownload.textContent = '下载';
      };

      const targetNote = result.targetMode
        ? `<div class="target-ok">${initial.ext === 'webp' ? '已转换为 WebP · ' : ''}${result.cacheHit ? '缓存命中 · ' : ''}✓ 达标：输出 ${initial.sizeText}，真实字节数严格小于目标 ${result.targetText}；${result.width ? `宽高 ${result.width}×${result.height} 未变` : '原始尺寸属性保留'} · 尝试 ${result.targetTrials} 次</div>`
        : '';

      const rows = result.variants.map((variant, index) => {
        const rec = result.recommended === variant.label ? '<span class="rec">推荐</span>' : '';
        const errCell = result.type === 'svg'
          ? '<td class="muted">矢量优化</td>'
          : `<td>${variant.rmse.toFixed(2)} / ${variant.maxErr.toFixed(1)}</td>`;
        const saveCls = variant.saving > 0.0001 ? 'good' : variant.saving < -0.0001 ? 'bad' : 'muted';
        const saveText = variant.saving > 0.0001
          ? '-' + Math.round(variant.saving * 100) + '%'
          : variant.saving < -0.0001 ? '+' + Math.round(-variant.saving * 100) + '%' : '0%';
        return `<tr data-index="${index}" class="${rec ? 'rec-row' : ''}" title="点击预览并切换导出档位"><td>${rec}${variant.label}</td><td>${variant.sizeText}</td><td class="${saveCls}">${saveText}</td>${errCell}<td><a href="${escapeHtml(variant.url)}" download="${escapeHtml(downloadName(result.name, variant.ext))}">下载</a></td></tr>`;
      }).join('');

      el.querySelector('.card-body').innerHTML = `
        ${targetNote}<div class="compare"><figure><img src="${result.originalUrl}" alt="原图"><figcaption>原图 ${result.originalSizeText}</figcaption></figure><figure><img class="variant-preview" src="${escapeHtml(initial.url)}" alt="压缩预览"><figcaption class="preview-caption"></figcaption></figure><div class="table-wrap"><table><thead><tr><th>档位</th><th>大小</th><th>省幅</th><th>RMSE/MAX</th><th></th></tr></thead><tbody>${rows}</tbody></table><p class="hint">点击表格行可切换预览与默认导出档位；真实输出字节数通过尺寸和目标校验。</p></div></div>`;

      const body = el.querySelector('.card-body');
      const preview = body.querySelector('.variant-preview');
      const caption = body.querySelector('.preview-caption');
      const select = (index, notify = true) => {
        const variant = result.variants[index];
        if (!variant) return;
        result.selectedLabel = variant.label;
        preview.src = variant.url;
        caption.textContent = `${variant.label} · ${variant.sizeText}`;
        syncHeaderToVariant(variant);
        body.querySelectorAll('tbody tr').forEach(row =>
          row.classList.toggle('selected', Number(row.dataset.index) === index));
        if (notify && onVariantSelect) onVariantSelect(result, variant);
      };

      body.querySelectorAll('tbody tr').forEach(row => row.addEventListener('click', event => {
        if (event.target.closest('a')) return;
        select(Number(row.dataset.index), true);
      }));
      select(recommendedIndex, false);
    },
  };

  el.querySelector('.task-main').addEventListener('click', event => {
    if (event.target.closest('a,button')) return;
    if (el.dataset.state === 'success' || el.dataset.state === 'failed') el.classList.toggle('expanded');
  });

  card.setProgress(0, '等待开始', 'queued');
  return card;
}
