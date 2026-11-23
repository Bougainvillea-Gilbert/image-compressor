# -*- coding: utf-8 -*-
"""队列进度、失败重试、单个下载和 ZIP 验收。"""
import base64
import io
import sys
import tempfile
import zipfile
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / "test"


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
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')", timeout=150000)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader'])
    context = browser.new_context(accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto((ROOT / 'dist' / '图片压缩器.html').as_uri())
    page.wait_for_function("document.getElementById('status').textContent.includes('就绪')", timeout=30000)
    page.locator('#targetEnabled').uncheck()

    # 普通模式批量上传：事件返回时就应看到全部卡片
    upload(page, [
        payload('photo.jpg', 'image/jpeg', 'photo.jpg'),
        payload('sample.png', 'image/png', 'sample.png'),
        payload('logo.svg', 'image/svg+xml', 'logo.svg'),
    ])
    immediate = page.evaluate("""() => ({
      cards: document.querySelectorAll('.card').length,
      queued: document.querySelectorAll('.card[data-state="queued"]').length,
      batchVisible: !document.getElementById('batchPanel').hidden,
      stats: document.getElementById('batchStats').textContent
    })""")
    print('上传立即可见:', immediate)
    assert immediate['cards'] == 3
    assert immediate['batchVisible']
    page.locator('#startBtn').click()
    page.wait_for_timeout(80)
    print('处理中进度:', page.locator('#batchStats').text_content(), '|', page.locator('#batchCurrent').text_content())
    wait_done(page)
    print('完成进度:', page.locator('#batchStats').text_content())
    assert '100%' in page.locator('#batchStats').text_content()
    assert page.locator('.card[data-state="success"]').count() == 3

    with tempfile.TemporaryDirectory() as tmp:
        # 单个下载
        with page.expect_download() as single_info:
            page.locator('.card').first.locator('.row-download').click()
        single = single_info.value
        single_path = Path(tmp) / single.suggested_filename
        single.save_as(str(single_path))
        print('单个下载:', single.suggested_filename, single_path.stat().st_size, 'bytes')
        assert single_path.stat().st_size > 0

        # ZIP 打包下载
        with page.expect_download() as zip_info:
            page.locator('#downloadZip').click()
        zip_download = zip_info.value
        zip_path = Path(tmp) / zip_download.suggested_filename
        zip_download.save_as(str(zip_path))
        with zipfile.ZipFile(zip_path) as zf:
            names = zf.namelist()
            print('ZIP 文件:', zip_download.suggested_filename, '内容:', names)
            assert len(names) == 3
            assert all(not n.endswith('.txt') for n in names)
            for name in names:
                data = zf.read(name)
                if name.lower().endswith(('.jpg', '.png')):
                    Image.open(io.BytesIO(data)).verify()

    # 失败区域 + 重试
    page.locator('#clearResults').click()
    page.locator('#targetEnabled').check()
    page.locator('#targetValue').fill('1')
    page.locator('#targetUnit').select_option('1')
    upload(page, [payload('sample.png', 'image/png', 'sample.png'), payload('photo.jpg', 'image/jpeg', 'photo.jpg')])
    page.locator('#startBtn').click()
    wait_done(page)
    print('失败区域:', page.locator('#failureCount').text_content(), '条；卡片失败:', page.locator('.error').count())
    assert not page.locator('#failuresPanel').is_hidden()
    assert page.locator('.failure-row').count() == 2
    # 改成可达目标，重试全部失败文件
    page.locator('#targetValue').fill('50')
    page.locator('#targetUnit').select_option('1024')
    page.locator('#retryFailed').click()
    wait_done(page)
    print('重试后:', page.locator('#status').text_content(), '失败区隐藏:', page.locator('#failuresPanel').is_hidden())
    assert page.locator('#failuresPanel').is_hidden()
    assert page.locator('.card[data-state="success"]').count() == 2
    print('页面错误:', errors if errors else '无')
    context.close()
    browser.close()
