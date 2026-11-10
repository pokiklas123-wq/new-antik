'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Navigation}=require('./navigation'),{CombatWorld}=require('./combat'),cemetery=require('./cemetery');
const {ZONES}=require('./world-layout');
const zone=ZONES.find(z=>z.id==='graveyard'),nav=new Navigation(path.join(__dirname,'world-nav.json'));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function make(){const events=[],w=new CombatWorld(nav,(id,type,data)=>events.push({id,type,data})),r=w.join('p'),p=w.players.get('p'),boss=r.monsters.find(m=>m.zone==='graveyard'&&m.boss);return {w,r,p,boss,events};}
function put(p,x,z){Object.assign(p,{x,z,y:nav.height(x,z),positioned:true,groundEligible:true,hp:10000,viewYaw:0,yaw:0,equipped:4});}
function tick(w,n){for(let i=0;i<n;i++)w.tick(.05);}
function openPoint(boss,heading=0){
 const g=nav.region(zone,true),component=g.components.reduce((a,b)=>a.length>b.length?a:b,[]);
 for(const i of component){const pt=nav.point(i);if(Math.hypot(pt.x-zone.x,pt.z-zone.z)>zone.radius-25)continue;
  const p={...pt,viewYaw:heading};if(cemetery.frontPoint({nav},boss,p))return pt;
 }
 throw Error('no safe close reveal point');
}
function isolate(c,minions=1){const ms=c.r.monsters.filter(m=>m.zone==='graveyard'&&!m.boss).slice(0,minions);c.r.monsters=[c.boss,...ms];return ms;}
function aim(p,m,sequence=1){const x=p.x,y=p.y+1,z=p.z,dx=m.x-x,dy=m.y+(m.boss?1.5:.6)-y,dz=m.z-z,l=Math.hypot(dx,dy,dz);return {weapon:4,sequence,x,y,z,dx:dx/l,dy:dy/l,dz:dz/l,range:180,viewYaw:p.viewYaw};}
function wake(c){const [m]=isolate(c);const pt=openPoint(c.boss);put(c.p,pt.x,pt.z);m.hp=0;c.w.state(m,'dead');cemetery.killed(c.w,c.r,m,c.p);tick(c.w,69);assert.equal(c.boss.teleports,1);return m;}

