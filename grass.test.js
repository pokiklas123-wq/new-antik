'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {GrassWorld,VERSION,MIN,SIDE,point,id,height,manifest}=require('./grass');
const {CombatWorld}=require('./combat'),{Navigation}=require('./navigation');
const data=manifest(),nav=new Navigation(path.join(__dirname,'world-nav.json'));
function target(forest=true){for(let i=0;i<data.allowed.length;i++)if(data.allowed[i]==='1'){
 const gx=i%SIDE+MIN,gz=Math.floor(i/SIDE)+MIN,p=point(gx,gz),inside=Math.hypot(p.x+85,p.z+315)<130;if(inside===forest)return {i,gx,gz,...p,y:data.baseY[i]};}throw Error('No target');}
const at=target();
const create=()=>new GrassWorld(nav);
test('tree manifest contains exactly 40 forest and 100 outside, no duplicates',()=>{
 assert.equal(data.trees.length,140);assert.equal(new Set(data.trees.map(t=>t[0]+','+t[1])).size,140);
 assert.equal(data.trees.filter(t=>Math.hypot(t[0]+85,t[1]+315)<130).length,40);
});
test('100 shared Java/JS grid IDs, coordinates and heights agree',()=>{for(const [gx,gz,i,x,z,h] of data.parity){const p=point(gx,gz);assert.equal(id(gx,gz),i);assert(Math.abs(p.x-x)<.00004);assert(Math.abs(p.z-z)<.00004);assert(Math.abs(height(gx,gz)-h)<.000001);}});
test('outside grass is ankle-height 0.20 metres',()=>{const q=target(false);assert.equal(height(q.gx,q.gz),.2);});
test('forest has varied tall and short grass; roots remain spaced',()=>{
 let short=0,tall=0;for(let i=0;i<data.allowed.length;i++)if(data.allowed[i]==='1'){
 const gx=i%SIDE+MIN,gz=Math.floor(i/SIDE)+MIN,p=point(gx,gz);if(Math.hypot(p.x+85,p.z+315)>=130)continue;const h=height(gx,gz);if(h<1)short++;else tall++;
 const q=point(gx+1,gz);assert(Math.hypot(p.x-q.x,p.z-q.z)>=1.59);
 }assert(short>1000&&tall>1000);
});
test('accepted player contact triggers the specific clump with canonical time',()=>{const g=create();g.actor('p:1',at,.48,10);assert.equal(g.active.get(at.i),10);const s=g.snapshot(at,10);assert(s.some(e=>e.id===at.i&&e.start===10));});
test('monster contact works with no human inside grass',()=>{const g=create();g.actor('m:1',at,.95,5);assert.equal(g.active.get(at.i),5);});
test('boss contact reaches wider than human capsule',()=>{const p={...at,x:at.x+1.8};const small=create(),boss=create();small.actor('p',p,.48,1);boss.actor('m',p,2.3,1);assert(!small.active.has(at.i));assert(boss.active.has(at.i));});
test('stationary actors do not continuously restart rustle',()=>{const g=create();g.actor('p',at,.48,1);g.actor('p',at,.48,2);assert.equal(g.active.get(at.i),1);});
test('multiple actors share cooldown, not one restart per actor',()=>{const g=create();g.actor('p:1',at,.48,1);g.actor('m:2',at,.95,1.3);assert.equal(g.active.get(at.i),1);});
test('moving actor can rustle again after the 1.5 second clip',()=>{const g=create();g.actor('p',at,.48,1);g.actor('p',{...at,x:at.x+.1},.48,2.6);assert.equal(g.active.get(at.i),2.6);});
test('swept contact detects grass crossed between position packets',()=>{const g=create();g.actor('p',{...at,x:at.x-2},.48,1);g.actor('p',{...at,x:at.x+2},.48,1.1);assert.equal(g.active.get(at.i),1.1);});
test('jumping above grass or walking underneath does not trigger it',()=>{for(const y of [at.y+height(at.gx,at.gz)+1,at.y-5]){const g=create();g.actor('p',{...at,y},.48,1);assert(!g.active.has(at.i));}});
test('late nearby observers receive an in-progress animation at its original time',()=>{const g=create();g.actor('p',at,.48,3);assert(g.snapshot({...at,x:at.x+50},3.6).some(e=>e.id===at.i&&e.start===3));});
test('distant observers do not receive grass events',()=>{const g=create();g.actor('p',at,.48,3);assert.equal(g.snapshot({...at,x:at.x+100},3.1).length,0);});
test('expired events are removed and do not replay',()=>{const g=create();g.actor('p',at,.48,1);g.prune(3);assert.equal(g.active.size,0);assert.equal(g.snapshot(at,3).length,0);});
test('non-finite actor positions are ignored',()=>{const g=create();for(const x of [NaN,Infinity,-Infinity])g.actor('bad',{...at,x},.48,1);assert.equal(g.active.size,0);assert.equal(g.actors.size,0);});
test('large teleports cannot sweep the entire world',()=>{const g=create();g.actor('p',{...at,x:at.x-100},.48,1);g.actor('p',{...at,x:at.x+100},.48,1.1);assert(!g.active.has(at.i));});
test('removed actors release contact history',()=>{const g=create();g.actor('p',at,.48,1);g.removeActor('p');assert.equal(g.actors.size,0);});
test('accepted server move, not a client-supplied grass ID, drives animation',()=>{
 const w=new CombatWorld(nav),r=w.join('a'),p=w.players.get('a');Object.assign(p,at);r.monsters=[];
 assert(w.move('a',{...at,swimming:false}));assert(r.grass.active.has(at.i));
 const count=r.grass.active.size;assert(!w.move('a',{...at,x:NaN,grassId:at.i+1}));assert.equal(r.grass.active.size,count);
});
test('room snapshots synchronize humans and monsters, isolated from other rooms',()=>{
 const events=[],w=new CombatWorld(nav,(who,type,p)=>events.push({who,type,p})),a=w.join('a'),b=w.join('b',a.id),other=w.join('other',undefined,true);
 Object.assign(w.players.get('a'),at,{positioned:true});Object.assign(w.players.get('b'),at,{positioned:true});
 a.grass.actor('m:1',at,.95,0);w.sendSnapshot(w.players.get('b'));
 const packet=events.filter(e=>e.who==='b'&&e.type==='grassSnapshot').at(-1).p;assert.equal(packet.vegetation,VERSION);assert(packet.grass.some(e=>e.id===at.i));assert.equal(other.grass.active.size,0);
});
test('real WebSocket clients receive the same grass ID and timestamp',async()=>{
 const {createServer}=require('./server'),{io}=require('socket.io-client'),game=createServer();
 await new Promise(resolve=>game.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+game.server.address().port;
 const a=io(url,{transports:['websocket'],forceNew:true}),b=io(url,{transports:['websocket'],forceNew:true});
 const wait=(socket,event,predicate=()=>true)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(event,handler);reject(Error('timeout '+event));},5000);function handler(p){if(predicate(p)){clearTimeout(timer);socket.off(event,handler);resolve(p);}}socket.on(event,handler);});
 try{
  const ja=wait(a,'roomJoined'),jb=wait(b,'roomJoined');a.on('connect',()=>a.emit('joinRoom',{}));b.on('connect',()=>b.emit('joinRoom',{}));
  const [ra,rb]=await Promise.all([ja,jb]);assert.equal(ra.roomId,rb.roomId);assert.equal(ra.vegetation,VERSION);
  const pa=game.world.players.get(a.id),pb=game.world.players.get(b.id);Object.assign(pa,at,{positioned:true});Object.assign(pb,at,{positioned:true});
  const ga=wait(a,'grassSnapshot',p=>p.grass.some(e=>e.id===at.i)),gb=wait(b,'grassSnapshot',p=>p.grass.some(e=>e.id===at.i));
  a.emit('playerMove',{x:at.x,y:at.y,z:at.z,swimming:false});
  const [sa,sb]=await Promise.all([ga,gb]);assert.deepEqual(sa.grass.find(e=>e.id===at.i),sb.grass.find(e=>e.id===at.i));
  const health=await(await fetch(url+'/health')).json();assert.equal(health.trees,140);assert.equal(health.forestTrees,40);
 }finally{a.disconnect();b.disconnect();await game.close();}
});
test('20 moving actors plus 100 monsters have bounded local grass queries',()=>{
 const g=create(),timings=[];for(let frame=0;frame<100;frame++){const now=frame*.05,t=performance.now();for(let k=0;k<120;k++)g.actor((k<20?'p:':'m:')+k,{x:at.x+Math.sin(frame*.03+k)*12,y:at.y,z:at.z+Math.cos(frame*.03+k)*12},k<20?.48:.95,now);g.prune(now);timings.push(performance.now()-t);}
 timings.sort((a,b)=>a-b);console.log(JSON.stringify({grassActors:120,grassTickP95ms:+timings[94].toFixed(3),activeGrass:g.active.size}));assert(g.active.size<1000);assert.equal(g.actors.size,120);
});
