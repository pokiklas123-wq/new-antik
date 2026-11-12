'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {io}=require('socket.io-client');const {createServer}=require('./server');
const wait=(s,event,predicate=()=>true)=>new Promise((resolve,reject)=>{const listener=p=>{if(!predicate(p))return;clearTimeout(timer);s.off(event,listener);resolve(p);};const timer=setTimeout(()=>{s.off(event,listener);reject(Error('timeout '+event));},5000);s.on(event,listener);});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('real Socket.IO drone: room broadcast, spoofed movement/shot blocked, late join state, landing and rejoin cooldown',async()=>{
 const game=createServer(),clients=[];let time=100;game.world.drone.now=()=>time;
 await new Promise(r=>game.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+game.server.address().port;
 const connect=async(fresh=false)=>{const s=io(url,{transports:['websocket'],forceNew:true,reconnection:false});clients.push(s);await wait(s,'connect');const joined=wait(s,'roomJoined');s.emit('joinRoom',{fresh});return [s,await joined];};
 try{
  const [a,ar]=await connect(),[b,br]=await connect(),[c]=await connect(true);
  assert.equal(ar.droneProtocol,1);assert.equal(ar.id,a.id);assert.equal(ar.roomId,br.roomId);
  const p=game.world.players.get(a.id),nav=game.world.nav;
  const point=nav.point(nav.nearest(p.x,p.z,false));Object.assign(p,{...point,positioned:true,swimming:false});
  Object.assign(game.world.players.get(b.id),{x:p.x+2,y:p.y,z:p.z,positioned:true});
  let leaked=false;c.on('StartDrone',v=>{if(v.id===a.id)leaked=true;});
  const start=wait(a,'StartDrone'),peerStart=wait(b,'StartDrone');
  a.emit('RequestDrone',{life:0,id:b.id,x:999,y:999,speed:999,duration:999});
  const packet=await start;assert.equal((await peerStart).id,a.id);assert.equal(packet.endsAt,110);
  assert(!game.world.players.get(b.id).drone);
  const pos={x:p.x,y:p.y,z:p.z};a.emit('playerMove',{life:0,x:p.x+40,y:100,z:p.z,weapon:0,inHands:true});
  a.emit('shoot',{life:0,sequence:1,weapon:0,x:p.x,y:p.y+1,z:p.z,dx:0,dy:0,dz:1,range:100});
  await delay(80);assert.equal(p.x,pos.x);assert.equal(p.y,pos.y);assert.equal(p.z,pos.z);assert.equal(p.lastShot,-100);assert(!leaked);
  const [late]=await connect();Object.assign(game.world.players.get(late.id),{x:p.x+3,y:p.y,z:p.z,positioned:true});
  const replica=wait(late,'playerSnapshot',o=>o.players.some(q=>q.id===a.id&&q.drone&&q.drone.state==='SUMMON'));
  game.world.sendPlayerSnapshot(game.world.players.get(late.id));assert((await replica).players.some(q=>q.id===a.id));
  // Advance the injected monotonic clock, not a client supplied clock or delta.
  const end=wait(a,'EndDrone'),peerEnd=wait(b,'EndDrone');time=110;game.world.drone.tick();
  assert.equal((await end).cooldownUntil,410);assert.equal((await peerEnd).state,'LANDING');
  const landed=wait(a,'SyncDrone',o=>o.id===a.id&&o.state==='GROUND');time=111.5;game.world.drone.tick();await landed;assert(!p.drone);
  assert(!game.world.drone.request(a.id,{life:0}));
  game.world.damage(p,100);assert(!p.alive);
  const rejoined=wait(a,'roomJoined');a.emit('retry',{});await rejoined;
  const next=game.world.players.get(a.id),land=nav.point(nav.nearest(next.x,next.z,false));Object.assign(next,{...land,positioned:true});
  time=112;assert(!game.world.drone.request(a.id,{life:0}));assert.equal(game.world.drone.cooldowns.get(a.id),410);
 }finally{for(const s of clients)s.disconnect();await game.close();}
});
