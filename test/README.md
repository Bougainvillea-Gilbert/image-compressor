# 测试说明

这些测试使用 Playwright 打开 `dist/图片压缩器.html`，覆盖真实队列、目标字节校验、停止/重跑、ZIP、缓存和并发功能。

```bash
pip install -r requirements.txt
python -m playwright install chromium
python spec_check.py
```

其他脚本：

- `target_check.py`：JPG/PNG/SVG 目标大小与尺寸校验
- `target_timing.py`：先导入后启用目标大小的回归
- `queue_zip_check.py`：统一队列、ZIP 和失败重试
- `stop_rerun_check.py`：停止、处理中追加和重跑
- `fast_webp_check.py`：WebP 极速模式与缓存
- `offline.py`：file:// 离线运行
- `e2e.py`：普通多档模式
- `benchmark_concurrency.py`：1 Worker 与自动并发的粗略对比

运行前请先构建：

```bash
npm install
npm run build
```
