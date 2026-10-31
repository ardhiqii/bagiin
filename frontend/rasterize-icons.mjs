import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const PUB = '/opt/projects/bagiin-react/frontend/public'
const htmlFor = (svgPath, size) => {
  const b64 = fs.readFileSync(svgPath).toString('base64')
  return `<!doctype html><html><body style="margin:0;background:transparent">
  <img src="data:image/svg+xml;base64,${b64}" width="${size}" height="${size}"
   style="display:block;width:${size}px;height:${size}px"></body></html>`
}
const shot = async (b, svgPath, size, out) => {
  const page = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(htmlFor(svgPath, size))
  await page.waitForTimeout(150)
  const el = await page.$('img')
  await el.screenshot({ path: out, omitBackground: true })
  await page.close()
  console.log(path.basename(out), size, 'ok')
}

const b = await chromium.launch()
// ikon utama
for (const [name, size] of [['icon-32.png', 32], ['icon-180.png', 180], ['icon-192.png', 192],
                            ['icon-512.png', 512]]) {
  await shot(b, path.join(PUB, 'favicon.svg'), size, path.join(PUB, name))
}
await shot(b, path.join(PUB, 'icon-maskable-src.svg'), 512, path.join(PUB, 'icon-maskable-512.png'))
// ico: 16 px pakai geometri tanpa gerigi, 32/48 pakai penuh
await shot(b, path.join(path.dirname(PUB), 'brand', 'favicon-16.svg'), 16, '/tmp/ico-16.png')
await shot(b, path.join(PUB, 'favicon.svg'), 32, '/tmp/ico-32.png')
await shot(b, path.join(PUB, 'favicon.svg'), 48, '/tmp/ico-48.png')
await b.close()
