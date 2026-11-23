# -*- coding: utf-8 -*-
"""离线 file:// 验证：不启动 HTTP 服务，直接双击等价的本地 HTML。"""
import base64
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "dist" / "图片压缩器.html"
TEST = ROOT / "test"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--use-angle=swiftshader"])
    page = browser.new_page()
    errors = []
    requests = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("request", lambda r: requests.append(r.url))
    page.goto(HTML.as_uri())
    page.wait_for_function("document.getElementById('status').textContent.includes('就绪')", timeout=30000)
    page.locator('#targetEnabled').uncheck()

    files = []
    for name, mime, filename in [
        ("sample.png", "image/png", "sample.png"),
        ("photo.jpg", "image/jpeg", "photo.jpg"),
        ("logo.svg", "image/svg+xml", "logo.svg"),
    ]:
        files.append((name, mime, base64.b64encode((TEST / filename).read_bytes()).decode()))
    page.evaluate("""(files) => {
      const dt = new DataTransfer();
      for (const [name, mime, b64] of files) {
        const bin = atob(b64), arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        dt.items.add(new File([arr], name, {type: mime}));
      }
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', {bubbles: true}));
    }""", files)
    page.locator('#startBtn').click()
    page.wait_for_function("document.querySelectorAll('.card table').length >= 3", timeout=90000)
    page.wait_for_timeout(1000)
    summary = page.evaluate("""() => [...document.querySelectorAll('.card')].map(c => ({
      name: c.querySelector('.fname').textContent,
      variants: c.querySelectorAll('tbody tr').length,
      previews: c.querySelectorAll('.variant-preview').length,
      errors: c.querySelectorAll('.error').length
    }))""")
    # 展开 PNG 详情后点击最后一档，确认预览确实切换
    page.locator('.card').filter(has_text='sample.png').locator('.task-main').click()
    page.locator('.card').filter(has_text='sample.png').locator('tbody tr').last.click()
    selected = page.locator('.card').filter(has_text='sample.png').locator('tbody tr.selected').count()
    print('离线状态:', page.text_content('#status'))
    print('卡片:', summary)
    print('点击档位后选中行数:', selected)
    print('网络请求:', [u for u in requests if u.startswith('http')])
    print('错误:', errors if errors else '无')
    browser.close()