test('exactly 20 actors per region; only graveyard HP/model semantics change',()=>{
 const {r}=make();for(const z of ZONES){const ms=r.monsters.filter(m=>m.zone===z.id);assert.equal(ms.length,20);assert.equal(ms.filter(m=>m.boss).length,1);for(const m of ms)assert.equal(m.hp,z.id==='graveyard'||m.boss?300:100);}
});
test('graveyard boss remains dormant until a skeleton is actually killed inside its region',()=>{
 const c=make();put(c.p,zone.x,zone.z);tick(c.w,15);assert.equal(c.boss.state,'dormant');assert.equal(c.boss.teleports,0);
 const m=c.r.monsters.find(m=>m.zone==='graveyard'&&!m.boss);m.hp=10;m.target=c.p.id;tick(c.w,1);assert.equal(c.boss.state,'dormant');
 cemetery.killed(c.w,c.r,{zone:'forest',boss:false},c.p);assert.equal(c.boss.state,'dormant');
 put(c.p,zone.x,zone.radius+1);cemetery.killed(c.w,c.r,m,c.p);assert.equal(c.boss.state,'dormant');
});
test('a server-confirmed skeleton kill starts rise exactly once',()=>{
 const c=make(),[m]=isolate(c);const pt=openPoint(c.boss);put(c.p,pt.x,pt.z);Object.assign(m,{x:c.p.x,y:c.p.y,z:c.p.z+4,hp:1});
 assert(nav.clear({x:c.p.x,y:c.p.y+1,z:c.p.z},{x:m.x,y:m.y+.6,z:m.z}));
 assert(c.w.shoot(c.p.id,aim(c.p,m)));assert.equal(m.hp,0);assert.equal(c.boss.state,'rise');assert(c.boss.awakened);
 const revision=c.boss.revision;cemetery.killed(c.w,c.r,m,c.p);assert.equal(c.boss.revision,revision);
});
test('reveal is very close in camera-forward direction at cardinal and diagonal headings',()=>{
 for(const heading of [0,45,90,135,180,225,270,315]){
  const c=make(),[m]=isolate(c),pt=openPoint(c.boss,heading);put(c.p,pt.x,pt.z);c.p.viewYaw=heading;c.p.yaw=heading+180;
  cemetery.killed(c.w,c.r,m,c.p);tick(c.w,69);
  assert.equal(c.boss.teleports,1);assert.equal(c.boss.state,'scream');
  const a=heading*Math.PI/180,dx=c.boss.x-c.p.x,dz=c.boss.z-c.p.z,d=distance(c.boss,c.p);
  assert(d>=1.34&&d<=2.21);assert(Math.abs(dx*Math.cos(a)-dz*Math.sin(a))<1e-7);assert(dx*Math.sin(a)+dz*Math.cos(a)>0);
  assert.equal(c.boss.vx,0);assert.equal(c.boss.vz,0);assert(nav.walkable(c.boss.x,c.boss.z,true));
 }
});
test('blocked reveal retries in front instead of teleporting behind, into walls, or far away',()=>{
 const c=make(),[m]=isolate(c),pt=openPoint(c.boss);put(c.p,pt.x,pt.z);cemetery.killed(c.w,c.r,m,c.p);
 const realClear=nav.clear;nav.clear=()=>false;try{tick(c.w,80);assert.equal(c.boss.teleports,0);assert.equal(c.boss.state,'rise');}finally{nav.clear=realClear;}
 tick(c.w,1);assert.equal(c.boss.teleports,1);
});
test('rise does not teleport to a dead/disconnected/outside player; safe re-entry resumes reveal',()=>{
 const c=make(),[m]=isolate(c),pt=openPoint(c.boss);put(c.p,pt.x,pt.z);cemetery.killed(c.w,c.r,m,c.p);put(c.p,zone.x,zone.radius+10);tick(c.w,80);assert.equal(c.boss.teleports,0);
 put(c.p,pt.x,pt.z);tick(c.w,1);assert.equal(c.boss.teleports,1);
});
test('one reveal per room, including multiple players, additional kills and re-entry',()=>{
 const c=make();wake(c);c.w.join('q',c.r.id);const q=c.w.players.get('q');Object.assign(q,c.p,{id:'q',roomId:c.r.id});
 tick(c.w,65);const start=c.boss.teleports;cemetery.killed(c.w,c.r,{zone:'graveyard',boss:false},q);tick(c.w,10);assert.equal(c.boss.teleports,start);
 put(c.p,zone.x,zone.radius+10);put(q,zone.x,zone.radius+10);tick(c.w,10);const pt=openPoint(c.boss);put(c.p,pt.x,pt.z);tick(c.w,10);assert.equal(c.boss.teleports,1);
 const next=c.w.join('fresh',undefined,true).monsters.find(m=>m.zone==='graveyard'&&m.boss);assert.equal(next.teleports,0);assert.equal(next.state,'dormant');
});
test('full scream is followed by attack with unchanged 12 damage and readable windup',()=>{
 const c=make();wake(c);const hp=c.p.hp;tick(c.w,62);assert.equal(c.boss.state,'attack');assert.equal(c.p.hp,hp);tick(c.w,13);assert.equal(c.p.hp,hp-12);tick(c.w,3);assert.equal(c.p.hp,hp-12);
});
test('low HP phase is strictly below 100, moderately faster, never changes attack damage',()=>{
 for(const hp of [100,99]){
  const c=make(),[m]=isolate(c);c.r.monsters=[c.boss];const pt=openPoint(c.boss);put(c.p,pt.x,pt.z);
  Object.assign(c.boss,{...pt,z:pt.z+12,y:nav.height(pt.x,pt.z+12),awakened:true,teleports:1,hp,state:'idle',attackAt:100});
  let max=0;for(let k=0;k<10;k++){const old={x:c.boss.x,z:c.boss.z};c.w.tick(.05);max=Math.max(max,distance(c.boss,old)/.05);}
  assert(max<=(hp===100?13:14.5)+1e-6);assert(max>12.9);assert.equal(c.w.snapshot(c.p).monsters.find(m=>m.boss).enraged,hp<100);
 }
});
test('skeleton flanking uses distinct front/rear slots without changing 12m/s speed',()=>{
 const c=make(),ms=isolate(c,8),pt=openPoint(c.boss);put(c.p,pt.x,pt.z);const targets=[];
 const move=c.w.moveMonster;c.w.moveMonster=function(m,p,speed,dt,...rest){if(!m.boss){targets.push({id:m.id,x:p.x,z:p.z,speed});}return move.call(this,m,p,speed,dt,...rest);};
 for(const m of ms)Object.assign(m,{x:pt.x+12,y:nav.height(pt.x+12,pt.z),z:pt.z,attackAt:100,target:null});
 c.w.tick(.05);assert(targets.length>=4);assert(targets.some(q=>q.z>c.p.z+2));assert(targets.some(q=>q.z<c.p.z-2));assert(targets.every(q=>q.speed===12));
});
test('leaving the boundary cancels a skeleton strike immediately and returns it at run speed',()=>{
 const c=make(),[m]=isolate(c),pt=openPoint(c.boss);put(c.p,pt.x,pt.z);
 Object.assign(m,{x:pt.x+2,z:pt.z,y:nav.height(pt.x+2,pt.z),state:'attack',since:0,target:c.p.id,hitDone:false});const old={x:m.x,z:m.z};
 put(c.p,zone.x,zone.radius+1);c.w.tick(.05);assert.equal(m.state,'return');assert.equal(m.target,null);assert(m.hitDone);assert(distance(m,old)>.01);assert(distance(m,old)<=.601);assert.equal(c.p.hp,10000);
 tick(c.w,150);assert(Math.hypot(m.x-zone.x,m.z-zone.z)<=zone.radius);assert.equal(m.hp,300);
});
test('ranged attacks create server-owned visible projectiles and cannot hit outside the region',()=>{
 const c=make();wake(c);tick(c.w,62);const b=c.boss;put(c.p,b.x,b.z+10);b.state='idle';b.attackAt=0;b.waypoint=null;b.pathAt=0;c.w.tick(.05);assert.equal(b.attackKind,'orb');
 tick(c.w,12);assert((c.r.cemeteryProjectiles||[]).length>0);assert(c.w.snapshot(c.p).projectiles.length>0);
 const hp=c.p.hp;put(c.p,zone.x,zone.radius+10);tick(c.w,40);assert.equal(c.p.hp,10000);assert.equal(c.r.cemeteryProjectiles.length,0);
});
test('projectiles respect world collision and apply at most one normal damage hit',()=>{
 const c=make();c.r.monsters=[];const pt=openPoint(c.boss);put(c.p,pt.x,pt.z);
 const orb=()=>({id:1,x:c.p.x,y:c.p.y+1,z:c.p.z-2,dx:0,dy:0,dz:1,boss:true,speed:15,remaining:20,damage:12});
 c.r.cemeteryProjectiles=[orb()];const realRay=nav.ray;nav.ray=()=>.01;try{cemetery.tickProjectiles(c.w,c.r,.05);assert.equal(c.r.cemeteryProjectiles.length,0);assert.equal(c.p.hp,10000);}finally{nav.ray=realRay;}
 c.r.cemeteryProjectiles=[orb()];for(let i=0;i<10;i++)cemetery.tickProjectiles(c.w,c.r,.05);assert.equal(c.p.hp,9988);assert.equal(c.r.cemeteryProjectiles.length,0);
});
test('cemetery skeleton death remains in snapshots until its complete 1.65s clip',()=>{
 const c=make(),[m]=isolate(c),pt=openPoint(c.boss);put(c.p,pt.x,pt.z);Object.assign(m,pt,{hp:0,state:'dead',since:0});c.w.time=1.67;assert(c.w.snapshot(c.p).monsters.some(q=>q.id===m.id));c.w.time=1.81;assert(!c.w.snapshot(c.p).monsters.some(q=>q.id===m.id));
});
test('humanoid hitboxes cover skeleton head and boss upper torso, without changing damage',()=>{
 for(const boss of [false,true]){
  const m={x:0,y:12,z:0,boss};
  for(const h of (boss?[.5,1.5,3.3]:[.4,1.2,1.95]))assert(Number.isFinite(cemetery.rayHit(m,{x:0,y:12+h,z:-10},{x:0,y:0,z:1})), 'missed humanoid height '+h);
  assert.equal(cemetery.rayHit(m,{x:5,y:13,z:-10},{x:0,y:0,z:1}),Infinity);
  assert.equal(cemetery.rayHit(m,{x:0,y:20,z:-10},{x:0,y:0,z:1}),Infinity);
 }
});

