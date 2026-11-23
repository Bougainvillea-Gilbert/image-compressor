# -*- coding: utf-8 -*-
"""验收 WebP 极速开关与目标模式缓存。"""
import base64
import io
import sys
import time
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'dist' / '图片压缩器.html').as_uri()
B64 = base64.b64encode((ROOT / 'test' / 'large.png').read_bytes()).decode()


def upload(page, filename='large.png'):
    page.evaluate("""([b64, filename]) => {
      const bin = atob(b64), arr = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([arr], filename, {type:'image/png'}));
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    }""", [B64, filename])


def setup(page):
    page.locator('#targetEnabled').check()
    page.locator('#targetValue').fill('400')
    page.locator('#targetUnit').select_option('1024')
    page.locator('#fastMode').check()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(HTML)
    page.wait_for_function("document.getElementById('engineStatus').textContent.includes('就绪')", timeout=60000)
    page.locator('#skipBoot').dispatch_event('click')
    setup(page)
    upload(page)
    start = time.perf_counter()
    page.locator('#startBtn').click()
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')", timeout=240000)
    first = time.perf_counter() - start
    note = page.locator('.target-ok').text_content()
    filename = page.locator('.row-download').get_attribute('download')
    info = page.evaluate("""async () => {
      const href = document.querySelector('.row-download').href;
      const response = await fetch(href);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let s=''; for (const b of bytes) s += String.fromCharCode(b);
      return { type: response.headers.get('content-type'), b64: btoa(s), size: bytes.length };
    }""")
    raw = base64.b64decode(info['b64'])
    im = Image.open(io.BytesIO(raw))
    print('WebP 状态:', page.locator('#status').text_content(), '耗时 %.2fs' % first)
    print('提示:', note)
    print('下载名:', filename, 'MIME:', info['type'], '大小:', info['size'], '尺寸:', im.size)
    assert 'WebP' in note and filename.endswith('.webp') and info['type'] == 'image/webp'
    assert info['size'] < 400 * 1024 and im.size == (1200, 800)

    # 清空任务但保留页面内缓存，同文件/同目标应命中缓存
    page.locator('#clearResults').click()
    setup(page)
    upload(page, 'renamed.png')
    start = time.perf_counter()
    page.locator('#startBtn').click()
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')", timeout=60000)
    second = time.perf_counter() - start
    note2 = page.locator('.target-ok').text_content()
    print('第二次耗时 %.2fs' % second, '提示:', note2)
    assert '缓存命中' in note2
    assert page.locator('.row-download').get_attribute('download') == 'renamed-min.webp'
    print('加速比: %.1fx' % (first / max(second, 0.001)))
    print('页面错误:', errors if errors else '无')
    assert not errors
    browser.close()
