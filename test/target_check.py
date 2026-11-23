# -*- coding: utf-8 -*-
"""目标大小 + 批量上传验收（离线 file://）。"""
import base64
import io
import sys
from pathlib import Path
from xml.etree import ElementTree
from PIL import Image
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / "test"


def file_payload(name, mime, filename):
    return (name, mime, base64.b64encode((TEST / filename).read_bytes()).decode())


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


def set_target(page, value, unit='1024'):
    page.locator('#targetValue').fill(str(value))
    page.locator('#targetUnit').select_option(unit)


def clear(page):
    page.locator('#clearResults').click()


def download_bytes(page, card_index=0):
    return page.evaluate("""async (index) => {
      const href = document.querySelectorAll('.card')[index].querySelector('tbody a').href;
      const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer());
      let s=''; for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    }""", card_index)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader'])
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto((ROOT / 'dist' / '图片压缩器.html').as_uri())
    page.wait_for_function("document.getElementById('status').textContent.includes('就绪')", timeout=30000)
    assert page.locator('#targetEnabled').is_checked()
    assert page.locator('#targetValue').input_value() == '500'

    # 1) 一次上传 3 个文件，目标 50 KB
    set_target(page, 50)
    upload(page, [
        file_payload('photo.jpg', 'image/jpeg', 'photo.jpg'),
        file_payload('sample.png', 'image/png', 'sample.png'),
        file_payload('logo.svg', 'image/svg+xml', 'logo.svg'),
    ])
    page.locator('#startBtn').click()
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')", timeout=120000)
    print('批量状态:', page.text_content('#status'))
    print('批量卡片数:', page.locator('.card').count())
    print('达标提示:', page.locator('.target-ok').all_text_contents())
    print('批量错误:', page.locator('.error').all_text_contents())
    # 按文件名找到 JPG 卡片（列表保留输入顺序）
    jpg_index = page.locator('.card').evaluate_all("(cards) => cards.findIndex(c => c.querySelector('.fname').textContent === 'photo.jpg')")
    jpg_bytes = base64.b64decode(download_bytes(page, jpg_index))
    jpg = Image.open(io.BytesIO(jpg_bytes))
    print('JPG 输出:', len(jpg_bytes), 'bytes /', jpg.size, '严格小于 51200:', len(jpg_bytes) < 50 * 1024)
    assert len(jpg_bytes) < 50 * 1024
    assert jpg.size == (1000, 700)

    # 2) PNG 目标 4 KB，必须压缩且保持 1000x700
    clear(page)
    set_target(page, 4)
    upload(page, [file_payload('sample.png', 'image/png', 'sample.png')])
    page.locator('#startBtn').click()
    page.wait_for_selector('.target-ok', timeout=120000)
    png_bytes = base64.b64decode(download_bytes(page))
    png = Image.open(io.BytesIO(png_bytes))
    print('PNG 输出:', len(png_bytes), 'bytes /', png.size, '严格小于 4096:', len(png_bytes) < 4096)
    print('PNG 提示:', page.locator('.target-ok').text_content())
    assert len(png_bytes) < 4096
    assert png.size == (1000, 700)

    # 3) SVG 目标 300 B，保留 viewBox
    clear(page)
    set_target(page, 300, '1')
    upload(page, [file_payload('logo.svg', 'image/svg+xml', 'logo.svg')])
    page.locator('#startBtn').click()
    page.wait_for_selector('.target-ok', timeout=120000)
    svg_text = base64.b64decode(download_bytes(page)).decode('utf-8')
    print('SVG viewBox 保留:', 'viewBox=' in svg_text, '输出字节:', len(svg_text.encode()))
    assert len(svg_text.encode()) < 300
    source_svg = ElementTree.parse(TEST / 'logo.svg').getroot()
    output_svg = ElementTree.fromstring(svg_text)
    for key in ('width', 'height', 'viewBox'):
        assert output_svg.get(key) == source_svg.get(key)

    # 原图与上限恰好相等时，必须实际压小才能通过。
    clear(page)
    set_target(page, (TEST / 'logo.svg').stat().st_size, '1')
    upload(page, [file_payload('logo.svg', 'image/svg+xml', 'logo.svg')])
    page.locator('#startBtn').click()
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')")
    assert len(base64.b64decode(download_bytes(page))) < (TEST / 'logo.svg').stat().st_size

    # 4) 目标 1 B 不可达：批量中明确失败，不返回“成功”超标文件
    clear(page)
    set_target(page, 1, '1')
    upload(page, [file_payload('sample.png', 'image/png', 'sample.png'), file_payload('photo.jpg', 'image/jpeg', 'photo.jpg')])
    page.locator('#startBtn').click()
    page.wait_for_function("document.getElementById('status').textContent.includes('本批完成')", timeout=120000)
    print('不可达状态:', page.text_content('#status'))
    print('不可达错误数:', page.locator('.error').count())
    print('不可达误报达标数:', page.locator('.target-ok').count())
    assert page.locator('.error').count() == 2
    assert page.locator('.target-ok').count() == 0
    print('页面错误:', errors if errors else '无')
    browser.close()
