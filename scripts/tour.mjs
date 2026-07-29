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

// 6. Carve a curved trench skimming low, then freeze an aerial view of the trail.
await p.evaluate(()=>{
  const v=window.__voidrift, s=v.ship, f=v.world.floor;
  const x=-160, z=-160; const y=f.baseY + f._baseHeight(x,z) + 20;
  s.root.position.set(x,y,z); s.yaw=0.5; s.pitch=0.05; s.velocity.set(0,0,0);
  v.chase._pos.copyFrom(s.root.position);
});
await p.keyboard.down('KeyW');
for (let i=0;i<11;i++){
  await settle(340);
  await p.evaluate(()=>{ const s=window.__voidrift.ship, f=window.__voidrift.world.floor; s.yaw += 0.14; const sy=f.baseY+f._baseHeight(s.root.position.x,s.root.position.z); if (s.root.position.y - sy > 34) s.root.position.y -= 5; });
}
await p.keyboard.up('KeyW');
// Freeze an aerial camera looking straight down at the carved path.
await p.evaluate(()=>{
  const v=window.__voidrift, s=v.ship;
  s.velocity.set(0,0,0);
  const cx=s.root.position.x, cz=s.root.position.z, cy=v.world.floor.baseY;
  v.chase.frozen=true;
  v.chase.cam.position.set(cx-40, cy+320, cz-40);
  const t=s.root.position.clone(); t.y=cy;
  v.chase.cam.setTarget(t);
});
await settle(2600);
await p.screenshot({path:'scripts/shots/6_trail.png'}); console.log('6 trail');

console.log('ERRS',errs.filter(e=>!e.includes('404')).slice(0,6));
await b.close();
