"""Deployment smoke test: load the published app, run an enhancement, check the download.

    python3 dev/e2e/verify.py https://rajesh-k01.github.io/lumio-net/

Exits non-zero if the page errors out, if assets fail to load, or if the
Enhance button does not produce a downloadable result.
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "shots") + os.sep
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8766/"
ARGS = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-software-rasterizer"]


def ink(page, canvas_id):
    """Non-blank check: how many distinct pixels the canvas holds."""
    return page.evaluate(
        """(id) => {
            const c = document.getElementById(id);
            if (!c || !c.width) return 0;
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            const seen = new Set();
            for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]);
            return seen.size;
        }""",
        canvas_id,
    )


async def main():
    os.makedirs(OUT, exist_ok=True)
    problems = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS, chromium_sandbox=False)
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        pg.on("console", lambda m: problems.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        pg.on("requestfailed", lambda r: problems.append(f"requestfailed: {r.url} ({r.failure})"))

        resp = await pg.goto(URL, wait_until="load")
        print("HTTP status:", resp.status if resp else "?")
        if not resp or resp.status >= 400:
            problems.append(f"page returned {resp.status if resp else 'no response'}")

        await pg.wait_for_timeout(2500)

        title = await pg.title()
        print("title:", title)
        if "Lumio" not in title:
            problems.append(f"unexpected title: {title!r}")

        if await pg.is_visible("#engineNet"):
            print("LumioNet engine: visible")
        if await pg.is_visible("#engineSrv"):
            print("Server engine: visible")

        before_ink = await ink(pg, "before")
        print("sample canvas distinct colours:", before_ink)
        if before_ink < 5:
            problems.append("sample photo did not render (blank canvas)")

        # Run the default (Instant) engine.
        await pg.click("#go")
        try:
            await pg.wait_for_function("document.getElementById('workspace').dataset.state==='done'", timeout=60000)
        except Exception as e:
            problems.append(f"Enhance never finished: {e}")
        await pg.wait_for_timeout(1500)

        after_ink = await ink(pg, "after")
        print("result canvas distinct colours:", after_ink)
        meta = await pg.inner_text("#meta")
        print("meta:", meta)

        dl = await pg.get_attribute("#download", "href")
        visible = await pg.is_visible("#download")
        print("download visible:", visible, "href:", (dl or "")[:40])
        if not visible or not dl or not dl.startswith("blob:"):
            problems.append("no downloadable result")
        if "→" not in meta:
            problems.append(f"meta did not report the output size: {meta!r}")

        await pg.screenshot(path=OUT + "verify-desktop.png")
        m = await b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        await m.goto(URL, wait_until="load")
        await m.wait_for_timeout(2500)
        await m.screenshot(path=OUT + "verify-mobile.png")
        await b.close()

    if problems:
        print("\nFAILED:")
        for x in problems:
            print(" -", x)
        sys.exit(1)
    print("\nOK: the deployed app loads, enhances and offers a download.")


asyncio.run(main())
