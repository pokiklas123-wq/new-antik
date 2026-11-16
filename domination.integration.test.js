'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{io}=require('socket.io-client');
const {createServer}=require('./server');
function event(socket,name){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timeout '+name)),4000);socket.once(name,p=>{clearTimeout(timer);resolve(p);});});}
async function client(url,mapId){const s=io(url,{transports:['websocket'],forceNew:true,reconnection:false});const joined=event(s,'roomJoined');s.on('connect',()=>s.emit('joinRoom',{mapId}));return {s,packet:await joined};}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('real sockets isolate mission/domination and server rejects drone/shield/retry/join resets',async()=>{
 const server=createServer();await new Promise(r=>server.httpServer.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.httpServer.address().port;let a,b;
 try{
  a=await client(url,'mission');b=await client(url,'domination');
  assert.equal(a.packet.layout,'dark-survival-1000-v1');assert.equal(b.packet.layout,'domination-500-v1');assert.notEqual(a.packet.roomId,b.packet.roomId);
  const p=server.domination.players.get(b.s.id),room=server.domination.rooms.get(p.roomId);server.domination.start(room);p.hp=39;p.deaths=2;
  for(const name of ['RequestDrone','DroneInput','PickupShield','retry'])b.s.emit(name,{life:0,sequence:1,stickX:1,stickY:0});
  b.s.emit('joinRoom',{mapId:'mission',fresh:true});await delay(150);
  assert.equal(p.drone,undefined);assert.equal(p.maxShield,0);assert.equal(p.deaths,2);assert.equal(p.hp,39);assert.equal(server.world.players.has(b.s.id),false);assert.equal(server.domination.players.get(b.s.id),p);
 }finally{a?.s.disconnect();b?.s.disconnect();await server.close();}
});
test('socket receives pending death then safe authoritative armed respawn with incremented life',async()=>{
 const server=createServer();await new Promise(r=>server.httpServer.listen(0,'127.0.0.1',r));let a;
 try{
  a=await client('http://127.0.0.1:'+server.httpServer.address().port,'domination');
  const w=server.domination,p=w.players.get(a.s.id),r=w.rooms.get(p.roomId);w.start(r);for(const q of r.players.values())if(q!==p)q.thinkAt=Infinity;
  const death=event(a.s,'playerState');w.damage(p,100);const d=await death;assert.equal(d.alive,false);assert.ok(d.respawnAt>w.time);assert.equal(d.eliminated,false);
  const revive=event(a.s,'playerState');p.respawnAt=w.time+.05;const next=await revive;assert.equal(next.respawn,true);assert.equal(next.life,1);assert.equal(next.loadout,0);assert.equal(next.hp,100);assert.ok(w.nav.walkable(next.spawn.x,next.spawn.z));
 }finally{a?.s.disconnect();await server.close();}
});
