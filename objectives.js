'use strict';
// Objective ownership and extraction live exclusively on the server.
const {ZONES}=require('./world-layout');
const DEFINITIONS=Object.freeze([
 {id:'green',zone:'forest'}, {id:'red',zone:'graveyard'}, {id:'violet',zone:'cave'}
]);
const PICKUP_RADIUS=2.7,GATE_RADIUS=2.3;
function init(world,room){
 room.keys=DEFINITIONS.map(def=>{
  const zone=ZONES.find(z=>z.id===def.zone),boss=room.monsters.find(m=>m.boss&&m.zone===def.zone);
  const graph=world.nav.region(zone,false);
  const home=boss.home;
  const start=world.nav.regionNearest(home.x,home.z,zone,false);
  const component=graph.components[graph.labels[start]-1];
  // Match the map's region centre, but never embed the key in the boss model.
  const cells=component.map(i=>world.nav.point(i)).filter(p=>Math.hypot(p.x-home.x,p.z-home.z)>=16);
  cells.sort((a,b)=>Math.hypot(a.x-zone.x,a.z-zone.z)-Math.hypot(b.x-zone.x,b.z-zone.z));
  if(!cells.length)throw Error('No reachable objective position: '+def.zone);
  return {...def,...cells[0],owner:null,unlocked:false,extracted:false};
 });
 room.objectiveRevision=0;
}
function held(room,p){return room.keys.filter(k=>k.owner===p.id&&!k.extracted);}
function all(room,p){return p.alive&&!p.escaped&&held(room,p).length===3;}
function near(a,b,r,vertical=3.2){return Math.hypot(a.x-b.x,a.z-b.z)<=r&&Math.abs(a.y-b.y)<=vertical;}
function drop(world,room,p){
 let count=0;
 for(const k of held(room,p)){
  k.owner=null;k.x=p.x;k.z=p.z;
  // Keep the cave floor rather than the mountain roof. Water drops float at
  // the same feet elevation as swimmers; airborne drops settle to the ground.
  const ground=world.nav.height(p.x,p.z);
  k.y=p.swimming?p.y:Math.min(p.y,ground);
  count++;
 }
 if(count){room.objectiveRevision++;p.pickupAfter=world.time+1;}
 return count;
}
function tick(world,room){
 for(const k of room.keys){
  if(!k.unlocked&&room.monsters.some(m=>m.boss&&m.zone===k.zone&&m.hp<=0)){
   k.unlocked=true;room.objectiveRevision++;
  }
 }
 for(const p of room.players.values()){
  if(!p.alive||!p.positioned||p.escaped||world.time<(p.pickupAfter||0))continue;
  for(const k of room.keys){
   if(k.extracted||k.owner!==null||!k.unlocked||!near(p,k,PICKUP_RADIUS))continue;
   // No pickup through cave walls, grave walls or on top of the cave roof.
   if(!world.nav.clear({x:p.x,y:p.y+1,z:p.z},{x:k.x,y:k.y+1,z:k.z}))continue;
   k.owner=p.id;room.objectiveRevision++;
  }
  const active=all(room,p);
  if(!active){p.gateArmed=false;continue;}
  // If all keys were collected ON the original spawn, require stepping out
  // before crossing back. A newly appearing gate cannot instantly win.
  const inside=near(p,p.initialSpawn,GATE_RADIUS,3.2);
  if(!inside)p.gateArmed=true;
  if(inside&&p.gateArmed){
   p.escaped=true;p.alive=false;p.hp=100;p.equipped=-1;p.inHands=p.aiming=p.firing=false;p.flashlight=null;
   for(const k of held(room,p)){k.owner=null;k.extracted=true;}
   room.objectiveRevision++;
   world.emit(p.id,'playerState',{hp:100,alive:false,escaped:true,life:p.life});
   // The unique set has left the match. Finish the round instead of leaving
   // survivors in an unwinnable room with no remaining objectives.
   room.winner=p.id;
   for(const q of room.players.values())if(q.id!==p.id&&q.alive){
    q.alive=false;q.equipped=-1;q.inHands=q.aiming=q.firing=false;q.flashlight=null;
    world.emit(q.id,'playerState',{hp:q.hp,alive:false,roundOver:true,winner:p.id,life:q.life});
   }
   world.checkClose(room);return;
  }
 }
}
function snapshot(world,room,p){
 const mine=held(room,p).map(k=>k.id);
 return {roomId:room.id,serverTime:world.time,revision:room.objectiveRevision,life:p.life,
  keys:room.keys.filter(k=>k.owner===null&&!k.extracted).map(k=>({id:k.id,zone:k.zone,x:k.x,y:k.y,z:k.z,unlocked:k.unlocked})),
  held:mine,
  carriers:[...room.players.values()].filter(q=>all(room,q)).map(q=>({id:q.id,x:q.x,y:q.y,z:q.z})),
  // No other player's gate position is serialized to this client.
  gate:all(room,p)?{...p.initialSpawn,radius:GATE_RADIUS}:null,
  escaped:!!p.escaped};
}
module.exports={init,held,all,drop,tick,snapshot,PICKUP_RADIUS,GATE_RADIUS};
