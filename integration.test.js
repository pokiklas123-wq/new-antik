'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {io}=require('socket.io-client');const {createServer}=require('./server');
const wait=(s,name)=>new Promise((resolve,reject)=>{let t=setTimeout(()=>reject(Error('timeout '+name)),4000);s.once(name,p=>{clearTimeout(t);resolve(p);});});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('real Socket.IO: health, matchmaking, isolated flashlights, survivor room, fresh retry',async()=>{
 let game=createServer();await new Promise(r=>game.server.listen(0,'127.0.0.1',r));let url='http://127.0.0.1:'+game.server.address().port,clients=[];
 const connect=async fresh=>{let s=io(url,{transports:['websocket'],forceNew:true,reconnection:false});clients.push(s);await wait(s,'connect');let joined=wait(s,'roomJoined');s.emit('joinRoom',{fresh});return [s,await joined];};
 try{
  assert.equal((await(await fetch(url+'/health')).json()).protocol,2);
  let [a,ar]=await connect(false),[b,br]=await connect(false),[c,cr]=await connect(true);assert.equal(ar.roomId,br.roomId);assert.notEqual(ar.roomId,cr.roomId);
  let leaked=false;c.on('flashlightState',()=>leaked=true);let light=wait(b,'flashlightState');a.emit('flashlightState',{on:true,x:0,y:3,z:-826,dx:0,dy:0,dz:1,range:20,id:'forged'});assert.equal((await light).id,a.id);await delay(80);assert(!leaked);
  let state=wait(a,'playerState');game.world.damage(game.world.players.get(a.id),100);assert.equal((await state).hp,0);assert(game.world.rooms.has(ar.roomId));
  await delay(1050);let again=wait(a,'roomJoined');a.emit('retry',{});let retry=await again;assert.notEqual(retry.roomId,ar.roomId);assert.equal(retry.hp,100);assert(game.world.rooms.has(ar.roomId));
  let closed=wait(b,'roomClosed');game.world.damage(game.world.players.get(b.id),100);await closed;assert(!game.world.rooms.has(ar.roomId));
 }finally{for(let s of clients)s.disconnect();await game.close();}
});
test('21 real sockets: first 20 share room with unique distant spawns, overflow is isolated',async()=>{
 let game=createServer();await new Promise(r=>game.server.listen(0,'127.0.0.1',r));let url='http://127.0.0.1:'+game.server.address().port,clients=[],joined=[];
 try{
  for(let i=0;i<21;i++){let s=io(url,{transports:['websocket'],forceNew:true,reconnection:false});clients.push(s);await wait(s,'connect');let ready=wait(s,'roomJoined');s.emit('joinRoom',{});joined.push(await ready);}
  assert.equal(new Set(joined.slice(0,20).map(p=>p.roomId)).size,1);assert.notEqual(joined[20].roomId,joined[0].roomId);
  assert.equal(new Set(joined.slice(0,20).map(p=>p.spawnSlot)).size,20);
  for(let i=0;i<20;i++)for(let k=0;k<i;k++)assert(Math.hypot(joined[i].spawn.x-joined[k].spawn.x,joined[i].spawn.z-joined[k].spawn.z)>=260);
 }finally{for(let s of clients)s.disconnect();await game.close();}
});
