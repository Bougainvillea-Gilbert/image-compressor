# 图像压缩终端 / Image Compressor Terminal

一个完全离线运行的单文件图片压缩工具，采用白/黄工业科技风界面。所有压缩都在本机浏览器中完成，图片不会上传到任何服务器。

![界面截图](docs/screenshots/界面-白黄工业风.png)

## 功能

- **严格目标文件大小**：默认启用，预填 500 KB，可直接修改。输出文件的真实字节数严格小于用户指定的 KB/MB 值。
- **保持原始宽高**：JPG/PNG 不缩放；SVG 保留原始尺寸属性和 `viewBox`。
- **批量队列**：多次导入自动合并到同一条队列；处理中继续添加也会并入当前队列。
- **Web Worker 并发**：根据 CPU 自动开启 1～4 个 Worker，真正的多图并行压缩。
- **结果缓存**：同一次页面会话内，相同文件 + 相同目标会复用成功结果。
- **可选 WebP 极速模式**：默认关闭；开启后允许有损转 WebP，速度更快、格式会改变。
- **停止 / 重跑**：可中止当前任务，并按当前目标重跑全部现有任务。
- **下载**：单张下载、逐个下载全部、成功结果 ZIP 打包。
- **纯前端、无网络、无外部字体/图片请求**：最终产物是一个自包含 HTML。

## 直接使用

打开预构建文件：

```text
dist/图片压缩器.html
```

双击即可在浏览器中运行，无需安装、无需启动服务器。

如果使用启动包，完整内容位于 `dist/`，包括 Windows ICO 图标、启动脚本和桌面快捷方式安装脚本。

## 本地开发

要求 Node.js 22+（本项目在 Node 24 上验证）。

```bash
npm install
npm run build
```

构建会：

1. 用 esbuild 打包主界面和 Worker；
2. 读取 `@jsquash/jpeg`、`@jsquash/png`、`@jsquash/oxipng` 的 WASM；
3. 将 WASM 和 Worker 源码以 base64/字符串内联；
4. 生成 `dist/图片压缩器.html`，同步更新 `docs/index.html`。

源码结构：

```text
index.html                 页面结构、白黄工业风 CSS、入场动画
src/app.js                 页面控制、事件驱动队列、停止/重跑、导出打包
src/card.js                任务卡片渲染、对比预览与档位同步切换
src/cache.js               会话级 LRU 缓存（兼容 file:// 离线哈希）
src/pipeline.js            目标大小搜索、真实字节/尺寸校验、WebP 路径
src/worker.js              Worker 入口
src/worker-pool.js         Worker 池、预编译 WASM 共享与任务分发
src/codecs.js              MozJPEG / OxiPNG / SVGO 封装
src/metrics.js             RMSE / MAX 误差与调色板量化
src/format.js              文件大小格式化
assets/                    图标与设计素材
docs/                      设计规范、参考图和截图
test/                      Playwright 回归测试
build.mjs                  单文件构建脚本
```

## 目标大小实现说明

- JPG：在 1～95 质量区间二分搜索，最终用真实编码字节数与解码后的宽高验证。
- PNG：先尝试无损。当前颜色档的快速编码超标时，先试更强的压缩，再考虑降低颜色数。输出会重新解码验证。
- WebP 极速模式（可选）：用浏览器原生 `OffscreenCanvas` 编码，二分质量；不可用时自动回退到原格式路径。
- 达不到目标、不能维持尺寸或格式要求时，任务进入失败/未达标区域，不会把超标文件标记为成功。

## 测试

测试使用 Python + Playwright + Pillow：

```bash
pip install -r test/requirements.txt
python -m playwright install chromium
python test/spec_check.py
```

其他回归脚本：

```bash
python test/target_check.py
python test/target_timing.py
python test/queue_zip_check.py
python test/stop_rerun_check.py
python test/fast_webp_check.py
python test/offline.py
```

测试会生成临时浏览器页面，不启动后端服务器。部分测试生成的截图会写入 `dist/`。

## GitHub Pages

仓库已包含 `docs/index.html`（由最终 HTML 复制）。详细上传步骤见 [GITHUB_UPLOAD.md](GITHUB_UPLOAD.md)。

启用 GitHub Pages 时：

1. Repository Settings → Pages；
2. Source 选择 `Deploy from a branch`；
3. Branch 选择 `main`，目录选择 `/docs`；
4. 保存后访问 GitHub Pages 地址。

## 隐私

- 图片、压缩结果和缓存都只存在浏览器内存中。
- 页面不发送网络请求；图标、背景、WASM、Worker 全部内联或本地构建。
- 关闭页面后，目标模式缓存和任务列表都会清空（原始文件不会被修改）。

## 设计资料

- [设计规范](docs/compressor-ui-spec.md)
- [02 号视觉参考图](docs/reference-02.png)
- [最终界面截图](docs/screenshots/界面-白黄工业风.png)
- [400 KB 目标验证截图](docs/screenshots/界面-目标400KB验证.png)

参考图只用于视觉对齐，不直接铺在页面中；页面由真实 HTML/CSS/SVG 组件实现。

## 许可证与素材

本仓库目前**没有为整个项目指定开源许可证**。在公开发布前，请根据你的意愿添加 `LICENSE`（例如 MIT/Apache-2.0），并确认代码与素材的授权范围。

- 应用图标、设计参考图和界面设计由项目所有者提供，未附加再分发许可。
- 第三方依赖许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 本项目不使用游戏角色、游戏 Logo 或游戏原始素材。
