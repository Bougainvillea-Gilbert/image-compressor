# -*- coding: utf-8 -*-
"""按 compressor-ui-spec 验收真实行为并生成最终界面截图。"""
import base64
import io
import sys
import tempfile
import zipfile
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / 'test'
DIST = ROOT / 'dist'
HTML = (DIST / '图片压缩器.html').as_uri()


def payload(name, mime, source):
    return (name, mime, base64.b64encode((TEST / source).read_bytes()).decode())


def upload(page, files):
    page.evaluate("""(files) => {
      const dt = new DataTransfer();
      for (const [name, mime, b64] of files) {
        const bin = atob(b64), arr = new Uint8Array(bin.length);
        for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
        dt.items.add(new File([arr], name, {type: mime}));
      }
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    }""", files)


def wait_done(page):
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')", timeout=180000)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader'])
    context = browser.new_context(accept_downloads=True, viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    errors = []
    requests = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('request', lambda r: requests.append(r.url))
    page.goto(HTML)
    animation = page.evaluate("""() => ({
      duration: getComputedStyle(document.getElementById('boot-screen')).animationDuration,
      visible: getComputedStyle(document.getElementById('boot-screen')).visibility
    })""")
    print('入场动画:', animation)
    assert animation['duration'] == '1.15s'
    page.locator('#skipBoot').dispatch_event('click')
    assert 'skipped' in page.locator('#boot-screen').get_attribute('class')
    page.wait_for_function("document.getElementById('engineStatus').textContent.includes('就绪')", timeout=30000)
    print('真实引擎状态:', page.locator('#engineStatus').text_content())
    print('空状态下载禁用:', page.locator('#downloadZip').is_disabled(), page.locator('#downloadAll').is_disabled())
    assert page.locator('#downloadZip').is_disabled()
    assert page.locator('#dropzone').evaluate('(el) => el.classList.contains("has-files")') is False

    # reduced-motion：不应有启动遮罩
    reduced = context.new_page()
    reduced.emulate_media(reduced_motion='reduce')
    reduced.goto(HTML)
    reduced.wait_for_timeout(200)
    print('减少动效时启动层 display:', reduced.locator('#boot-screen').evaluate('(el) => getComputedStyle(el).display'))
    assert reduced.locator('#boot-screen').evaluate('(el) => getComputedStyle(el).display') == 'none'
    reduced.close()

    # 目标 50 KB：先导入，未点击开始前不得处理
    page.locator('#targetEnabled').check()
    page.locator('#targetValue').fill('50')
    page.locator('#targetUnit').select_option('1024')
    upload(page, [payload('photo.jpg', 'image/jpeg', 'photo.jpg'), payload('sample.png', 'image/png', 'sample.png'), payload('logo.svg', 'image/svg+xml', 'logo.svg')])
    immediate = page.evaluate("""() => ({
      cards: document.querySelectorAll('.card').length,
      queued: document.querySelectorAll('.card[data-state="queued"]').length,
      success: document.querySelectorAll('.card[data-state="success"]').length,
      startDisabled: document.getElementById('startBtn').disabled,
      order: [...document.querySelectorAll('.fname')].map(e => e.textContent)
    })""")
    print('导入未开始:', immediate)
    assert immediate['cards'] == 3 and immediate['queued'] == 3 and immediate['success'] == 0
    assert not immediate['startDisabled']
    assert immediate['order'] == ['photo.jpg', 'sample.png', 'logo.svg']
    page.locator('#startBtn').click()
    page.wait_for_timeout(100)
    print('处理中:', page.locator('#batchStats').text_content(), '|', page.locator('#batchCurrent').text_content())
    wait_done(page)
    print('完成:', page.locator('#status').text_content())
    print('达标标签:', page.locator('.target-ok').all_text_contents())
    assert page.locator('.card[data-state="success"]').count() == 3
    assert page.locator('.target-ok').count() == 3
    assert page.locator('#startBtn').is_disabled()

    # 保留一张展开详情，其余收起，生成供用户确认的真实界面截图
    for i in range(1, 3):
        page.locator('.card').nth(i).locator('.task-main').click()
    page.screenshot(path=str(DIST / '界面-白黄工业风.png'), full_page=True)

    with tempfile.TemporaryDirectory() as tmp:
        # 行内单个下载
        with page.expect_download() as single_info:
            page.locator('.card').first.locator('.row-download').click()
        single = single_info.value
        single_path = Path(tmp) / single.suggested_filename
        single.save_as(str(single_path))
        assert single_path.stat().st_size < 50 * 1024
        print('单个下载:', single.suggested_filename, single_path.stat().st_size)
        # ZIP 内容与真实字节校验
        with page.expect_download() as zip_info:
            page.locator('#downloadZip').click()
        zd = zip_info.value
        zp = Path(tmp) / zd.suggested_filename
        zd.save_as(str(zp))
        with zipfile.ZipFile(zp) as zf:
            names = zf.namelist()
            print('ZIP:', names)
            assert len(names) == 3
            for name in names:
                data = zf.read(name)
                assert len(data) < 50 * 1024
                if name.endswith(('.jpg', '.png')):
                    im = Image.open(io.BytesIO(data))
                    assert im.size == (1000, 700)

    # 未达标区域与重试
    page.locator('#clearResults').click()
    page.locator('#targetValue').fill('1')
    page.locator('#targetUnit').select_option('1')
    upload(page, [payload('sample.png', 'image/png', 'sample.png'), payload('photo.jpg', 'image/jpeg', 'photo.jpg')])
    page.locator('#startBtn').click()
    wait_done(page)
    print('未达标:', page.locator('#failureCount').text_content(), page.locator('.failure-row').count(), page.locator('.card[data-state="failed"] .state').all_text_contents())
    assert page.locator('.failure-row').count() == 2
    assert page.locator('.target-ok').count() == 0
    assert page.locator('#downloadZip').is_disabled()
    page.locator('#targetValue').fill('50')
    page.locator('#targetUnit').select_option('1024')
    page.locator('#retryFailed').click()
    wait_done(page)
    assert page.locator('#failuresPanel').is_hidden()
    assert page.locator('.card[data-state="success"]').count() == 2
    print('重试后:', page.locator('#status').text_content())

    # 普通多档模式仍可用
    page.locator('#clearResults').click()
    page.locator('#targetEnabled').uncheck()
    upload(page, [payload('logo.svg', 'image/svg+xml', 'logo.svg')])
    page.locator('#startBtn').click()
    wait_done(page)
    assert page.locator('.card table tbody tr').count() == 3
    print('普通模式:', page.locator('.card .state').text_content())

    # 窄屏无横向溢出
    narrow = context.new_page()
    narrow.set_viewport_size({'width': 390, 'height': 844})
    narrow.emulate_media(reduced_motion='reduce')
    narrow.goto(HTML)
    narrow.wait_for_timeout(500)
    overflow = narrow.evaluate('document.documentElement.scrollWidth > innerWidth')
    print('窄屏横向溢出:', overflow)
    assert not overflow
    narrow.close()
    print('网络请求:', [u for u in requests if u.startswith('http')])
    print('页面错误:', errors if errors else '无')
    assert not [u for u in requests if u.startswith('http')]
    assert not errors
    context.close()
    browser.close()
