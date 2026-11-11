'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Navigation}=require('./navigation'),{CombatWorld}=require('./combat'),o=require('./objectives');
const nav=new Navigation(path.join(__dirname,'world-nav.json'));
function make(){const events=[];const w=new CombatWorld(nav,(id,type,data)=>events.push({id,type,data}));const r=w.join('a',null,true);w.join('b',r.id);return {w,r,a:w.players.get('a'),b:w.players.get('b'),events};}
function put(p,k){Object.assign(p,{x:k.x,y:k.y,z:k.z,positioned:true,swimming:false});}
function unlock(r,zone){r.monsters.find(m=>m.boss&&m.zone===zone).hp=0;}
function take(c,p,key){unlock(c.r,key.zone);put(p,key);o.tick(c.w,c.r);}
function giveAll(c,p){for(const k of c.r.keys)take(c,p,k);}

test('three world-fixed keys match their region and stand clear of boss home',()=>{
 const c=make();assert.deepEqual(c.r.keys.map(k=>[k.id,k.zone]),[['green','forest'],['red','graveyard'],['violet','cave']]);
 for(const k of c.r.keys){const boss=c.r.monsters.find(m=>m.boss&&m.zone===k.zone);assert(nav.walkable(k.x,k.z,false));assert(Math.hypot(k.x-boss.home.x,k.z-boss.home.z)>=16);assert.equal(k.owner,null);assert.equal(k.unlocked,false);}
 assert.equal(c.r.keys[2].y,12);
});
test('locked keys are visible globally but cannot be collected while boss lives',()=>{
 const c=make();for(const k of c.r.keys){put(c.a,k);o.tick(c.w,c.r);assert.equal(k.owner,null);}
 const s=o.snapshot(c.w,c.r,c.b);assert.equal(s.keys.length,3);assert.equal(s.gate,null);
});
test('only the corresponding boss death unlocks a key, surviving minions do not block it',()=>{
 const c=make(),k=c.r.keys[2];take(c,c.a,k);assert.equal(k.owner,'a');assert(c.r.monsters.some(m=>m.zone==='cave'&&!m.boss&&m.hp>0));
 assert(c.r.keys.filter(x=>x!==k).every(x=>!x.unlocked));
 assert(!o.snapshot(c.w,c.r,c.b).keys.some(x=>x.id===k.id));
});
test('automatic pickup rejects a different elevation and line-of-sight obstruction',()=>{
 const c=make(),k=c.r.keys[2];unlock(c.r,k.zone);put(c.a,k);c.a.y+=30;o.tick(c.w,c.r);assert.equal(k.owner,null);
 put(c.a,k);const clear=c.w.nav.clear;c.w.nav.clear=()=>false;
 try{o.tick(c.w,c.r);assert.equal(k.owner,null);}finally{c.w.nav.clear=clear;}
 o.tick(c.w,c.r);assert.equal(k.owner,'a');
});
test('competing players cannot duplicate an automatically collected key',()=>{
 const c=make(),k=c.r.keys[0];unlock(c.r,k.zone);put(c.a,k);put(c.b,k);o.tick(c.w,c.r);
 assert.equal(o.held(c.r,c.a).length+o.held(c.r,c.b).length,1);assert.equal(k.owner,'a');
});
test('one or two held keys grant respawn, but never open a gate or reveal a carrier',()=>{
 for(const n of [1,2]){const c=make();for(let i=0;i<n;i++)take(c,c.a,c.r.keys[i]);assert.equal(o.snapshot(c.w,c.r,c.a).gate,null);assert.equal(o.snapshot(c.w,c.r,c.b).carriers.length,0);
 const start={...c.a.initialSpawn};c.w.damage(c.a,100);assert(c.a.alive);assert.equal(c.a.hp,100);assert.deepEqual({x:c.a.x,y:c.a.y,z:c.a.z},start);assert.equal(c.a.equipped,-1);assert.equal(o.held(c.r,c.a).length,0);}
});
test('all three reveal exact live position globally, with a gate sent only to its owner',()=>{
 const c=make();giveAll(c,c.a);const mine=o.snapshot(c.w,c.r,c.a),other=o.snapshot(c.w,c.r,c.b);
 assert.equal(mine.held.length,3);assert.deepEqual({x:mine.gate.x,y:mine.gate.y,z:mine.gate.z},c.a.initialSpawn);assert.equal(other.gate,null);
 assert.deepEqual(other.carriers,[{id:'a',x:c.a.x,y:c.a.y,z:c.a.z}]);assert.equal(other.keys.length,0);
 c.a.x+=5;assert.equal(o.snapshot(c.w,c.r,c.b).carriers[0].x,c.a.x);
});
test('carrier death drops only keys at death location, clears gate and respawns at immutable original spawn',()=>{
 const c=make();giveAll(c,c.a);const death={x:c.a.x,y:c.a.y,z:c.a.z};c.a.equipped=4;c.a.inHands=true;
 c.w.damage(c.a,100);assert.equal(c.a.life,1);assert.equal(c.a.equipped,-1);assert.equal(c.a.inHands,false);assert.equal(c.a.positioned,false);assert.equal(c.a.alive,true);
 const s=o.snapshot(c.w,c.r,c.b);assert.equal(s.keys.length,3);assert.equal(s.carriers.length,0);assert.equal(o.snapshot(c.w,c.r,c.a).gate,null);
 for(const k of s.keys)assert.deepEqual({x:k.x,y:k.y,z:k.z},death);
 assert(c.events.some(e=>e.id==='a'&&e.type==='playerState'&&e.data.respawn&&e.data.clearWeapons));assert(!c.events.some(e=>/weaponDrop|lootDrop/.test(e.type)));
});
test('another player can take all dropped keys; gate moves to their own spawn, never former carrier spawn',()=>{
 const c=make();giveAll(c,c.a);c.w.damage(c.a,100);put(c.b,c.r.keys[0]);o.tick(c.w,c.r);
 assert.equal(o.held(c.r,c.b).length,3);assert.deepEqual({x:o.snapshot(c.w,c.r,c.b).gate.x,y:o.snapshot(c.w,c.r,c.b).gate.y,z:o.snapshot(c.w,c.r,c.b).gate.z},c.b.initialSpawn);
 assert.equal(o.snapshot(c.w,c.r,c.a).gate,null);assert.equal(o.snapshot(c.w,c.r,c.a).carriers[0].id,'b');
});
test('a previously respawned carrier without keys is eliminated on next death',()=>{
 const c=make();take(c,c.a,c.r.keys[0]);c.w.damage(c.a,100);c.w.time+=1;c.w.damage(c.a,100);assert(!c.a.alive);assert.equal(c.a.hp,0);
});
test('late pre-death movement and shot packets cannot restore old position or weapon after respawn',()=>{
 const c=make();take(c,c.a,c.r.keys[0]);c.w.damage(c.a,100);
 const packet={x:c.a.x,y:c.a.y,z:c.a.z,weapon:4,life:0};assert.equal(c.w.move('a',packet),false);assert.equal(c.a.equipped,-1);
 assert.equal(c.w.shoot('a',{weapon:4,life:0}),false);assert(c.w.move('a',{...packet,weapon:-1,life:1}));
});
test('disconnect drops owned keys and removes old private gate/revealed carrier',()=>{
 const c=make();giveAll(c,c.a);c.w.leave('a');const s=o.snapshot(c.w,c.r,c.b);assert.equal(s.keys.length,3);assert.equal(s.carriers.length,0);assert.equal(s.gate,null);assert(c.w.rooms.has(c.r.id));
});
test('server proximity confirms escape only with all keys at own original spawn',()=>{
 const c=make();giveAll(c,c.a);put(c.a,c.b.initialSpawn);o.tick(c.w,c.r);assert(!c.a.escaped);
 put(c.a,c.a.initialSpawn);o.tick(c.w,c.r);assert(c.a.escaped);assert(!c.a.alive);assert.equal(o.snapshot(c.w,c.r,c.a).gate,null);assert(c.r.keys.every(k=>k.extracted));
});
test('no keys or incomplete collection cannot escape at spawn',()=>{
 const c=make();take(c,c.a,c.r.keys[0]);put(c.a,c.a.initialSpawn);o.tick(c.w,c.r);assert(!c.a.escaped);assert.equal(o.snapshot(c.w,c.r,c.a).gate,null);
});
test('collecting a dropped set on your spawn does not accidentally escape until leaving and returning',()=>{
 const c=make();for(const k of c.r.keys){k.unlocked=true;Object.assign(k,c.a.initialSpawn);}put(c.a,c.a.initialSpawn);o.tick(c.w,c.r);assert(o.all(c.r,c.a));assert(!c.a.escaped);
 c.a.x+=5;o.tick(c.w,c.r);assert(!c.a.escaped);put(c.a,c.a.initialSpawn);o.tick(c.w,c.r);assert(c.a.escaped);
});
test('simultaneous boss damage cannot repeatedly kill the same newly respawned player in one tick',()=>{
 const c=make();take(c,c.a,c.r.keys[0]);c.w.damage(c.a,100);c.w.damage(c.a,100);assert(c.a.alive);assert.equal(c.a.life,1);assert.equal(c.a.hp,100);
});
test('rooms have independent objective ownership and unlock state',()=>{
 const c=make();const other=c.w.join('z',null,true);take(c,c.a,c.r.keys[0]);assert(other.keys.every(k=>!k.unlocked&&k.owner===null));
});
test('repeated carrier transfers conserve exactly three unique keys and never drift original spawns',()=>{
 const c=make();giveAll(c,c.a);const starts=[{...c.a.initialSpawn},{...c.b.initialSpawn}];let holder=c.a,next=c.b;
 for(let i=0;i<12;i++){
  c.w.time+=2;c.w.damage(holder,100);assert.equal(o.held(c.r,holder).length,0);put(next,c.r.keys[0]);o.tick(c.w,c.r);
  assert.equal(o.held(c.r,next).length,3);assert.equal(c.r.keys.length,3);assert.equal(new Set(c.r.keys.map(k=>k.id)).size,3);
  assert.equal(o.snapshot(c.w,c.r,holder).gate,null);assert.deepEqual(c.a.initialSpawn,starts[0]);assert.deepEqual(c.b.initialSpawn,starts[1]);
  [holder,next]=[next,holder];
 }
});
test('water drops stay at swimmer elevation; airborne cave drops settle on cave floor, not roof',()=>{
 const c=make();take(c,c.a,c.r.keys[2]);c.a.y=25;c.a.swimming=false;c.w.damage(c.a,100);assert.equal(c.r.keys[2].y,12);
 c.w.time+=2;put(c.b,c.r.keys[2]);o.tick(c.w,c.r);Object.assign(c.b,{x:-476,y:-2.32,z:-476,swimming:true});c.w.damage(c.b,100);
 assert.equal(c.r.keys[2].x,-476);assert.equal(c.r.keys[2].y,-2.32);assert.equal(c.r.keys[2].z,-476);
});
test('successful extraction finishes the unique-set round for survivors instead of leaving an unwinnable room',()=>{
 const c=make();giveAll(c,c.a);put(c.a,c.a.initialSpawn);o.tick(c.w,c.r);
 assert.equal(c.r.winner,'a');assert(c.r.closed);assert(!c.w.rooms.has(c.r.id));assert(!c.b.alive);
 assert(c.events.some(e=>e.id==='b'&&e.type==='playerState'&&e.data.roundOver));
 const fresh=c.w.join('z');assert.notEqual(fresh.id,c.r.id);assert.equal(fresh.keys.length,3);assert(fresh.keys.every(k=>!k.extracted&&!k.unlocked));
});
