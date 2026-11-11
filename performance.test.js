'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Navigation}=require('./navigation'),{CombatWorld}=require('./combat');
const nav=new Navigation(path.join(__dirname,'world-nav.json'));
test('terrain ray hits exact heightfield, including vertical and grazing rays',()=>{
 const x=-476,z=-476,y=nav.height(x,z);assert(Math.abs(nav.terrainRay({x,y:y+10,z},{x:0,y:-1,z:0},20)-10)<1e-5);
 let fake=Object.create(Navigation.prototype);fake.data={n:3,step:2,minX:0,minZ:0,heights:Float32Array.from([0,1,2,1,2,3,2,3,4]),format:2};
 assert(Math.abs(fake.terrainRay({x:1,y:5,z:1},{x:0,y:-1,z:0},10)-4)<1e-5);
 assert.equal(fake.terrainRay({x:1,y:5,z:1},{x:1,y:0,z:0},1),1);
});
test('immutable BFS field is reused beyond one second, not needlessly rebuilt',()=>{
 nav.next(265,0,265,26,true,0);const key=nav.nearest(265,26,true)+':true',entry=nav.fields.get(key);
 assert(entry);nav.next(265,0,265,26,true,100);assert.equal(nav.fields.get(key),entry);
});
for(const count of [2,20])test(`${count} players and 60 server-owned monsters: bounded motion and stable load`,()=>{
 const world=new CombatWorld(nav);const room=world.join('p0');for(let i=1;i<count;i++)world.join('p'+i,room.id);
 for(let i=0;i<count;i++){let p=world.players.get('p'+i),cell=nav.nearest(235+(i%5)*12,-22+Math.floor(i/5)*12,false),pt=nav.point(cell);Object.assign(p,pt,{positioned:true,hp:1e9,equipped:4});}
 room.awake=true;room.monsters[0].state='idle';room.monsters[0].y=12;
 const timings=[];let moved=new Set();
 for(let frame=0;frame<400;frame++){
  let before=room.monsters.map(m=>[m.x,m.z]);let t=performance.now();world.tick(.05);const ms=performance.now()-t;if(frame>=40)timings.push(ms);
  for(let i=0;i<room.monsters.length;i++){let m=room.monsters[i],d=Math.hypot(m.x-before[i][0],m.z-before[i][1]);assert(Number.isFinite(m.x+m.y+m.z));assert(d<=.801);if(d>.001)moved.add(m.id);const zone=require('./world-layout').ZONES.find(z=>z.id===m.zone);assert(Math.hypot(m.x-zone.x,m.z-zone.z)<=zone.radius+.1);}
 }
 timings.sort((a,b)=>a-b);const q=f=>Number(timings[Math.ceil(timings.length*f)-1].toFixed(3));
 console.log(JSON.stringify({players:count,monsters:room.monsters.length,ticks:400,tickMsP50:q(.5),tickMsP95:q(.95),tickMsP99:q(.99),movedActors:moved.size,bfsCache:nav.fields.size,rssMiB:Math.round(process.memoryUsage().rss/1048576)}));
 assert.equal(room.monsters.length,60);assert(moved.size>5);assert(nav.fields.size<=20);
 for(const p of room.players.values())assert(world.snapshot(p).monsters.length<=60);
});
