'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {io}=require('socket.io-client'),{createServer}=require('./server');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=(s,event,predicate=()=>true)=>new Promise((resolve,reject)=>{
 const on=o=>{if(predicate(o)){clearTimeout(timer);s.off(event,on);resolve(o);}};
 const timer=setTimeout(()=>{s.off(event,on);reject(Error('timeout '+event));},6000);s.on(event,on);
});
test('real sockets: authoritative dash, peer replication, serial barrier, cooldown and drone exclusion',async()=>{
 const game=createServer(),clients=[];let time=100;game.world.dash.now=()=>time;
 await new Promise(r=>game.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+game.server.address().port;
 const connect=async()=>{const s=io(url,{transports:['websocket'],forceNew:true,reconnection:false});clients.push(s);await wait(s,'connect');const j=wait(s,'roomJoined');s.emit('joinRoom',{});return [s,await j];};
 try{
  const [a,ar]=await connect(),[b]=await connect();const world=game.world,p=world.players.get(a.id),q=world.players.get(b.id),dash=world.dash;
  let chosen=false;
  // Find an actually clear 5m corridor on the provided collision mesh, not on a mocked map.
  for(let x=-100;x<=100&&!chosen;x+=10)for(let z=-100;z<=100&&!chosen;z+=10){
   const y=world.nav.height(x,z);if(!world.nav.walkable(x,z,false))continue;
   Object.assign(p,{x,y,z,positioned:true,swimming:false,grounded:true});
   if(dash.request(a.id,{life:0,dx:1,dz:0})&&p.dash.distance>4.9)chosen=true;
   if(!chosen){p.dash=null;p.dashRequestAt=0;dash.cooldowns.delete(a.id);}
  }
  assert(chosen,'a clear real-nav corridor must exist');
  const from=p.dash.fromX;p.dash=null;dash.cooldowns.delete(a.id);p.dashRequestAt=0;
  Object.assign(q,{x:p.x+2,y:p.y,z:p.z,positioned:true});
  const previousSerial=dash.serial;
  const self=wait(a,'DashState',o=>o.active&&o.serial>previousSerial),peer=wait(b,'DashState',o=>o.active&&o.id===a.id&&o.serial>previousSerial);
  a.emit('RequestDash',{life:ar.life,dx:1,dz:0,distance:999,cooldownUntil:0,duration:0});
  const state=await self;assert.equal((await peer).serial,state.serial);assert.equal(state.distance,5);assert.equal(state.cooldownUntil,130);
  const lockedX=p.x;
  a.emit('playerMove',{life:0,x:p.x+40,y:p.y,z:p.z,dashSerial:state.serial});
  a.emit('RequestDrone',{life:0});
  a.emit('shoot',{life:0,sequence:1,weapon:0,x:p.x,y:p.y+1,z:p.z,dx:1,dy:0,dz:0,range:100});
  await delay(70);assert.equal(p.x,lockedX);assert(!p.drone);assert.equal(p.lastShot,-100);
  time=100.21;dash.tick();assert(Math.abs(p.x-from-5)<1e-8);
  assert(!world.move(a.id,{life:0,x:from,y:p.y,z:p.z,dashSerial:state.serial-1}));
  const denied=wait(a,'DashState',o=>o.reason==='COOLDOWN');time=101;
  a.emit('RequestDash',{life:0,dx:1,dz:0});assert.equal((await denied).cooldownUntil,130);
  const replica=wait(b,'playerSnapshot',o=>o.players.some(v=>v.id===a.id&&v.dash?.serial===state.serial));world.sendPlayerSnapshot(q);await replica;
  assert.equal(world.players.get(a.id).roomId,ar.roomId);
 }finally{clients.forEach(s=>s.disconnect());await game.close();}
});
