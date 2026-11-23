# -*- coding: utf-8 -*-
"""粗略对比 1 Worker 与自动并发的处理耗时。"""
import base64
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'dist' / '图片压缩器.html').as_uri()
FILES = ['large.png', 'large.png', 'large.png']


def upload(page):
    payload = []
    for i, name in enumerate(FILES):
        b64 = base64.b64encode((ROOT / 'test' / name).read_bytes()).decode()
        payload.append([f'bench-{i}.png', b64])
    page.evaluate("""(files) => {
      const dt = new DataTransfer();
      for (const [name, b64] of files) {
        const bin = atob(b64), arr = new Uint8Array(bin.length);
        for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
        dt.items.add(new File([arr], name, {type:'image/png'}));
      }
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    }""", payload)


def run(browser, hardware, label):
    context = browser.new_context()
    page = context.new_page()
    if hardware:
        page.add_init_script(f"Object.defineProperty(navigator, 'hardwareConcurrency', {{ get: () => {hardware} }});")
    page.goto(HTML)
    page.wait_for_function("document.getElementById('engineStatus').textContent.includes('就绪')", timeout=60000)
    page.locator('#skipBoot').dispatch_event('click')
    page.locator('#targetEnabled').check()
    page.locator('#targetValue').fill('400')
    page.locator('#targetUnit').select_option('1024')
    upload(page)
    start = time.perf_counter()
    page.locator('#startBtn').click()
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')", timeout=360000)
    elapsed = time.perf_counter() - start
    print(label, page.locator('#engineStatus').text_content(), '耗时 %.2fs' % elapsed)
    context.close()
    return elapsed


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader'])
    one = run(browser, 2, '1 Worker:')
    auto = run(browser, 8, '自动并发:')
    print('加速比: %.2fx' % (one / auto if auto else 0))
    browser.close()
