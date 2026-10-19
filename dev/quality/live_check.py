"""Browser test against a deployed URL: load, enhance at a preset, download.

    python3 dev/quality/live_check.py <url> <preset> [input.jpg]
"""
import asyncio
import os
import sys
import time

from playwright.async_api import async_playwright

URL = sys.argv[1]
PRESET = sys.argv[2]
INPUT = sys.argv[3] if len(sys.argv) > 3 else "/workspace/testdata/input_q60.jpg"
ARGS = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-software-rasterizer"]


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS, chromium_sandbox=False)
        ctx = await b.new_context(viewport={"width": 1440, "height": 900},
                                  accept_downloads=True, ignore_https_errors=True)
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errs.append(f"console: {m.text}") if m.type == "error" else None)
        pg.on("requestfailed", lambda rq: errs.append(f"requestfailed: {rq.url}"))

        r = await pg.goto(URL, wait_until="load")
        await pg.wait_for_timeout(3000)
        print("HTTP        :", r.status if r else "?")
        print("landed on   :", pg.url)
        print("title       :", await pg.title())
        print("heading     :", await pg.inner_text(".intro h1"))
        print("8K enabled  :", await pg.is_enabled('#sizeSeg [data-preset="8k"]'))
        print("sample      :", await pg.inner_text("#meta"))

        if INPUT and os.path.exists(INPUT):
            await pg.set_input_files("#file", INPUT)
            await pg.wait_for_timeout(1500)
            print("input       :", await pg.inner_text("#meta"))
        await pg.click(f'#sizeSeg [data-preset="{PRESET}"]')
        await pg.wait_for_timeout(500)
        print(f"{PRESET} target   :", await pg.inner_text("#sizeOut"))
        t0 = time.time()
        await pg.click("#go")
        await pg.wait_for_function("document.getElementById('workspace').dataset.state==='done'", timeout=900000)
        await pg.wait_for_timeout(1500)
        print(f"{PRESET} result   :", await pg.inner_text("#meta"), "|", await pg.inner_text("#eta"), f"| {time.time()-t0:.1f}s")
        print("download    :", await pg.is_visible("#download"))
        await pg.screenshot(path="/workspace/lumio-live-8k.png")
        print("errors      :", errs if errs else "none")
        await b.close()


asyncio.run(main())
