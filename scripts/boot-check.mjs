import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:5173/';
const b = await chromium.launch({ headless:true, executablePath:process.env.CHROME,
  args:['--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1024,height:576} });
const errs=[],warns=[]; p.on('pageerror',e=>errs.push(String(e)));
p.on('console',m=>{const t=m.type(); if(t==='error')errs.push(m.text()); else if(t==='warning')warns.push(m.text());});
await p.goto(URL,{waitUntil:'domcontentloaded'});
let booted=false;
try { await p.waitForFunction(()=>window.__voidrift||getComputedStyle(document.getElementById('fatal')).display!=='none',{timeout:60000});
  booted = await p.evaluate(()=>!!window.__voidrift); } catch(e){ console.log('timeout'); }
console.log('BOOTED', booted);
console.log('ERRS', errs.filter(e=>!e.includes('404')));
console.log('SHADERWARN', warns.filter(w=>/wgsl|shader|compil|uniform|attribute|effect|fatal/i.test(w)).slice(0,15));
await b.close();
