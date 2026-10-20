"""Drive the app's AI (LumioNet) engine in a real browser and save the result.

    python3 dev/quality/run_ai.py <input.jpg> <out.jpg> [url] [strength]

Checks that the LumioNet engine is offered, runs it, and writes the enhanced
photo to disk.
"""
import asyncio
import os
import sys
import time

from playwright.async_api import async_playwright

INP = sys.argv[1]
OUT = sys.argv[2]
URL = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8770/"
STRENGTH = int(sys.argv[4]) if len(sys.argv) > 4 else 100
ARGS = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-software-rasterizer"]


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS, chromium_sandbox=False)
        ctx = await b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True,
                                  ignore_https_errors=os.environ.get("IGNORE_TLS") == "1")
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errs.append(f"console: {m.text}") if m.type == "error" else None)
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_timeout(2000)
        print("engine note :", await pg.inner_text("#netNote"), flush=True)
        print("lumionet on :", await pg.is_visible("#engineNet"), flush=True)
        await pg.set_input_files("#file", INP)
        await pg.wait_for_timeout(1500)
        print("input       :", await pg.inner_text("#meta"), flush=True)
        # pick the AI engine and set the strength
        await pg.click('#engineNet input[value="lumionet"]')
        await pg.wait_for_timeout(600)
        await pg.fill("#detail", str(STRENGTH))
        await pg.dispatch_event("#detail", "input")
        await pg.wait_for_timeout(300)
        await pg.click(f'#sizeSeg [data-preset="{os.environ.get("PRESET","2k")}"]')
        await pg.wait_for_timeout(500)
        print("target      :", await pg.inner_text("#sizeOut"), flush=True)
        t0 = time.time()
        await pg.click("#go")
        await pg.wait_for_function("document.getElementById('workspace').dataset.state==='done'", timeout=900000)
        await pg.wait_for_timeout(1500)
        print("result      :", await pg.inner_text("#meta"), "|", await pg.inner_text("#eta"), f"| {time.time()-t0:.1f}s", flush=True)
        async with pg.expect_download() as dl:
            await pg.click("#download")
        d = await dl.value
        await d.save_as(OUT)
        print("saved       :", OUT, os.path.getsize(OUT) // 1024, "KB", flush=True)
        await pg.screenshot(path="/workspace/lumio-ai-engine.png")
        print("errors      :", errs if errs else "none", flush=True)
        await b.close()


asyncio.run(main())
