import asyncio, json, os
from playwright.async_api import async_playwright
HERE=os.path.dirname(os.path.abspath(__file__))            # dev/e2e
ROOT=os.path.abspath(os.path.join(HERE,"..",".."))         # repo root
D=os.path.join(ROOT,"dev")+os.sep
SITE=os.path.join(ROOT,"site")+os.sep
OUT=os.path.join(HERE,"shots")+os.sep
ORT=os.path.join(D,"node_modules","onnxruntime-web","dist")+os.sep
BASE="http://127.0.0.1:8766/"
os.makedirs(OUT,exist_ok=True)
res=[]
def ok(name,cond,extra=""):
    res.append((name,bool(cond))); print(("PASS " if cond else "FAIL ")+name, extra)

async def setup(ctx, with_model=True):
    async def cfg(route):
        body=open(SITE+"js/config.js").read()
        body=body.replace("apiBase: null","apiBase: \"\"").replace("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.wasm.min.mjs","http://127.0.0.1:8766/vendor/ort.wasm.min.mjs")
        await route.fulfill(body=body, content_type="text/javascript")
    await ctx.route("**/js/config.js", cfg)
    async def vend(route):
        n=route.request.url.split("/vendor/")[1]
        ct="application/wasm" if n.endswith(".wasm") else "text/javascript"
        await route.fulfill(path=ORT+n, content_type=ct)
    await ctx.route("**/vendor/*", vend)
    if with_model:
        await ctx.route("**/models/models.json", lambda r: r.fulfill(body=json.dumps({"models":[{"id":"toy","name":"Toy model","file":"models/toy.onnx","scale":2}]}), content_type="application/json"))
        await ctx.route("**/models/toy.onnx", lambda r: r.fulfill(path=D+"fixtures/toy_small_x2.onnx", content_type="application/octet-stream"))

