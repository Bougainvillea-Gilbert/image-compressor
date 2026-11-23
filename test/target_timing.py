# -*- coding: utf-8 -*-
"""回归：导入后再启用/修改目标大小，必须按开始时的值压缩。"""
import base64
import io
import sys
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / 'test'
HTML = (ROOT / 'dist' / '图片压缩器.html').as_uri()


def upload(page, path, name):
    b64 = base64.b64encode(path.read_bytes()).decode()
    page.evaluate("""([b64, name]) => {
      const bin = atob(b64), arr = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([arr], name, {type:'image/png'}));
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    }""", [b64, name])


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(HTML)
    page.wait_for_function("document.getElementById('status').textContent.includes('就绪')", timeout=30000)
    page.locator('#targetEnabled').uncheck()
    page.locator('#skipBoot').dispatch_event('click')

    # 先导入（此时目标关闭），再打开 400KB 目标，最后开始
    upload(page, TEST / 'large.png', 'large.png')
    page.locator('#targetEnabled').check()
    page.locator('#targetValue').fill('400')
    page.locator('#targetUnit').select_option('1024')
    page.locator('#startBtn').click()
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')", timeout=240000)
    print('状态:', page.locator('#status').text_content())
    print('状态标签:', page.locator('.card .state').text_content())
    assert '目标 400.0 KB' in page.locator('#status').text_content()
    assert page.locator('.card .state').text_content() == '达标'
    assert page.locator('.target-ok').count() == 1
    href = page.locator('.row-download').get_attribute('href')
    raw = page.evaluate("""async (href) => {
      const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer());
      let s=''; for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    }""", href)
    data = base64.b64decode(raw)
    im = Image.open(io.BytesIO(data))
    print('输出:', len(data), 'bytes /', im.size, '目标 409600 内:', len(data) < 400 * 1024)
    assert len(data) < 400 * 1024
    assert im.size == (1200, 800)
    page.screenshot(path=str(ROOT / 'dist' / '界面-目标400KB验证.png'), full_page=True)

    # 目标无效时不得悄悄按普通模式开始，也不得丢掉等待队列
    page.locator('#clearResults').click()
    upload(page, TEST / 'sample.png', 'sample.png')
    page.locator('#targetValue').fill('')
    page.locator('#startBtn').click()
    page.wait_for_timeout(300)
    print('无效目标提示:', page.locator('#status').text_content())
    assert '目标大小无效' in page.locator('#status').text_content()
    assert page.locator('.card[data-state="queued"]').count() == 1
    page.locator('#targetValue').fill('50')
    page.locator('#startBtn').click()
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')", timeout=120000)
    assert page.locator('.card .state').text_content() == '达标'
    print('修正目标后:', page.locator('#status').text_content())
    print('页面错误:', errors if errors else '无')
    assert not errors
    browser.close()
