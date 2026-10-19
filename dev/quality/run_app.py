"""Run the app in a real browser on a given input and save the result.

    python3 dev/quality/run_app.py <input.jpg> <preset> <out.jpg> [url]
"""
import asyncio
import os
import sys
import time


URL = "http://127.0.0.1:8770/"


async def main():
    import playwright.async_api as pw

    inp, preset, out = sys.argv[1], sys.argv[2], sys.argv[3]
    url = sys.argv[4] if len(sys.argv) > 4 else URL
    ARGS = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-software-rasterizer"]
    async with pw.async_playwright() as p:
        b = await p.chromium.launch(args=ARGS, chromium_sandbox=False)
        ctx = await b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        await pg.goto(url, wait_until="load")
        await pg.wait_for_timeout(1500)
        await pg.set_input_files("#file", inp)
        await pg.wait_for_timeout(1200)
        await pg.click(f'#sizeSeg [data-preset="{preset}"]')
        await pg.wait_for_timeout(600)
        print("target   :", await pg.inner_text("#sizeOut"), flush=True)
        t0 = time.time()
        await pg.click("#go")
        try:
            await pg.wait_for_function("document.getElementById('workspace').dataset.state==='done'", timeout=900000)
        except Exception as e:
            print("FAILED   :", str(e)[:200], flush=True)
            print("eta      :", await pg.inner_text("#eta"), flush=True)
            print("errors   :", errs, flush=True)
            await b.close()
            return
        print("result   :", await pg.inner_text("#meta"), "|", await pg.inner_text("#eta"), f"| {time.time()-t0:.1f}s", flush=True)
        async with pg.expect_download() as dl:
            await pg.click("#download")
        d = await dl.value
        await d.save_as(out)
        print("saved    :", out, os.path.getsize(out) // 1024, "KB", flush=True)
        print("errors   :", errs if errs else "none", flush=True)
        await b.close()


asyncio.run(main())