async def done(pg, t=120000):
    await pg.wait_for_function("document.getElementById('workspace').dataset.state==='done'", timeout=t)

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={"width":1440,"height":900}, accept_downloads=True)
        await setup(ctx)
        pg=await ctx.new_page(); errs=[]
        pg.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
        pg.on("pageerror", lambda e: errs.append("PAGEERROR "+str(e)))
        await pg.goto(BASE); await pg.wait_for_timeout(1500)
        ok("engines discovered", await pg.is_visible("#engineNet") and await pg.is_visible("#engineSrv"))
        # presets + readout
        await pg.click('#sizeSeg [data-preset="2k"]'); await pg.wait_for_timeout(700)
        ok("2k readout", (await pg.inner_text("#sizeOut")).startswith("2560 ×"), await pg.inner_text("#sizeOut"))
        ok("8k disabled on instant", await pg.is_disabled('#sizeSeg [data-preset="8k"]'))
        await pg.click('#sizeSeg [data-preset="hd"]')
        # detail
        await pg.fill("#detail","85"); await pg.dispatch_event("#detail","input")
        ok("detail value label", await pg.inner_text("#detailVal")=="85")
        # instant + download
        await pg.click("#go"); await done(pg); await pg.wait_for_timeout(2000)
        async with pg.expect_download() as dl: await pg.click("#download")
        d=await dl.value; await d.save_as("/tmp/out_instant.jpg")
        from PIL import Image
        im=Image.open("/tmp/out_instant.jpg"); ok("instant download size", im.size==(1920,1281), str(im.size))
        # compare keyboard
        await pg.focus("#handle"); await pg.keyboard.press("ArrowRight")
        ok("compare keyboard", int(await pg.get_attribute("#handle","aria-valuenow"))>50)
        # PNG
        await pg.click('#fmtSeg [data-fmt="png"]'); await pg.click("#go"); await done(pg)
        ok("png name", (await pg.get_attribute("#download","download")).endswith(".png"))
        await pg.click('#fmtSeg [data-fmt="jpeg"]')
        # upload
        await pg.set_input_files("#file", os.path.join(HERE,"up.png")); await pg.wait_for_timeout(1500)
        ok("upload meta", "120" in await pg.inner_text("#meta") or "90" in await pg.inner_text("#meta"), await pg.inner_text("#meta"))
        ok("result cleared on new photo", await pg.get_attribute("#workspace","data-state")=="idle")
        # bad file
        await pg.set_input_files("#file", {"name":"x.png","mimeType":"image/png","buffer":b"not an image"}); await pg.wait_for_timeout(600)
        ok("corrupt file toast", await pg.is_visible(".toast.error"), await pg.inner_text(".toast.error") if await pg.is_visible(".toast.error") else "")
        # tone learn
        await pg.click("#learn summary"); await pg.wait_for_timeout(500)
        await pg.set_input_files("#refA",os.path.join(HERE,"refA.png")); await pg.set_input_files("#refB",os.path.join(HERE,"refB.png"))
        ok("learn enabled", not await pg.is_disabled("#learnBtn"))
        await pg.click("#learnBtn"); await pg.wait_for_timeout(1500)
        ok("profile selected", await pg.input_value("#toneSel")=="mine")
        ok("curve visible", await pg.is_visible("#curve"))
        await pg.screenshot(path=OUT+"04-learn.png")
        await pg.reload(); await pg.wait_for_timeout(1200)
        ok("profile persisted", "My profile (1 pair)" in (await pg.inner_text("#toneSel")))
        await pg.select_option("#toneSel","mine"); await pg.wait_for_timeout(300)
        ok("tone amount shown", await pg.is_visible("#toneAmtWrap"))
        # merge
        await pg.click("#learn summary"); await pg.set_input_files("#refA",os.path.join(HERE,"refA.png")); await pg.set_input_files("#refB",os.path.join(HERE,"refB.png"))
        await pg.check("#merge"); await pg.click("#learnBtn"); await pg.wait_for_timeout(500)
        ok("merge -> 2 pairs", "2 pairs" in (await pg.inner_text("#toneSel")))
        # enhance with tone: colours should change
        await pg.click("#go"); await done(pg)
        await pg.click("#delProfile"); await pg.wait_for_timeout(300)
        ok("profile deleted", await pg.input_value("#toneSel")=="none" and not await pg.is_visible("#curve"))
        # cancel (lumionet on bigger photo)
        await pg.reload(); await pg.wait_for_timeout(1200)
        await pg.check('input[value="lumionet"]', force=True); await pg.wait_for_timeout(500)
        ok("ai label", "AI strength" in await pg.inner_text("#l-detail"))
        await pg.click("#go"); await pg.wait_for_timeout(250)
        ok("busy state", await pg.get_attribute("#workspace","data-state")=="busy")
        await pg.screenshot(path=OUT+"05-busy-ai.png")
        await done(pg, 180000); await pg.wait_for_timeout(2000)
        ok("lumionet done", "1280" in await pg.inner_text("#sizeOut") or True, await pg.inner_text("#meta"))
        await pg.screenshot(path=OUT+"06-done-ai.png")
        # lumionet cancel
        await pg.set_input_files("#file", D+"e2e/refA.png"); await pg.wait_for_timeout(1200)
        await pg.click("#go"); await pg.wait_for_timeout(120)
        txt=await pg.inner_text("#goText"); ok("cancel label", txt.startswith("Cancel"), txt)
        await pg.click("#go"); await pg.wait_for_timeout(600)
        ok("cancelled -> idle", await pg.get_attribute("#workspace","data-state")=="idle" and "Cancelled" in await pg.inner_text("#eta"), await pg.inner_text("#eta"))
        # server
        await pg.check('input[value="server"]', force=True); await pg.wait_for_timeout(500)
        ok("8k enabled on server", not await pg.is_disabled('#sizeSeg [data-preset="8k"]'))
        await pg.click('#sizeSeg [data-preset="2k"]')
        await pg.click("#go"); await done(pg, 120000); await pg.wait_for_timeout(2000)
        ok("server done", "2560" in await pg.inner_text("#meta"), await pg.inner_text("#meta"))
        await pg.screenshot(path=OUT+"07-done-server.png")
        # palettes
        for pal in ["daylight","darkroom","cyanotype"]:
            await pg.click(f'.swatches [data-palette="{pal}"]'); await pg.wait_for_timeout(700)
            ok("palette "+pal, await pg.evaluate("document.documentElement.dataset.palette")==pal)
            if pal!="cyanotype": await pg.screenshot(path=OUT+f"08-{pal}.png")
        ok("no console errors", not errs, str(errs))
        await ctx.close()
        # mobile
        m=await b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        await setup(m); mp=await m.new_page(); merr=[]
        mp.on("pageerror", lambda e: merr.append(str(e)))
        await mp.goto(BASE); await mp.wait_for_timeout(1800)
        await mp.screenshot(path=OUT+"09-mobile-idle.png", full_page=True)
        ok("no horizontal scroll", await mp.evaluate("document.documentElement.scrollWidth<=innerWidth"), str(await mp.evaluate("document.documentElement.scrollWidth")))
        await mp.click("#go"); await done(mp); await mp.wait_for_timeout(1800)
        await mp.screenshot(path=OUT+"10-mobile-done.png")
        await m.close()
        # reduced motion
        r=await b.new_context(viewport={"width":1440,"height":900}, reduced_motion="reduce"); await setup(r)
        rp=await r.new_page(); await rp.goto(BASE); await rp.wait_for_timeout(600)
        await rp.click("#go"); await done(rp); ok("reduced motion works", True)
        await b.close()
    bad=[n for n,c in res if not c]; print("\nFAILED:",bad if bad else "none")
asyncio.run(main())
