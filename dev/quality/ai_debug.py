"""Diagnose the LumioNet engine in the browser: log console + network.

    python3 dev/quality/ai_debug.py <url>
"""
import asyncio
import sys

from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8770/"
ARGS = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-software-rasterizer"]


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS, chromium_sandbox=False)
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        pg = await ctx.new_page()
        pg.on("console", lambda m: print(f"  [console.{m.type}] {m.text[:200]}", flush=True))
        pg.on("pageerror", lambda e: print(f"  [pageerror] {str(e)[:300]}", flush=True))
        pg.on("request", lambda r: print(f"  -> {r.url[:120]}", flush=True) if "onnxruntime" in r.url or "cdn" in r.url else None)
        pg.on("response", lambda r: print(f"  <- {r.status} {r.url[:120]}", flush=True) if "onnxruntime" in r.url else None)
        pg.on("requestfailed", lambda r: print(f"  !! FAILED {r.url[:120]} {r.failure}", flush=True))
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_timeout(2000)
        print("--- selecting LumioNet ---", flush=True)
        await pg.click('#engineNet input[value="lumionet"]')
        await pg.wait_for_timeout(500)
        await pg.set_input_files("#file", "/workspace/testdata/input_q60.jpg")
        await pg.wait_for_timeout(1500)
        print("--- clicking Enhance ---", flush=True)
        await pg.click("#go")
        for i in range(24):
            await pg.wait_for_timeout(5000)
            state = await pg.get_attribute("#workspace", "data-state")
            eta = await pg.inner_text("#eta")
            print(f"  t+{(i+1)*5:>3}s state={state} eta={eta!r}", flush=True)
            if state in ("done", "idle") and i > 0:
                break
        await b.close()


asyncio.run(main())
