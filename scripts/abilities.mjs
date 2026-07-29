import { chromium } from 'playwright';
const b=await chromium.launch({headless:true,executablePath:process.env.CHROME,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
const p=await b.newPage({viewport:{width:1280,height:720}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('http://localhost:5173/?gl&frames=100000',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>window.__voidrift,{timeout:120000});
await p.evaluate(()=>document.getElementById('renderCanvas').focus());
const settle=(ms)=>p.waitForTimeout(ms);
async function reset(){ await p.evaluate(()=>{const v=window.__voidrift,s=v.ship,fl=v.world.field;
  fl.depth.fill(0);fl.berm.fill(0);fl.glow.fill(0);fl.ice.fill(0);
  s.root.position.set(0,60,-100);s.yaw=0;s.pitch=0.05;s.velocity.set(0,0,0);
  v.chase.frozen=false;v.chase._pos.copyFrom(s.root.position);}); await settle(250); }
async function frameOn(kind){ await p.evaluate((kind)=>{const v=window.__voidrift,ab=v.abilities,fl=v.world.floor;
  let cx=0,cz=0;
  if(kind==='vortex'){cx=ab.vortex.x;cz=ab.vortex.z;}
  else if(kind==='implode'){cx=ab.implode.x;cz=ab.implode.z;}
  else if(kind==='crystal'){cx=ab.crystal.x;cz=ab.crystal.z;}
  else if(kind==='pulse'){cx=ab.pulse.ox;cz=ab.pulse.oz;}
  else {cx=ab._target.x;cz=ab._target.z;}
  v.chase.frozen=true;
  v.chase.cam.position.set(cx-70, fl.baseY+72, cz-96);
  v.chase.cam.setTarget(new v.ship.position.constructor(cx, fl.baseY+16, cz));
}, kind); }

await reset(); await p.keyboard.down('Digit2'); await settle(900); await frameOn('tractor'); await settle(500); await p.screenshot({path:'scripts/shots/ab_tractor.png'}); await p.keyboard.up('Digit2'); console.log('tractor');
await reset(); await p.keyboard.press('Digit1'); await settle(360); await frameOn('pulse'); await settle(220); await p.screenshot({path:'scripts/shots/ab_pulse.png'}); console.log('pulse');
await reset(); await p.keyboard.press('Digit3'); await settle(360); await frameOn('implode'); await settle(220); await p.screenshot({path:'scripts/shots/ab_implode.png'}); console.log('implode');
await reset(); await p.keyboard.press('Digit5'); await settle(700); await frameOn('vortex'); await settle(220); await p.screenshot({path:'scripts/shots/ab_vortex.png'}); console.log('vortex');
await reset(); await p.keyboard.press('Digit4'); await settle(800); await frameOn('crystal'); await settle(220); await p.screenshot({path:'scripts/shots/ab_crystal.png'}); console.log('crystal');
console.log('ERRS',errs.filter(e=>!e.includes('404')).slice(0,6));
await b.close();
