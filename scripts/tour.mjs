import { chromium } from 'playwright';
const CHROME=process.env.CHROME;
const b = await chromium.launch({ headless:true, executablePath:CHROME,
  args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1280,height:720}, deviceScaleFactor:1 });
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('http://localhost:5173/?gl&frames=100000',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>window.__voidrift,{timeout:120000});
await p.evaluate(()=>document.getElementById('renderCanvas').focus());
const settle=(ms)=>p.waitForTimeout(ms);

// Aim helper: point the ship (and thus chase cam) at a world target.
async function aimAt(px,py,pz, tx,ty,tz){
  await p.evaluate(([px,py,pz,tx,ty,tz])=>{
    const v=window.__voidrift; const s=v.ship;
    s.root.position.set(px,py,pz);
    const dx=tx-px, dy=ty-py, dz=tz-pz;
    const hyp=Math.hypot(dx,dz);
    s.yaw=Math.atan2(dx,dz);
    s.pitch=-Math.atan2(dy,hyp);
    s.velocity.set(0,0,0); s.throttle=0;
    // snap camera instantly
    v.chase._pos.copyFrom(s.root.position);
  },[px,py,pz,tx,ty,tz]);
}

// 1. Boot / default framing
await settle(4000); await p.screenshot({path:'scripts/shots/1_boot.png'}); console.log('1 boot');

// 2. Black hole
await aimAt(-9400+2600, 2100+400, 7600-2600,  -9400,2100,7600);
await settle(5000); await p.screenshot({path:'scripts/shots/2_blackhole.png'}); console.log('2 bh');

// 3. Saturn
await aimAt(7200-2200, 2600+300, 12000-3000,  7200,2600,12000);
await settle(5000); await p.screenshot({path:'scripts/shots/3_saturn.png'}); console.log('3 saturn');

// 4. Low over the gas sea, flying + casting to carve deformation
await aimAt(0,96,-150, 30,18,120);
await p.keyboard.down('KeyW');
await settle(1600);
await p.keyboard.press('Digit1'); await settle(500);
await p.keyboard.press('Digit3'); await settle(1000);
await p.keyboard.press('Digit5'); await settle(1400);
await p.keyboard.up('KeyW');
await settle(1200);
await p.screenshot({path:'scripts/shots/4_gas_vfx.png'}); console.log('4 gas');

// 5. Boost low across the sea
await aimAt(0,88,-170, 50,30,150);
await p.keyboard.down('KeyW'); await p.keyboard.down('ShiftLeft');
await settle(3200);
await p.keyboard.up('ShiftLeft'); await p.keyboard.up('KeyW');
await p.screenshot({path:'scripts/shots/5_boost.png'}); console.log('5 boost');

console.log('ERRS',errs.filter(e=>!e.includes('404')).slice(0,6));
await b.close();
