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

方式二：安装带图标的桌面快捷方式（Windows）
dist/ 目录中已打包完整的启动图标与快捷方式脚本：
进入 dist/ 目录，双击 安装桌面快捷方式.bat，即可在桌面生成带有专属启动图标的 “图片压缩器” 快捷方式（对应图标文件为 dist/图片压缩器图标.ico）。
也可以直接双击 启动图片压缩器.bat 快速启动（.bat 文件本身显示系统默认图标，桌面快捷方式会显示自定义应用图标）。
如需分享给他人，仅发送 dist/图片压缩器.html 即可使用全部压缩功能；若对方也需要桌面图标，可将整个 dist/ 目录打包发送。
效果验证截图 / Verification Screenshot
[https://www.google.com/search?q=docs/screenshots/%E7%95%8C%E9%9D%A2-%E7%9B%AE%E6%A0%87400KB%E9%AA%8C%E8%AF%81.png]
目标大小实现原理 / How Target Size Works
JPG：在 1–95 质量区间内二分搜索，并以真实编码字节数及解码后的像素宽高做最终校验。
PNG：优先尝试无损压缩；若当前颜色档位超标，先提高压缩级别，再逐步尝试降色量化并重新解码校验。
WebP 极速模式（可选）：调用浏览器原生 OffscreenCanvas 进行二分质量编码；若当前环境不支持则自动回退到原格式路径。
严格兜底：若无法在保持格式与尺寸的前提下压到目标体积以下，任务会进入未达标区域，绝不将超标文件伪装为成功。
本地开发与构建 / Local Development
需要 Node.js 22+（已在 Node 24 上验证通过）：
npm install
npm run build

npm run build（build.mjs）会自动完成：打包主界面与 Worker、读取 @jsquash/jpeg / @jsquash/png / @jsquash/oxipng 的 WASM 并内联，最终输出 dist/图片压缩器.html 并同步更新 docs/index.html。
目录结构 / Project Structure
index.html                 页面结构、白黄工业风 CSS 与入场动画
src/app.js                 页面控制、事件驱动队列、停止/重跑与 ZIP 导出
src/card.js                任务卡片渲染、对比预览与档位同步切换
src/cache.js               会话级 LRU 缓存（兼容 file:// 离线哈希）
src/pipeline.js            目标大小二分搜索、真实字节/尺寸校验、WebP 路径
src/worker.js              Web Worker 入口
src/worker-pool.js         Worker 池、预编译 WASM 共享与任务分发
src/codecs.js              MozJPEG / OxiPNG / SVGO 编解码封装
src/metrics.js             RMSE / MAX 误差评估与调色板量化
src/format.js              文件大小格式化
assets/                    应用启动图标（PNG / ICO）与设计素材
dist/                      预构建单文件 HTML、图标与 Windows 快捷方式启动包
docs/                      设计规范、参考图、界面截图与 GitHub Pages 入口
test/                      Playwright 自动化回归测试
build.mjs                  单文件构建脚本

自动化测试 / Testing
测试基于 Python + Playwright + Pillow：
pip install -r test/requirements.txt
python -m playwright install chromium
python test/spec_check.py

其他专项回归脚本：
python test/target_check.py
python test/target_timing.py
python test/queue_zip_check.py
python test/stop_rerun_check.py
python test/fast_webp_check.py
python test/offline.py

GitHub Pages 在线部署 / GitHub Pages
仓库已包含同步生成的 docs/index.html（详见 GITHUB_UPLOAD.md）：
进入仓库 Settings → Pages；
Source 选择 Deploy from a branch；
Branch 选择 main，目录选择 /docs 并保存，即可在线访问。
隐私说明 / Privacy
所有图片、压缩结果与缓存仅保存在浏览器内存中。
页面不发起任何外部网络请求；图标、背景、WASM 与 Worker 均已本地内联。
关闭页面后，缓存与任务列表自动清空，原始文件不会被修改。
设计资料 / Design References
设计规范 / UI Spec
02 号视觉参考图 / Reference 02
白黄工业风界面截图 / Main UI Screenshot
400 KB 目标验证截图 / 400 KB Target Verification
许可证与第三方声明 / License & Notices
本仓库目前尚未为整体项目指定开源许可证。如需公开发布，请根据实际需求补充 LICENSE 文件（例如 MIT / Apache-2.0），并确认代码与设计素材的授权范围。
应用启动图标、设计参考图和界面设计由项目所有者提供，未附加再分发许可。

第三方开源依赖许可详见 THIRD_PARTY_NOTICES.md。
