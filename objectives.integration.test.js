'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {io}=require('socket.io-client'),{createServer}=require('./server');
function next(socket,event,predicate=()=>true){return new Promise((resolve,reject)=>{const handler=data=>{if(!predicate(data))return;clearTimeout(timer);socket.off(event,handler);resolve(data);};const timer=setTimeout(()=>{socket.off(event,handler);reject(Error('timeout '+event));},5000);socket.on(event,handler);});}
test('real sockets: objective sync, private gates, carrier death, transfer and stale-life rejection',async()=>{
 const game=createServer(),sockets=[];await new Promise(r=>game.httpServer.listen(0,'127.0.0.1',r));
 async function connect(roomId){const s=io('http://127.0.0.1:'+game.httpServer.address().port,{transports:['websocket'],forceNew:true,reconnection:false});sockets.push(s);await next(s,'connect');const ready=next(s,'roomJoined'),obj=next(s,'objectiveSnapshot');s.emit('joinRoom',{roomId});return {s,joined:await ready,objectives:await obj};}
 try{
  const a=await connect(),b=await connect(a.joined.roomId),p=game.world.players.get(a.s.id),q=game.world.players.get(b.s.id),room=game.world.rooms.get(a.joined.roomId);
  assert.equal(a.joined.objectiveProtocol,1);assert.equal(a.objectives.keys.length,3);assert.equal(b.objectives.gate,null);
  // No client objective command exists: a forged packet must have no effect.
  a.s.emit('collectKey',{id:'green'});a.s.emit('openGate',{x:0,y:0,z:0});
  const unchanged=await next(a.s,'objectiveSnapshot');assert.equal(unchanged.held.length,0);assert.equal(unchanged.gate,null);
  for(const k of room.keys){k.unlocked=true;k.owner=p.id;}p.positioned=true;
  const exposed=await next(b.s,'objectiveSnapshot',d=>d.carriers.length===1);assert.equal(exposed.gate,null);assert.equal(exposed.carriers[0].id,p.id);
  const privateGate=await next(a.s,'objectiveSnapshot',d=>d.gate!==null);assert.equal(privateGate.gate.x,p.initialSpawn.x);
  // Move the authoritative test fixture to a walkable death position (not a client teleport).
  const spot=room.keys.find(k=>k.zone==='cave');Object.assign(p,{x:spot.x,y:spot.y,z:spot.z,swimming:false});
  const respawn=next(a.s,'playerState',d=>d.respawn);game.world.damage(p,100);const state=await respawn;assert.equal(state.life,1);assert(state.clearWeapons);
  const removed=await next(a.s,'objectiveSnapshot',d=>d.life===1);assert.equal(removed.gate,null);assert.equal(removed.keys.length,3);
  const revealed=next(a.s,'objectiveSnapshot',d=>d.carriers.some(c=>c.id===q.id));
  Object.assign(q,{x:spot.x,y:spot.y,z:spot.z,positioned:true,swimming:false});await revealed;
  const own=await next(b.s,'objectiveSnapshot',d=>d.gate!==null);assert.equal(own.gate.x,q.initialSpawn.x);assert.equal(own.gate.z,q.initialSpawn.z);
  a.s.emit('playerMove',{x:p.x,y:p.y,z:p.z,weapon:4,life:0});
  await next(a.s,'objectiveSnapshot');assert.equal(p.equipped,-1);
 }finally{for(const s of sockets)s.disconnect();await game.close();}
});
