<p align="center">
  <img src="assets/app-icon.png" width="120" alt="图像压缩终端图标 / App Icon" />
</p>

<h1 align="center">图像压缩终端 / Image Compressor Terminal</h1>

<p align="center">
  <strong>纯前端、完全离线的单文件批量图片压缩工具（白/黄工业科技风）</strong><br />
  <em>A completely offline, single-file batch image compressor powered by WebAssembly &amp; Web Workers.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Offline-100%25%20Local-F5B800?style=flat-square" alt="100% Offline" />
  <img src="https://img.shields.io/badge/Formats-JPG%20%7C%20PNG%20%7C%20SVG%20%7C%20WebP-1F2937?style=flat-square" alt="Formats" />
  <img src="https://img.shields.io/badge/Engine-MozJPEG%20%7C%20OxiPNG%20%7C%20SVGO-3B82F6?style=flat-square" alt="Engine" />
  <img src="https://img.shields.io/badge/Desktop%20Icon-Included-10B981?style=flat-square" alt="Desktop Icon Included" />
</p>

所有压缩均在本机浏览器内通过 **WebAssembly + Web Worker** 完成，图片不会上传到任何服务器，也不发起任何外部网络请求。

All compression runs locally in your browser using **WebAssembly and Web Workers**—no images are ever uploaded, and zero external network requests are made.

[docs/screenshots/界面-白黄工业风.png]

---

## 核心特性 / Features

- **严格目标体积 / Strict Target File Size**：默认启用并预填 `500 KB`（可自由修改 KB / MB），输出文件真实字节数严格小于设定目标。
- **保留原始分辨率 / Original Resolution Preserved**：JPG / PNG 像素宽高不缩放；SVG 保留原始尺寸属性与 `viewBox`。
- **多核并发队列 / Batch Queue & Web Worker Pool**：多次导入自动合并到同一队列；根据 CPU 核心数自动开启 1～4 个 Worker 并行压缩。
- **会话级结果缓存 / Session Cache**：同一次页面会话中，相同文件 + 相同目标参数直接命中缓存，秒出结果。
- **可选 WebP 极速模式 / Optional Fast WebP Mode**：默认关闭；开启后允许有损转为 WebP（保持原宽高），体积更小、速度更快。
- **可控任务流与打包导出 / Stop, Rerun & ZIP Export**：支持随时中止、修改目标后一键重跑全部任务，以及单张下载、逐个下载全部、成功结果 ZIP 打包。
- **桌面启动图标 / Desktop Shortcut & App Icon**：内置专属白黄工业风猫耳机械图标（`assets/app-icon.png` / `.ico`）及 Windows 桌面快捷方式安装脚本。

---

## 快速使用 / Quick Start

### 方式一：单文件直接运行（全平台通用）
无需安装、无需联网，直接双击打开仓库中已构建好的单文件 HTML 即可在浏览器中使用：

```text
dist/图片压缩器.html
