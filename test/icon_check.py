# -*- coding: utf-8 -*-
from pathlib import Path
from playwright.sync_api import sync_playwright
import sys
sys.stdout.reconfigure(encoding='utf-8')
html = (Path(__file__).resolve().parents[1] / 'dist' / '图片压缩器.html').as_uri()
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--no-sandbox'])
    page = b.new_page()
    page.goto(html)
    page.wait_for_timeout(800)
    info = page.evaluate("""() => {
      const img = document.querySelector('.brand-mark');
      const icon = document.querySelector('link[rel=icon]');
      return new Promise(resolve => {
        const done = () => resolve({
          imgW: img.naturalWidth, imgH: img.naturalHeight,
          imgSrc: img.src.slice(0, 30),
          favicon: icon.href.slice(0, 30)
        });
        if (img.complete) done(); else { img.onload = done; img.onerror = done; }
      });
    }""")
    print(info)
    assert info['imgW'] > 0 and info['imgH'] > 0
    assert info['imgSrc'].startswith('data:image/png') and info['favicon'].startswith('data:image/png')
    b.close()