test('20-player cemetery simulation stays inside navigation and has no repeat teleports',()=>{
 const c=make(),pt=openPoint(c.boss);c.r.monsters=c.r.monsters.filter(m=>m.zone==='graveyard');
 for(let i=1;i<20;i++)c.w.join('p'+i,c.r.id);
 for(const p of c.r.players.values())put(p,pt.x,pt.z);
 cemetery.killed(c.w,c.r,c.r.monsters.find(m=>!m.boss),c.p);
 const times=[];for(let frame=0;frame<500;frame++){
  const prev=c.r.monsters.map(m=>({...m})),t=performance.now();c.w.tick(.05);if(frame>40)times.push(performance.now()-t);
  for(let i=0;i<c.r.monsters.length;i++){const m=c.r.monsters[i],old=prev[i];assert(Number.isFinite(m.x+m.y+m.z));assert(nav.walkable(m.x,m.z,m.boss));assert(Math.hypot(m.x-zone.x,m.z-zone.z)<=zone.radius);if(m.teleports===old.teleports)assert(distance(m,old)<=.726);}
 }
 times.sort((a,b)=>a-b);assert.equal(c.boss.teleports,1);assert(nav.fields.size<=20);console.log(JSON.stringify({cemeteryPlayers:20,seconds:25,tickP95:times[Math.floor(times.length*.95)],projectiles:c.r.cemeteryProjectiles.length}));
});
