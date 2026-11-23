# -*- coding: utf-8 -*-
"""验收统一队列、停止当前任务、重跑任务。"""
import base64
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / 'test'
HTML = (ROOT / 'dist' / '图片压缩器.html').as_uri()


def upload(page, filename, mime='image/png'):
    b64 = base64.b64encode((TEST / filename).read_bytes()).decode()
    page.evaluate("""([b64, name, mime]) => {
      const bin = atob(b64), arr = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([arr], name, {type: mime}));
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    }""", [b64, filename, mime])


def set_target(page, value, unit='1024'):
    page.locator('#targetEnabled').check()
    page.locator('#targetValue').fill(str(value))
    page.locator('#targetUnit').select_option(unit)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(HTML)
    page.wait_for_function("document.getElementById('status').textContent.includes('就绪')", timeout=30000)
    page.locator('#skipBoot').dispatch_event('click')

    # 1) 分三次导入，必须只有一条队列、点击一次开始后全部处理
    set_target(page, 50)
    upload(page, 'sample.png')
    upload(page, 'logo.svg', 'image/svg+xml')
    upload(page, 'photo.jpg', 'image/jpeg')
    merged = page.evaluate("""() => ({
      cards: document.querySelectorAll('.card').length,
      total: document.getElementById('batchStats').textContent,
      panels: document.querySelectorAll('#batchPanel').length,
      startEnabled: !document.getElementById('startBtn').disabled
    })""")
    print('三次导入合并:', merged)
    assert merged['cards'] == 3
    assert '共 3 张' in merged['total']
    assert merged['panels'] == 1
    assert merged['startEnabled']
    page.locator('#startBtn').click()
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')", timeout=180000)
    assert page.locator('.card').count() == 3
    assert page.locator('.card[data-state="success"]').count() == 3
    print('合并队列完成:', page.locator('#batchStats').text_content())

    page.locator('#rerunTasks').click()
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')")
    assert page.locator('.card[data-state="success"] .fname').all_text_contents() == [
        'sample.png', 'logo.svg', 'photo.jpg'
    ]

    # 2) 处理中追加，不另开批次，动态队列继续处理
    page.locator('#clearResults').click()
    set_target(page, 400)
    upload(page, 'large.png')
    page.locator('#startBtn').click()
    page.wait_for_function("!document.getElementById('stopTask').disabled", timeout=30000)
    upload(page, 'sample.png')
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')", timeout=240000)
    appended = page.evaluate("""() => ({
      cards: document.querySelectorAll('.card').length,
      total: document.getElementById('batchStats').textContent,
      success: document.querySelectorAll('.card[data-state="success"]').length
    })""")
    print('处理中追加:', appended)
    assert appended['cards'] == 2
    assert '共 2 张' in appended['total']
    assert appended['success'] == 2

    page.locator('#rerunTasks').click()
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')")
    assert page.locator('.card[data-state="success"] .fname').all_text_contents() == [
        'large.png', 'sample.png'
    ]

    # 3) 停止当前任务 -> 重跑任务
    page.locator('#clearResults').click()
    set_target(page, 401)
    upload(page, 'large.png')
    page.evaluate("""async () => {
        document.getElementById('startBtn').click();
        await Promise.resolve();
        document.getElementById('stopTask').click();
    }""")
    page.wait_for_function(
        "document.getElementById('status').textContent.startsWith('任务已停止：')",
        timeout=10000,
    )
    assert page.locator('.card[data-state="stopped"]').count() == 1
    set_target(page, 400)
    print('停止状态:', page.locator('#status').text_content())
    print('停止标签:', page.locator('.card .state').all_text_contents())
    assert not page.locator('#rerunTasks').is_disabled()
    page.locator('#rerunTasks').click()
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')", timeout=240000)
    print('重跑结果:', page.locator('#status').text_content())
    assert page.locator('.card').count() == 1
    assert page.locator('.card[data-state="success"]').count() == 1
    assert page.locator('.card .state').text_content() == '达标'
    print('页面错误:', errors if errors else '无')
    assert not errors
    browser.close()
