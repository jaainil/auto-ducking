import { chromium } from 'playwright-core';
if (process.argv.includes('--release')) {
  await import('./smoke.mjs');
  process.exit(0);
}
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-crash-reporter']});
const errors=[];
const page = await browser.newPage();
page.on('pageerror', e=>errors.push(e.message));
await page.route('http://audioduck.local/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if(path==='/api/projects') return route.fulfill({json:{projects:[]}});
  const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
  const file=path==='/'?'index.html':path.slice(1);
  try { await route.fulfill({body:await readFile(resolve('dist',file)),contentType:type[extname(file)] || 'application/octet-stream'}); }
  catch { await route.fulfill({status:404,body:'Not found'}); }
});
await mkdir('output/verification',{recursive:true});
for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]) {
 await page.setViewportSize({width,height});
 await page.goto('http://audioduck.local/');
 await page.getByRole('heading',{name:/Auto-duck your music/}).waitFor();
 await page.evaluate(()=>document.fonts.ready);
 await page.locator('.juhenza-section').scrollIntoViewIfNeeded();
 await page.evaluate(async()=>{await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})));});
 await page.evaluate(()=>scrollTo(0,0));
 const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,inputs:document.querySelectorAll('input[type=file]').length}));
 if(metrics.scroll>metrics.width) throw new Error(`${name} overflows: ${JSON.stringify(metrics)}`);
 if(metrics.inputs!==3) throw new Error('Missing upload inputs');
 if(!await page.getByRole('button',{name:'Create mix'}).isDisabled()) throw new Error('Empty form permits submission');
 await page.getByRole('group',{name:'Project type'}).getByRole('button',{name:'Audio',exact:true}).click();
 const gap = await page.evaluate(()=>document.querySelector('.slot-grid').getBoundingClientRect().top-document.querySelector('.upload-mode').getBoundingClientRect().bottom);
 if(gap < 19) throw new Error(`${name} mode selector spacing too tight: ${gap}px`);
 if(await page.locator('input[type=file]').count()!==2) throw new Error('Audio mode must show voice and music inputs');
 await page.screenshot({path:`output/verification/${name}.png`,fullPage:true});
 console.log(`${name}: layout, upload inputs, audio-mode spacing and empty state verified`);
}
await browser.close();
if(errors.length) throw new Error(errors.join('\n'));
