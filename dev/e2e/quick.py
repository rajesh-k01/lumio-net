import asyncio, os, sys
from playwright.async_api import async_playwright
HERE=os.path.dirname(os.path.abspath(__file__))
OUT=os.path.join(HERE,"shots")+os.sep
os.makedirs(OUT,exist_ok=True)
URL=sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:8766/"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        pg=await b.new_page(viewport={"width":1440,"height":900})
        await pg.goto(URL); await pg.wait_for_timeout(1200)
        await pg.click("#learn summary")
        await pg.set_input_files("#refA", os.path.join(HERE,"refA.png"))
        await pg.set_input_files("#refB", os.path.join(HERE,"refB.png"))
        await pg.click("#learnBtn"); await pg.wait_for_timeout(1800)
        print("curve visible:", await pg.is_visible("#curve"))
        await pg.screenshot(path=OUT+"04-learn.png")
        m=await b.new_page(viewport={"width":390,"height":844}, device_scale_factor=2)
        await m.goto(URL); await m.wait_for_timeout(1500)
        await m.click("#go"); await m.wait_for_function("document.getElementById('workspace').dataset.state==='done'"); await m.wait_for_timeout(1800)
        await m.screenshot(path=OUT+"10-mobile-done.png")
        await m.evaluate("window.scrollTo(0,900)"); await m.wait_for_timeout(400)
        await m.screenshot(path=OUT+"11-mobile-controls.png")
        await b.close()
asyncio.run(main())
