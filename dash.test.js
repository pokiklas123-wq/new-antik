'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DashLogic,CONFIG}=require('./dash');
function setup(){
 let time=100;const events=[],p={id:'a',roomId:'r',life:0,x:0,y:0,z:0,alive:true,positioned:true,grounded:true};
 const q={...p,id:'b'},other={...p,id:'c',roomId:'other'};
 const world={time:0,players:new Map([['a',p],['b',q],['c',other]]),rooms:new Map([['r',{players:new Map([['a',p],['b',q]])}]]),
  nav:{height:()=>0,clear:()=>true},emit:(id,event,data)=>events.push({id,event,data})};
 const dash=new DashLogic(world);world.dash=dash;dash.now=()=>time;
 return {p,q,world,dash,events,setTime:t=>time=t};
}
test('all eight joystick angles travel exactly five metres; server controls duration',()=>{
 for(let angle=0;angle<8;angle++){
  const {dash,p,setTime}=setup(),a=angle*Math.PI/4;
  assert(dash.request('a',{life:0,dx:Math.cos(a),dz:Math.sin(a),distance:999,duration:0,cooldown:0}));
  assert.equal(p.dash.endsAt,100.2);setTime(100.1);dash.tick();assert(Math.abs(Math.hypot(p.x,p.z)-2.5)<1e-9);
  setTime(100.2);dash.tick();assert(Math.abs(Math.hypot(p.x,p.z)-5)<1e-9);assert.equal(p.dash,null);
 }
});
test('cooldown cannot be reset by payload, death or leave/rejoin on the same connection',()=>{
 const {dash,p,world,setTime}=setup();assert(dash.request('a',{life:0,dx:1,dz:0}));
 setTime(100.3);dash.tick();const serial=p.dashSerial;
 assert(dash.rejectMove(p,{dashSerial:serial-1}));assert(!dash.rejectMove(p,{dashSerial:serial}));
 world.players.delete('a');world.players.set('a',{...p,dash:null});
 setTime(129.999);assert(!dash.request('a',{life:0,dx:1,dz:0,serverTime:99999,cooldownUntil:0}));
 setTime(130.2);assert(dash.request('a',{life:0,dx:1,dz:0}));assert.equal(dash.cooldowns.get('a'),160.2);
});
test('invalid directions, wrong life, dead, drone and unsupported stances never activate',()=>{
 for(const o of [{dx:0,dz:0},{dx:NaN,dz:0},{dx:Infinity,dz:0},{dx:2,dz:0},{dx:'1',dz:0},{life:9,dx:1,dz:0}]){
  const {dash}=setup();assert(!dash.request('a',{life:0,...o}));
 }
 for(const state of [{alive:false},{drone:{}},{prone:true},{crouched:true},{swimming:true},{grounded:false},{positioned:false},{proneTransition:1}]){
  const {dash,p}=setup();Object.assign(p,state);assert(!dash.request('a',{life:0,dx:1,dz:0}));
 }
});
test('swept body collision stops before a thin wall, not on the opposite side',()=>{
 const {dash,world,p,setTime}=setup();world.nav.clear=(a,b)=>!(Math.min(a.x,b.x)<=2&&Math.max(a.x,b.x)>=2);
 assert(dash.request('a',{life:0,dx:1,dz:0}));assert(p.dash.distance<2-CONFIG.radius);assert(p.dash.distance>1.5);
 setTime(101);dash.tick();assert(p.x<1.71);
});
test('blocked start does not spend cooldown; edges, steep ground and invalid terrain stop safely',()=>{
 let t=setup();t.world.nav.clear=()=>false;assert(!t.dash.request('a',{life:0,dx:1,dz:0}));assert(!t.dash.cooldowns.has('a'));
 for(const height of [x=>x>.5?10:0,x=>x>.5?NaN:0]){
  t=setup();t.world.nav.height=height;assert(t.dash.request('a',{life:0,dx:1,dz:0}));assert(t.p.dash.distance<=.5);
 }
});
test('activation is broadcast only inside its room and stale moves are rejected while active',()=>{
 const {dash,p,events}=setup();assert(dash.request('a',{life:0,dx:1,dz:0}));
 assert.deepEqual(events.map(e=>e.id),['a','b']);assert(dash.rejectMove(p,{dashSerial:p.dashSerial}));
 assert.equal(events[0].data.cooldownUntil,130);
});
test('death cancels active movement without granting invulnerability or removing cooldown',()=>{
 const {dash,p,setTime}=setup();dash.request('a',{life:0,dx:1,dz:0});p.alive=false;setTime(100.1);dash.tick();
 assert.equal(p.x,0);assert.equal(p.dash,null);assert.equal(dash.cooldowns.get('a'),130);assert.equal(p.invulnerableUntil,undefined);
});