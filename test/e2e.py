# -*- coding: utf-8 -*-
"""端到端实测：加载单 HTML，注入测试图，验证真实压缩结果。"""
import os
from pathlib import Path
import sys
import http.server
import socketserver
import threading
import base64

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

DIST = str(Path(__file__).resolve().parents[1] / 'dist')
TEST = str(Path(__file__).resolve().parents[1] / 'test')
PORT = 8878


def serve():
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("127.0.0.1", PORT), handler) as httpd:
        httpd.serve_forever()


os.chdir(DIST)
threading.Thread(target=serve, daemon=True).start()


def data_url(path, mime):
    with open(path, "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode())


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--use-angle=swiftshader"])
    page = browser.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))

    page.goto("http://127.0.0.1:" + str(PORT) + "/%E5%9B%BE%E7%89%87%E5%8E%8B%E7%BC%A9%E5%99%A8.html")
    page.wait_for_function("document.getElementById('status').textContent.includes('就绪')", timeout=30000)
    page.locator('#targetEnabled').uncheck()
    print("引擎状态:", page.text_content("#status"))

    files = []
    for name, mime, path in [
        ("sample.png", "image/png", os.path.join(TEST, "sample.png")),
        ("photo.jpg", "image/jpeg", os.path.join(TEST, "photo.jpg")),
        ("logo.svg", "image/svg+xml", os.path.join(TEST, "logo.svg")),
    ]:
        with open(path, "rb") as f:
            files.append((name, mime, f.read()))

    page.evaluate(
        """(files) => {
          const dt = new DataTransfer();
          for (const [name, mime, b64] of files) {
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
            dt.items.add(new File([arr], name, {type: mime}));
          }
          const input = document.getElementById('fileInput');
          input.files = dt.files;
          input.dispatchEvent(new Event('change', {bubbles:true}));
        }""",
        [(n, m, base64.b64encode(b).decode()) for n, m, b in files],
    )

    page.locator('#startBtn').click()
    page.wait_for_function("document.querySelectorAll('.card table').length >= 3", timeout=60000)
    page.wait_for_timeout(2000)  # 等误差计算收尾
    cards = page.evaluate(
        """() => [...document.querySelectorAll('.card')].map(c => ({
          name: c.querySelector('.fname').textContent,
          meta: c.querySelector('.fmeta').textContent,
          rows: [...c.querySelectorAll('tbody tr')].map(tr =>
            [...tr.querySelectorAll('td')].map(td => td.textContent.trim())),
          rec: !!c.querySelector('.rec')
        }))"""
    )
    for c in cards:
        print("\n=== %s (%s) ===" % (c["name"], c["meta"]))
        for row in c["rows"]:
            print("  " + " | ".join(row))
    print("\n控制台错误:", errors if errors else "无")
    browser.close()
