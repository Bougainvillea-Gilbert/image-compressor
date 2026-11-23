# -*- coding: utf-8 -*-
import base64
import io
import sys
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--use-angle=swiftshader"])
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto((ROOT / "dist" / "图片压缩器.html").as_uri())
    page.wait_for_function("document.getElementById('status').textContent.includes('就绪')", timeout=30000)
    b64 = base64.b64encode((ROOT / "test" / "alpha.png").read_bytes()).decode()
    page.evaluate("""(b64) => {
      const bin = atob(b64), arr = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([arr], 'alpha.png', {type:'image/png'}));
      const input = document.getElementById('fileInput');
      input.files = dt.files; input.dispatchEvent(new Event('change', {bubbles:true}));
    }""", b64)
    page.wait_for_selector('.card table', timeout=90000)
    rows = page.locator('.card tbody tr').all_text_contents()
    # 取 32 色档的实际下载字节，检查 alpha 和调色板数量
    output_b64 = page.evaluate("""async () => {
      const row = document.querySelector('.card tbody tr:last-child');
      const href = row.querySelector('a').href;
      const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer());
      let s = ''; for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    }""")
    im = Image.open(io.BytesIO(base64.b64decode(output_b64))).convert('RGBA')
    colors = im.getcolors(maxcolors=10000000) or []
    opaque_colors = {(r,g,b) for n,(r,g,b,a) in colors if a > 0}
    print('档位行:', rows)
    print('输出尺寸:', im.size, 'alpha 范围:', im.getchannel('A').getextrema())
    print('非透明像素 RGB 颜色数:', len(opaque_colors), '(32 色档应 <=32)')
    print('页面错误:', errors if errors else '无')
    browser.close()
