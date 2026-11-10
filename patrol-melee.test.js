'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Navigation}=require('./navigation'),{CombatWorld}=require('./combat');
const {ZONES,caveClearance}=require('./world-layout');
const nav=new Navigation(path.join(__dirname,'world-nav.json'));
const make=()=>{const w=new CombatWorld(nav),r=w.join('p'),p=w.players.get('p');return {w,r,p};};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const tick=(w,n)=>{for(let i=0;i<n;i++)w.tick(.05);};

test('farthest-point spawns cover all regions instead of the central cluster',()=>{
 const {r}=make();
 for(const zone of ZONES){
  const ms=r.monsters.filter(m=>m.zone===zone.id);
  const minX=Math.min(...ms.map(m=>m.x)),maxX=Math.max(...ms.map(m=>m.x));
  const minZ=Math.min(...ms.map(m=>m.z)),maxZ=Math.max(...ms.map(m=>m.z));
  assert(maxZ-minZ>=zone.radius*1.5,zone.id+' north/south coverage');
  if(zone.id!=='cave')assert(maxX-minX>=zone.radius*1.5,zone.id+' east/west coverage');
  for(const m of ms)if(zone.id==='cave'){
   assert.equal(m.home.y,12);assert(caveClearance(m.x,m.z)>=2,'cave spiders stay underground');
  }
 }
});

test('98 active monsters patrol; cave and graveyard bosses wait for their distinct wake triggers',()=>{
 const {w,r}=make(),initial=r.monsters.map(m=>({x:m.x,z:m.z})),travel=new Float64Array(100);
 for(let step=0;step<1200;step++){
  const prev=r.monsters.map(m=>({x:m.x,z:m.z}));w.tick(.05);
  for(const m of r.monsters){
   const zone=ZONES.find(z=>z.id===m.zone);const moved=distance(m,prev[m.id]);travel[m.id]+=moved;
   assert(moved<=.351,'patrol speed is bounded, no teleport');
   assert(Math.hypot(m.x-zone.x,m.z-zone.z)<=zone.radius+.01);
   assert(nav.walkable(m.x,m.z,m.boss));
   if(m.zone==='cave'&&!m.boss){assert(Math.abs(m.y-12)<.01);assert(caveClearance(m.x,m.z)>1.5);}
  }
 }
 for(const m of r.monsters)if(m.id!==0&&m.id!==20)assert(travel[m.id]>100,'actor '+m.id+' must roam, not wait at home');
 assert.equal(r.monsters[20].state,'dormant');assert.equal(travel[20],0);
 assert.equal(r.monsters[0].state,'suspended');assert.equal(distance(r.monsters[0],initial[0]),0);
 console.log(JSON.stringify({idlePatrolActors:98,simulatedSeconds:60,minTravelMetres:Math.min(...travel.slice(1)),maxTravelMetres:Math.max(...travel)}));
});

test('patrol paths and pursuit fields never route beyond the regional leash',()=>{
 for(const zone of ZONES){
  const cells=nav.region(zone,false).components.reduce((a,b)=>a.length>b.length?a:b,[]);
  for(let k=1;k<=5;k++){
   const start=nav.point(cells[Math.floor(cells.length*k/7)]),goal=nav.point(cells[Math.floor(cells.length*(6-k)/7)]);
   const route=nav.route(start.x,start.z,goal.x,goal.z,false,zone);assert(route);
   for(const p of route){assert(Math.hypot(p.x-zone.x,p.z-zone.z)<=zone.radius);assert(nav.walkable(p.x,p.z,false));}
   const next=nav.next(start.x,start.z,goal.x,goal.z,false,0,zone);assert(next);assert(Math.hypot(next.x-zone.x,next.z-zone.z)<=zone.radius);
  }
 }
});

test('cave entry alerts minions more than 150 metres from the intruder',()=>{
 const {w,r,p}=make();Object.assign(p,{x:265,y:12,z:0,positioned:true,hp:1e9});
 const minions=r.monsters.filter(m=>m.zone==='cave'&&!m.boss);assert(minions.some(m=>distance(m,p)>150));
 w.tick(.05);
 for(const m of minions){assert.equal(m.target,'p');assert.equal(m.state,'run');assert(Math.hypot(m.vx,m.vz)>0);}
});

test('detection expands beyond the old 32m radius in every outdoor region',()=>{
 for(const zone of ZONES.filter(z=>z.id!=='cave')){
  const {w,r,p}=make();const m=r.monsters.find(m=>m.zone===zone.id&&!m.boss);
  const g=nav.region(zone,false),start=nav.regionNearest(m.x,m.z,zone,false),cells=g.components[g.labels[start]-1];
  let goal=null;for(const i of cells){const pt=nav.point(i),d=distance(m,pt);if(d>45&&d<65){goal=pt;break;}}
  assert(goal,zone.id+' test target');r.monsters=[m];Object.assign(p,goal,{positioned:true,hp:1e9});w.tick(.05);
  assert.equal(m.target,'p',zone.id+' must detect a 45m+ intruder');assert.equal(m.state,'run');
 }
});

function melee(){
 const c=make(),m=c.r.monsters.find(m=>m.zone==='cave'&&!m.boss);c.r.monsters=[m];
 Object.assign(m,{x:266,y:12,z:0,state:'idle',since:0,attackAt:0,pathAt:0,waypoint:null});
 Object.assign(c.p,{x:268,y:12,z:0,positioned:true,hp:100});return {...c,m};
}
test('spider translates during attack windup and recovery while the player runs',()=>{
 const {w,p,m}=melee();w.tick(.05);assert.equal(m.state,'attack');
 let attackingSteps=0,movingSteps=0;
 for(let i=0;i<12;i++){
  p.x+=.25;const before={x:m.x,z:m.z},state=m.state;w.tick(.05);
  if(state==='attack'&&m.state==='attack'){attackingSteps++;if(distance(m,before)>.01)movingSteps++;}
 }
 assert(attackingSteps>=8);assert(movingSteps>=8,'attacks must not root spiders');assert(p.hp<100,'running target can actually be hit');
});

test('one damage application per melee swing, not damage every simulation tick',()=>{
 const {w,p,m}=melee();w.tick(.05);tick(w,12);assert.equal(p.hp,94); // Existing production minion damage is 6, not the stale 18.
assert.equal(m.hitDone,true);
});

test('a player who leaves the region during windup cannot be damaged',()=>{
 const {w,p,m}=melee();w.tick(.05);assert.equal(m.state,'attack');p.z=280;tick(w,15);assert.equal(p.hp,100);assert.notEqual(m.target,'p');
});

test('melee still checks physical world occlusion',()=>{
 const {w,p,m}=melee();const clear=nav.clear;nav.clear=()=>false;
 try{Object.assign(m,{state:'attack',since:0,hitDone:false,target:'p'});tick(w,12);assert.equal(p.hp,100);}finally{nav.clear=clear;}
});

test('fresh rooms do not share mutable patrol paths or waypoints',()=>{
 const {w,r}=make();w.tick(.05);const second=w.join('q',undefined,true);w.tick(.05);
 const a=r.monsters.find(m=>m.patrol?.length),b=second.monsters.find(m=>m.id===a.id);
 assert(a.patrol&&b.patrol);assert.notEqual(a.patrol,b.patrol);assert.notEqual(a.patrol[0],b.patrol[0]);
 const x=b.patrol[0].x;a.patrol[0].x=-999;assert.equal(b.patrol[0].x,x);
});
