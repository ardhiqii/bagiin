"""Persistent browser E2E coverage through the real Bagiin SPA.

Unlike the HTTP suites, this layer starts an isolated uvicorn process and drives
headless Chromium through playwright-core.  The Node driver reports structured
DOM assertions so CI can skip cleanly when browser tooling is unavailable.
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent
BASE = "http://127.0.0.1:8087"
NODE_MODULES = Path("/tmp/e2e/node_modules/playwright-core")
CHROMIUM = Path(os.environ.get("BAGIIN_CHROMIUM", str(Path.home() / ".cache/ms-playwright/chromium-1234/chrome-linux64/chrome")))


def _H(identity: dict) -> dict:
    return {"X-Identity-Id": identity["id"], "X-Identity-Secret": identity["secret"]}


def _driver() -> str:
    return r'''
const { chromium } = require('/tmp/e2e/node_modules/playwright-core');
const BASE = process.env.E2E_BASE;
const EXE = process.env.E2E_CHROMIUM;
const checks = [], errors = [];
const check = (name, pass, detail='') => checks.push({name, pass: !!pass, detail: String(detail)});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, options={}) {
  const r = await fetch(BASE + path, options);
  const text = await r.text();
  if (!r.ok) throw new Error(`${options.method||'GET'} ${path} ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
function auth(id) { return {'X-Identity-Id': id.id, 'X-Identity-Secret': id.secret}; }
async function identity(name, creator=false) {
  return api('/api/identities', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name, creator})});
}
function inject(id) { return {content:`localStorage.setItem('bagiin_identity',${JSON.stringify(JSON.stringify({id:id.id,secret:id.secret}))});localStorage.setItem('bagiin_name',${JSON.stringify(JSON.stringify(id.name))});`}; }
async function pageFor(ctx, id, tag) {
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`); });
  p.on('pageerror', e => errors.push(`[${tag}] pageerror: ${e.message}`));
  await p.addInitScript(inject(id));
  return p;
}
async function ready(p, selector, timeout=8000) { await p.waitForSelector(selector, {state:'visible', timeout}); }
async function text(p, selector) { return p.locator(selector).allTextContents(); }
async function swipeLeft(p, rowSel) {
  await p.evaluate(sel => {
    const row=[...document.querySelectorAll(sel)].find(x=>x.innerText.includes('E2E Guest')) || document.querySelector(sel), front=row && row.querySelector('.swipe-front');
    if (!front) throw new Error('swipe front missing');
    const r=front.getBoundingClientRect(), y=r.top+r.height/2, x0=r.left+30;
    const mk=(type,x)=>new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',isPrimary:true,clientX:x,clientY:y});
    front.dispatchEvent(mk('pointerdown',x0));
    for(let i=1;i<=6;i++) front.dispatchEvent(mk('pointermove',x0+i*18));
    front.dispatchEvent(mk('pointerup',x0+108));
  }, rowSel);
  await sleep(300);
}
async function clickAndWait(p, sel, waitSel) { await p.locator(sel).click(); await ready(p, waitSel); }
(async () => {
  const owner=await identity('E2E Owner', true), guest=await identity('E2E Guest');
  // Seed a shared bill through the API so the real create form exposes Guest
  // as a contact; the journey bill itself is still created only through UI.
  const seed=await api('/api/bills',{method:'POST',headers:{...auth(owner),'content-type':'application/json'},body:JSON.stringify({title:'contact seed',merchant:'seed',items:[{name:'seed',price:1}],participants:[],participant_count:2,subtotal:1,tax:0,service:0,total:1,tax_included:false})});
  await api(`/api/bills/${seed.id}/join`,{method:'POST',headers:auth(guest)});
  const browser=await chromium.launch({executablePath:EXE,headless:true});
  try {
    const ownerCtx=await browser.newContext({viewport:{width:1280,height:900}}), ownerPage=await pageFor(ownerCtx,owner,'owner');
    await ownerPage.goto(BASE+'/#/',{waitUntil:'networkidle'}); await ready(ownerPage,'#create-btn');
    check('owner.home-renders', await ownerPage.locator('#create-btn').count()===1);
    await ownerPage.locator('#create-btn').click(); await ready(ownerPage,'#manual-btn');
    await ownerPage.locator('#manual-btn').click(); await ready(ownerPage,'#create-bill-btn');
    await ownerPage.locator('#title-input').fill('UI Dinner');
    await ownerPage.locator('#items-list [data-role=name]').first().fill('Nasi Goreng');
    await ownerPage.locator('#items-list [data-role=price]').first().fill('10000');
    await ownerPage.locator('details.progressive-section').last().locator('summary').click();
    await ownerPage.locator('#person-name-input').fill('E2E Guest');
    await ownerPage.locator('#person-name-add').click();
    await ownerPage.locator('#paid-by-me').check();
    await ready(ownerPage,'#create-bill-btn:not([disabled])'); await ownerPage.locator('#create-bill-btn').click();
    await ownerPage.waitForURL(/#\/b\//); await ready(ownerPage,'#people-list');
    const billId=(await ownerPage.url()).split('#/b/')[1];
    // Ensure the seeded identity is a member of the journey bill.
    await api(`/api/bills/${billId}/join`,{method:'POST',headers:auth(guest)}).catch(()=>{});
    await ownerPage.reload({waitUntil:'networkidle'}); await ready(ownerPage,'#people-list');
    const rows=await ownerPage.locator('.person-row').evaluateAll(rs=>rs.map(r=>({name:r.querySelector('.person-name')?.innerText||'',kebabs:r.querySelectorAll('.kebab-btn').length,body:r.innerText})));
    const own=rows.find(r=>r.name.includes('E2E Owner')), gro=rows.find(r=>r.name.includes('E2E Guest'));
    check('owner.detail-renders', await ownerPage.locator('text=UI Dinner').count()>0);
    check('owner.own-row-nalangin-no-kebab', !!own && own.body.includes('Nalangin') && own.kebabs===0, JSON.stringify(own));
    check('owner.guest-row-kebab', !!gro && gro.kebabs===1, JSON.stringify(gro));

    const guestCtx=await browser.newContext({viewport:{width:390,height:844}}), guestPage=await pageFor(guestCtx,guest,'guest');
    await guestPage.goto(BASE+`/#/b/${billId}`,{waitUntil:'networkidle'}); await ready(guestPage,'.item-row');
    const before=await guestPage.locator('.item-row').first().innerText();
    await guestPage.locator('.item-row.item-tappable').first().click(); await sleep(500);
    const after=await guestPage.locator('.item-row').first().innerText();
    check('guest.pick-updates-share', before!==after && !after.includes('belum dipilih'), `${before} => ${after}`);

    await ownerPage.reload({waitUntil:'networkidle'}); await ready(ownerPage,'#people-list');
    await ownerPage.locator('.toggle-paid[data-id="'+guest.id+'"]').click(); await sleep(500); await ready(ownerPage,'#people-list');
    const paid=await ownerPage.locator('.person-row').filter({hasText:'E2E Guest'}).innerText();
    check('owner.marks-guest-paid', paid.includes('Lunas'), paid);
    await ownerPage.locator('.toggle-paid[data-id="'+guest.id+'"]').click(); await sleep(500); await ready(ownerPage,'#people-list');
    const unpaid=await ownerPage.locator('.person-row').filter({hasText:'E2E Guest'}).innerText();
    check('owner.unmarks-guest-paid', unpaid.includes('Tandai lunas'), unpaid);

    await swipeLeft(ownerPage,'.person-row.swipe-row');
    const swipe=await ownerPage.locator('.person-row.swipe-row:has-text("E2E Guest") .swipe-front').evaluate(e=>({transform:e.style.transform,active:e.closest('.person-row').classList.contains('swipe-active')}));
    check('owner.swipe-reveals-delete', swipe.transform.includes('84px') && swipe.active, JSON.stringify(swipe));
    await ownerPage.locator('.person-row.swipe-row:has-text("E2E Guest") .swipe-del').evaluate(e=>e.click()); await ready(ownerPage,'.sheet');
    check('owner.delete-confirm-sheet', (await ownerPage.locator('.sheet').innerText()).includes('E2E Guest'));
    await ownerPage.locator('.sheet .btn-ghost, .sheet button:has-text("Batal")').first().click(); await sleep(250);
    check('owner.cancel-delete-keeps-bill', await ownerPage.locator('#people-list').count()===1 && (await ownerPage.locator('body').innerText()).includes('UI Dinner'));

    await ownerPage.goto(BASE+'/#/settings',{waitUntil:'networkidle'}); await ready(ownerPage,'#add-account-btn');
    await ownerPage.locator('#add-account-btn').click(); await ready(ownerPage,'#account-form:not(.hidden)');
    await ownerPage.locator('#acct-brand').selectOption({index:0}); await ownerPage.locator('#acct-no').fill('1234567890'); await ownerPage.locator('#save-account').click(); await ready(ownerPage,'.brand-logo img'); await sleep(500);
    const logos=await ownerPage.locator('.brand-logo').evaluateAll(bs=>bs.map(b=>({w:b.offsetWidth,h:b.offsetHeight,nw:b.querySelector('img')?.naturalWidth||0})));
    check('settings.logo-loads', logos.length>=1 && logos.every(x=>x.nw>0), JSON.stringify(logos));
    check('settings.logo-box-uniform-48x28', logos.length>=1 && logos.every(x=>x.w===48&&x.h===28), JSON.stringify(logos));
    await ownerCtx.close(); await guestCtx.close();
  } finally { await browser.close(); }
  check('console-and-pageerror-zero', errors.length===0, errors.join('\n'));
  const result={pass:checks.every(c=>c.pass)&&errors.length===0,checks};
  process.stdout.write(JSON.stringify(result)+'\n');
})().catch(e=>{ process.stdout.write(JSON.stringify({pass:false,checks:[{name:'driver-fatal',pass:false,detail:e.stack||String(e)}]})+'\n'); process.exitCode=1; });
'''


@pytest.fixture
def browser_server():
    if not NODE_MODULES.is_dir():
        pytest.skip(f"missing playwright-core: {NODE_MODULES}")
    if not CHROMIUM.is_file():
        pytest.skip(f"missing chromium binary: {CHROMIUM}")
    token = uuid.uuid4().hex
    db = Path(f"/tmp/bagiin-browsere2e-{token}.db")
    uploads = Path(f"/tmp/bagiin-browsere2e-up-{token}")
    uploads.mkdir(parents=True)
    env = os.environ.copy()
    env.update(BAGIIN_DB=str(db), BAGIIN_UPLOAD_DIR=str(uploads))
    proc = subprocess.Popen([str(BACKEND/'venv/bin/python'),'-m','uvicorn','main:app','--host','127.0.0.1','--port','8087'],cwd=BACKEND,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.STDOUT)
    try:
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            if proc.poll() is not None: raise RuntimeError(f"uvicorn exited {proc.returncode}")
            try:
                import urllib.request
                if urllib.request.urlopen(BASE+'/',timeout=1).status==200: break
            except Exception: time.sleep(.1)
        else: raise RuntimeError('uvicorn did not become ready')
        yield
    finally:
        if proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
            try: proc.wait(timeout=8)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=5)
        db.unlink(missing_ok=True); shutil.rmtree(uploads,ignore_errors=True)


def test_browser_user_journey(browser_server):
    """Exercise creation, sharing, payment state, deletion gesture, and settings."""
    with tempfile.TemporaryDirectory(prefix="bagiin-browser-driver-") as td:
        script=Path(td)/"driver.js"; script.write_text(_driver(),encoding="utf-8")
        run=subprocess.run(["node",str(script)],env={**os.environ,"E2E_BASE":BASE,"E2E_CHROMIUM":str(CHROMIUM)},cwd=BACKEND,text=True,capture_output=True,timeout=90)
    lines=[line for line in run.stdout.splitlines() if line.strip()]
    assert lines, f"driver produced no JSON output; stderr={run.stderr}"
    result=json.loads(lines[-1])
    print("BROWSER_E2E_JSON=" + json.dumps(result, ensure_ascii=False))
    assert result["pass"], json.dumps(result,ensure_ascii=False,indent=2)
    assert run.returncode==0, run.stderr

