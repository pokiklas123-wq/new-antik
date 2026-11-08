'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {CombatWorld}=require('./combat'),{Navigation}=require('./navigation');
const {spawn,VERSION,CAVE_X}=require('./world-layout');
const nav=new Navigation(path.join(__dirname,'world-nav.json'));
test('layout identity, bounds, 20 slots, >=260m Euclidean separation',()=>{
 assert.equal(nav.data.layout,VERSION);let slots=Array.from({length:20},(_,i)=>spawn(i));
 for(let i=0;i<20;i++){let p=slots[i];assert(Math.max(Math.abs(p.x),Math.abs(p.z))===826);for(let k=0;k<i;k++)assert(Math.hypot(p.x-slots[k].x,p.z-slots[k].z)>=260);}
});
test('20 occupants share a room, 21st creates another; no duplicate spawn slots',()=>{
 const w=new CombatWorld(nav);let r=w.join('p0');for(let i=1;i<20;i++)assert.equal(w.join('p'+i).id,r.id);
 assert.equal(r.players.size,20);assert.equal(new Set([...r.players.values()].map(p=>p.spawnSlot)).size,20);
 assert.notEqual(w.join('p20').id,r.id);w.leave('p7');assert.equal(w.join('new').id,r.id);assert.equal(w.players.get('new').spawnSlot,7);
});
test('initial position packet cannot bypass the assigned spawn',()=>{
 const w=new CombatWorld(nav);w.join('p');assert(!w.move('p',{x:560,y:12,z:0}));let p=w.players.get('p');assert(w.move('p',{x:p.x,y:p.y,z:p.z}));
});
test('navigation neighbours do not wrap across grid rows',()=>{
 let fake=Object.create(Navigation.prototype);fake.data={minX:0,minZ:0,n:3,step:2,heights:Array(9).fill(12),small:'001100000',boss:'001100000'};fake.fields=new Map();
 assert.equal(fake.next(4,0,0,2,false,0),null);
});
test('BFS field cache remains bounded for many target cells',()=>{
 for(let i=0;i<50;i++)nav.next(CAVE_X,0,CAVE_X-20+(i%10)*4,-20+Math.floor(i/10)*4,true,100);
 assert(nav.fields.size<=20);
});
test('waypoint transitions preserve budget without intermittent idle animation',()=>{
 let fake={nearest:()=>0,point:()=>({x:CAVE_X,y:12,z:0}),next:(x,z)=>({x:x+.12,y:12,z}),walkable:()=>true,height:()=>12};
 let w=new CombatWorld(fake),m={x:CAVE_X,y:12,z:0,boss:false,hp:100,state:'run',since:0,revision:0,pathAt:0,waypoint:null,yaw:0};
 let start=m.x;w.moveMonster(m,{x:CAVE_X+15,y:12,z:0},10,.05);assert(Math.abs(m.x-start-.5)<.00001);assert.equal(m.state,'run');
});
