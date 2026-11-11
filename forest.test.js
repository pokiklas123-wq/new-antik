'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Navigation}=require('./navigation'),{CombatWorld}=require('./combat'),forest=require('./forest'),{ZONES}=require('./world-layout');
const nav=new Navigation(path.join(__dirname,'world-nav.json')),zone=ZONES.find(z=>z.id==='forest');
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const tick=(w,n)=>{for(let i=0;i<n;i++)w.tick(.05);};
function make(){const w=new CombatWorld(nav),r=w.join('p'),p=w.players.get('p'),group=r.monsters.filter(m=>m.zone==='forest');r.monsters=group;return {w,r,p,group,boss:group[0]};}
function open(){
 const cells=nav.region(zone,true).components.reduce((a,b)=>a.length>b.length?a:b,[]);
 for(const i of cells){const p=nav.point(i);if(dist(p,zone)>85)continue;
  if([-8,0,8].every(dx=>[-8,0,8].every(dz=>nav.walkable(p.x+dx,p.z+dz,true)&&nav.clear({x:p.x,y:p.y+.7,z:p.z},{x:p.x+dx,y:nav.height(p.x+dx,p.z+dz)+.7,z:p.z+dz}))))return p;
 }throw Error('no open forest square');
}
const put=(p,x,z)=>Object.assign(p,{x,z,y:nav.height(x,z),positioned:true,groundEligible:true,yaw:0,hp:10000});
function melee(boss,hp){const c=make(),m=c.group.find(m=>m.boss===boss),pt=open();c.r.monsters=[m];Object.assign(m,pt,{hp:hp??m.hp,state:'idle',target:null,attackAt:0,pathAt:0,waypoint:null});put(c.p,pt.x,pt.z+1.8);return {...c,m};}
test('forest has one 300 HP boss and nineteen 60 HP minions distributed across its extent',()=>{
 const c=make();assert.equal(c.group.length,20);assert.equal(c.boss.hp,300);assert(c.group.slice(1).every(m=>m.hp===60));
 assert(Math.max(...c.group.map(m=>m.x))-Math.min(...c.group.map(m=>m.x))>190);
 assert(Math.max(...c.group.map(m=>m.z))-Math.min(...c.group.map(m=>m.z))>190);
});
test('every minion independently patrols, bounded to the forest, without roll or teleports',()=>{
 const c=make(),travel=new Map(c.group.map(m=>[m.id,0]));
 for(let i=0;i<600;i++){const before=c.group.map(m=>({...m}));c.w.tick(.05);for(let j=0;j<c.group.length;j++){
  const m=c.group[j],step=dist(m,before[j]);assert(step<=.351);assert(nav.walkable(m.x,m.z,m.boss));assert(dist(m,zone)<=zone.radius);assert.notEqual(m.state,'roll');travel.set(m.id,travel.get(m.id)+step);
 }}
 for(const m of c.group)assert(travel.get(m.id)>60,'independent patrol '+m.id);
 const goals=c.group.filter(m=>!m.boss&&m.patrol?.length).map(m=>{const p=m.patrol.at(-1);return p.x+','+p.z;});assert(new Set(goals).size>=12);
});
test('venom strike hits once for exactly 7 / 10 / 12, with rage strictly below 100 HP',()=>{
 for(const [boss,hp,damage] of [[false,60,7],[true,300,10],[true,100,10],[true,99,12]]){
  const c=melee(boss,hp);c.w.tick(.05);assert.equal(c.m.state,'attack');assert.equal(c.p.hp,10000);
  tick(c.w,15);assert.equal(c.p.hp,10000);tick(c.w,2);assert.equal(c.p.hp,10000-damage);
  tick(c.w,20);assert.equal(c.p.hp,10000-damage);assert.equal(c.m.state,'attack');
  tick(c.w,5);assert.notEqual(c.m.state,'roll');assert.equal(c.w.snapshot(c.p).monsters[0].enraged,boss&&hp<100);
 }
});
test('forest strikes cannot hit through obstacles or a player who has escaped the region',()=>{
 const c=melee(false),clear=nav.clear;c.w.tick(.05);nav.clear=()=>false;
 try{tick(c.w,20);assert.equal(c.p.hp,10000);}finally{nav.clear=clear;}
 const d=melee(true,99);d.w.tick(.05);put(d.p,zone.x,zone.z-zone.radius-2);tick(d.w,30);assert.equal(d.p.hp,10000);assert.equal(d.m.target,null);assert.notEqual(d.m.state,'attack');
});
test('nearby snakes approach distinct flanking slots rather than one shared target point',()=>{
 const c=make(),pt=open();put(c.p,pt.x,pt.z);const goals=[];
 for(const m of c.group.slice(1,9)){Object.assign(m,pt,{x:pt.x+8,y:nav.height(pt.x+8,pt.z)});const q=forest.approach(c.w,c.r,m,c.p);assert(Number.isFinite(q.x+q.z));goals.push(q.x.toFixed(2)+','+q.z.toFixed(2));}
 assert(new Set(goals).size>=6);
});
test('movement keeps working while the two-second strike is playing',()=>{
 const c=melee(false);c.w.tick(.05);let moving=0;
 for(let i=0;i<20;i++){c.p.z+=.18;c.p.y=nav.height(c.p.x,c.p.z);const before={...c.m};c.w.tick(.05);if(dist(c.m,before)>.01)moving++;assert.notEqual(c.m.state,'roll');}
 assert(moving>12);
});
test('long-body hitscan is finite on the tail and misses above the snake',()=>{
 const m={x:0,y:0,z:0,yaw:0,boss:true};assert(Number.isFinite(forest.rayHit(m,{x:-5,y:1,z:-3.2},{x:1,y:0,z:0})));
 assert.equal(forest.rayHit(m,{x:-5,y:10,z:0},{x:1,y:0,z:0}),Infinity);
});
test('death snapshot is kept for the prepared 3-second Alaconda_Death clip',()=>{
 const c=melee(false);c.m.hp=0;c.w.state(c.m,'dead');c.w.time=2.9;assert(c.w.snapshot(c.p).monsters.some(m=>m.id===c.m.id));c.w.time=3.16;assert(!c.w.snapshot(c.p).monsters.some(m=>m.id===c.m.id));
});
test('20-player forest simulation stays bounded with independent targets and no roll',()=>{
 const c=make(),pt=open();for(let i=1;i<20;i++)c.w.join('p'+i,c.r.id);
 for(const [i,p] of [...c.r.players.values()].entries())put(p,pt.x+(i%5)*2,pt.z+Math.floor(i/5)*2);
 for(let f=0;f<250;f++){const before=c.group.map(m=>({...m}));c.w.tick(.05);for(let i=0;i<c.group.length;i++){const m=c.group[i];assert(Number.isFinite(m.x+m.y+m.z));assert(dist(m,before[i])<=.751);assert(nav.walkable(m.x,m.z,m.boss));assert(dist(m,zone)<=zone.radius);assert.notEqual(m.state,'roll');}}
 assert(nav.fields.size<=20);
});
function glb(name){const b=fs.readFileSync(path.join(__dirname,'../assets',name));return JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());}
test('actual GLB names match movement/strike/boss death; minion death stays prepared only',()=>{
 for(const name of ['Alaconda.glb','AlacondaBoss.glb']){const names=glb(name).animations.map(a=>a.name);assert(names.includes('Anaconda_CrawlSlither'));assert(names.includes('Anaconda_VenomStrike'));if(name==='AlacondaBoss.glb')assert(names.includes('Anaconda_Death'));}
 const client=fs.readFileSync(path.join(__dirname,'../java/MonsterWorld.java'),'utf8');const snakeBranch=client.slice(client.indexOf('if(m.kind>=4){'),client.indexOf('if(m.kind==2){'));
 assert(snakeBranch.includes('Alaconda_Death'));assert(!snakeBranch.includes('DeathRoll'));assert(!snakeBranch.includes('GroundedRollingBall'));
});
