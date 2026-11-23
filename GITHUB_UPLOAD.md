# 上传到 GitHub

包内目录 `image-compressor/` 就是仓库根目录。不要把外层的 `图片压缩器-GitHub上传包-*` 文件夹直接作为仓库根目录。

## 方式一：网页上传（最简单）

1. 在 GitHub 新建一个空仓库，例如 `image-compressor`，不要勾选自动生成 README。
2. 解压桌面上的 `图片压缩器-GitHub上传包-*.zip`。
3. 打开 `image-compressor` 文件夹，全选里面的文件和文件夹（不要选中外层包目录）。
4. 在 GitHub 仓库页面点击 **Add file → Upload files**，把这些内容拖进去。
5. Commit message 填 `Initial commit`，提交。

## 方式二：Git 命令行

进入解压后的 `image-compressor` 目录：

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<你的用户名>/image-compressor.git
git push -u origin main
```

## 发布网页版（GitHub Pages）

仓库已经包含构建后的 `docs/index.html`，可以直接用 Pages 托管：

1. 仓库 **Settings → Pages**
2. Source 选择 **Deploy from a branch**
3. Branch 选 `main`，目录选 `/docs`
4. 保存，等待发布

## 发布前检查

- 不要上传 `node_modules/`；`package-lock.json` 已包含依赖版本。
- 如果要公开仓库，先补一个 `LICENSE`。代码和图标素材的授权范围由你决定；当前 README 明确说明尚未指定统一许可证。
- 参考图和图标是你提供的设计素材；如果仓库公开，请确认素材授权。
- 不使用游戏角色、Logo 或游戏原始素材。

## 本地重建

```bash
npm install
npm run build
```

构建输出：

```text
dist/图片压缩器.html
```

单文件 HTML 可以离线双击使用，也可以作为 GitHub Release 附件分发。
