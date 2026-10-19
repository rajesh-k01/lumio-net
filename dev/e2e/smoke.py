import asyncio, os, sys
from playwright.async_api import async_playwright
HERE=os.path.dirname(os.path.abspath(__file__))
OUT=os.path.join(HERE,"shots")+os.sep
os.makedirs(OUT,exist_ok=True)
URL=sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:8765/"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        pg=await b.new_page(viewport={"width":1440,"height":900})
        errs=[]
        pg.on("console", lambda m: errs.append(m.text) if m.type in("error","warning") else None)
        pg.on("pageerror", lambda e: errs.append("PAGEERROR "+str(e)))
        pg.on("requestfailed", lambda r: errs.append("REQFAIL "+r.url))
        await pg.goto(URL); await pg.wait_for_timeout(1800)
        await pg.screenshot(path=OUT+"01-idle.png")
        await pg.click("#go"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUT+"02-busy.png")
        await pg.wait_for_function("document.getElementById('workspace').dataset.state==='done'", timeout=60000)
        await pg.wait_for_timeout(2200)
        await pg.screenshot(path=OUT+"03-done.png")
        print("meta:", await pg.inner_text("#meta"), "| eta:", await pg.inner_text("#eta"))
        print("errors:", errs)
        await b.close()
asyncio.run(main())
