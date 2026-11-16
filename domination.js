'use strict';
const {randomUUID}=require('node:crypto');
const {CombatWorld}=require('./combat');
const {HALF,LAYOUT,SIGNATURE,DominationNavigation,wet}=require('./domination-map');
const RULES=Object.freeze({players:20,wait:30,lives:3,respawn:3,lockAt:5,minutes:25,zoneDamage:10,killShield:5,medkits:3});
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
class DominationWorld extends CombatWorld{
 constructor(emit=()=>{},rng=Math.random){super(new DominationNavigation(),emit);this.rng=rng;}
 createRoom(){const r={id:randomUUID(),mode:'domination',players:new Map(),monsters:[],closed:false,phase:'waiting',created:this.time,startAt:this.time+RULES.wait,started:0,nextZone:0,nextDamage:0,nextBroadcast:0,zone:{x:0,z:0,radius:Math.hypot(HALF,HALF)},respawnLocked:false};this.rooms.set(r.id,r);return r;}
 join(id,roomId,fresh=false){
  if(this.players.has(id))return this.rooms.get(this.players.get(id).roomId); // Never reset three lives by joining again.
  let r=this.rooms.get(roomId);
  if(!r||r.phase!=='waiting'||r.closed||r.players.size>=20)r=!fresh?[...this.rooms.values()].find(q=>q.phase==='waiting'&&!q.closed&&q.players.size<20):null;
  if(!r)r=this.createRoom();
  const p=this.addPlayer(r,id,false);
  this.emit(id,'roomJoined',{id,roomId:r.id,mode:'domination',layout:LAYOUT,terrainSignature:SIGNATURE,seed:73917,halfSize:HALF,protocol:2,objectiveProtocol:1,droneProtocol:1,dashProtocol:1,maxPlayers:20,hp:100,shield:0,maxShield:0,life:0,spawn:{x:p.x,y:0,z:p.z},spawnSlot:r.players.size-1,serverTime:this.time,loadout:0,medkits:RULES.medkits});
  this.sendSnapshot(p);return r;
 }
 addPlayer(r,id,bot){
  const start=this.safeSpawn(r),p={id,roomId:r.id,...start,life:0,deaths:0,kills:0,hp:100,shield:0,maxShield:0,medkits:RULES.medkits,alive:true,eliminated:false,bot,positioned:true,lastMove:this.time,lastShot:-100,sequence:0,equipped:0,inHands:true,aiming:false,firing:false,grounded:true,proneTransition:0,speed:0,localForward:0,vy:0,pitch:0,yaw:0,crouched:false,prone:false,swimming:false,flashlight:null,healingUntil:0,lastDamageAt:-100,thinkAt:0,target:null,fireAt:this.time+1};
  r.players.set(id,p);this.players.set(id,p);return p;
 }
 safeSpawn(r,exclude){
  const others=[...r.players.values()].filter(p=>p.id!==exclude&&p.alive&&!p.eliminated);
  let best=null,bestScore=-1;
  for(let i=0;i<480;i++){
   const radius=Math.max(0,r.zone.radius-1),a=this.rng()*Math.PI*2,rho=Math.sqrt(this.rng())*radius;
   let x=r.zone.x+Math.cos(a)*rho,z=r.zone.z+Math.sin(a)*rho;
   if(Math.abs(x)>HALF-2||Math.abs(z)>HALF-2||!this.nav.walkable(x,z)||wet(x,z))continue;
   const score=others.length?Math.min(...others.map(p=>Math.hypot(x-p.x,z-p.z))):this.rng()*500;
   if(score>bestScore){best={x,y:0,z};bestScore=score;}
  }
  if(best)return best;
  // Deterministic exhaustive fallback, still strictly inside the CURRENT safe zone.
  const rad=Math.max(0,r.zone.radius-.05);
  for(let d=0;d<=rad;d+=.5)for(let k=0;k<48;k++){
   const x=r.zone.x+Math.cos(k*Math.PI/24)*d,z=r.zone.z+Math.sin(k*Math.PI/24)*d;
   if(this.nav.walkable(x,z)&&!wet(x,z))return {x,y:0,z};
  }
  return null;
 }
 start(r){
  if(r.phase!=='waiting')return;
  while(r.players.size<RULES.players)this.addPlayer(r,'bot-'+randomUUID(),true);
  r.phase='playing';r.started=this.time;r.nextZone=this.time+60;r.nextDamage=this.time+1;
  for(const p of r.players.values()){p.lastMove=this.time;p.fireAt=this.time+1;}
  this.broadcast(r);
 }
 statePacket(p,extra={}){return {hp:p.hp,shield:p.shield,maxShield:p.maxShield,life:p.life,alive:p.alive,deaths:p.deaths,kills:p.kills,livesLeft:Math.max(0,3-p.deaths),eliminated:p.eliminated,respawnAt:p.respawnAt||0,medkits:p.medkits,...extra};}
 sendState(p,extra){if(!p.bot)this.emit(p.id,'playerState',this.statePacket(p,extra));}
 participants(r){return [...r.players.values()].filter(p=>!p.eliminated);}
 lockRespawns(r){
  if(r.respawnLocked||this.participants(r).length>5)return;
  r.respawnLocked=true;
  for(const p of r.players.values())if(!p.alive&&!p.eliminated){p.eliminated=true;p.respawnAt=0;this.sendState(p);}
 }
 settle(r){
  if(r.phase!=='playing')return;
  this.lockRespawns(r);
  const left=this.participants(r);
  if(left.length>1)return;
  r.phase='finished';r.closed=true;r.finishedAt=this.time;r.winnerId=left[0]?.id||'';
  for(const p of r.players.values())if(!p.bot)this.sendState(p,{roundOver:true,won:p.id===r.winnerId,winnerId:r.winnerId});
  this.broadcast(r);
 }
 damage(p,amount){
  const r=this.rooms.get(p.roomId);
  if(!r||r.phase!=='playing'||!p.alive||(!this.zoneHit&&this.time<(p.invulnerableUntil||0)))return;
  const shield=Math.min(p.shield,amount);p.shield-=shield;p.hp=Math.max(0,p.hp-(amount-shield));p.lastDamageAt=this.time;
  if(p.hp===0){
   p.alive=false;p.deaths++;p.healingUntil=0;p.dash=null;p.equipped=-1;p.inHands=p.aiming=p.firing=false;p.speed=0;
   if(this.attacker&&this.attacker.id!==p.id&&this.attacker.alive){const killer=this.attacker;killer.kills++;killer.maxShield=Math.min(100,killer.maxShield+5);killer.shield=Math.min(killer.maxShield,killer.shield+5);this.sendState(killer);}
   p.eliminated=p.deaths>=3||r.respawnLocked;
   p.respawnAt=p.eliminated?0:this.time+RULES.respawn;
  }
  this.sendState(p);
  if(!this.batchDamage)this.settle(r);
 }
 respawn(r,p){
  if(r.respawnLocked||r.phase!=='playing'||p.eliminated)return;
  const spawn=this.safeSpawn(r,p.id);if(!spawn){p.eliminated=true;p.respawnAt=0;this.sendState(p);return;}
  Object.assign(p,spawn,{life:p.life+1,alive:true,hp:100,shield:p.maxShield,medkits:3,respawnAt:0,positioned:true,lastMove:this.time,equipped:0,inHands:true,aiming:false,firing:false,crouched:false,prone:false,swimming:false,grounded:true,proneTransition:0,speed:0,vy:0,localForward:0,dash:null,invulnerableUntil:this.time+2});
  this.sendState(p,{respawn:true,spawn,loadout:0});if(this.dash)this.dash.sync(p);
 }
 move(id,d){
  const p=this.players.get(id),r=p&&this.rooms.get(p.roomId);
  if(!r||r.phase!=='playing'||!d||!Number.isFinite(d.x)||!Number.isFinite(d.z)||!Number.isFinite(d.y)||Math.abs(d.x)>HALF-.3||Math.abs(d.z)>HALF-.3||d.y<-.25||d.y>8)return false;
  if(!this.nav.walkable(d.x,d.z)||!this.nav.clear({x:p.x,y:1,z:p.z},{x:d.x,y:1,z:d.z}))return false;
  if(d.weapon!==0||d.swimming===true)return false;
  return super.move(id,d);
 }
 shoot(id,d){
  const p=this.players.get(id),r=p&&this.rooms.get(p.roomId);
  if(!p||!r||r.phase!=='playing'||!d||d.weapon!==0||!p.inHands)return false;
  this.attacker=p;try{return super.shoot(id,d);}finally{this.attacker=null;}
 }
 pickupShield(){return false;} // Only a verified kill can grant armour.
 heal(id,d){const p=this.players.get(id),r=p&&this.rooms.get(p.roomId);if(!r||r.phase!=='playing'||!p||p.medkits<=0||!super.heal(id,d))return false;p.medkits--;return true;}
 bot(r,p,dt){
  if(!p.alive)return;
  p.firing=false;
  if(this.time>=p.thinkAt){
   p.thinkAt=this.time+.45+this.rng()*.35;
   const visible=[...r.players.values()].filter(q=>q!==p&&q.alive&&dist(p,q)<65&&this.nav.clear({x:p.x,y:1.2,z:p.z},{x:q.x,y:1.0,z:q.z})).sort((a,b)=>dist(p,a)-dist(p,b));
   const q=visible[0];if((q?.id||null)!==p.target)p.fireAt=this.time+.65+this.rng()*.6;
   p.target=q?.id||null;
   if(!p.wander||dist(p,p.wander)<4||this.time>p.wanderUntil){const a=this.rng()*Math.PI*2,rho=Math.sqrt(this.rng())*Math.min(r.zone.radius*.8,240);p.wander={x:r.zone.x+Math.cos(a)*rho,z:r.zone.z+Math.sin(a)*rho};p.wanderUntil=this.time+7;}
  }
  const target=r.players.get(p.target),sees=target&&target.alive&&dist(p,target)<68&&this.nav.clear({x:p.x,y:1.2,z:p.z},{x:target.x,y:1,z:target.z});
  const outside=dist(p,r.zone)>Math.max(0,r.zone.radius-7);
  const goal=outside?r.zone:sees?target:p.wander||r.zone;
  let dx=goal.x-p.x,dz=goal.z-p.z,len=Math.hypot(dx,dz),speed=outside?5.5:sees?(len>24?3.2:len<10?-2:0):3.6;
  p.speed=0;p.localForward=0;p.aiming=!!sees;
  if(len>.1&&speed!==0){
   const base=Math.atan2(dx,dz);let moved=false;
   for(const turn of [0,.45,-.45,.95,-.95,1.5,-1.5]){
    const a=base+turn,x=p.x+Math.sin(a)*speed*dt,z=p.z+Math.cos(a)*speed*dt;
    if(this.nav.walkable(x,z)&&this.nav.clear({x:p.x,y:1,z:p.z},{x,y:1,z})){
     p.x=x;p.z=z;p.speed=Math.abs(speed);p.localForward=speed>0?1:-1;moved=true;break;
    }
   }if(!moved){p.wander=null;p.thinkAt=0;}
  }
  p.yaw=Math.atan2(goal.x-p.x,goal.z-p.z)*180/Math.PI;p.y=0;p.positioned=true;
  if(sees&&!outside&&this.time>=p.fireAt){
   p.fireAt=this.time+.48+this.rng()*.35;
   const origin={x:p.x,y:1.25,z:p.z},spread=.035;
   let dx=target.x-p.x,dz=target.z-p.z,dy=target.y+1.0-origin.y,l=Math.hypot(dx,dy,dz);
   dx=dx/l+(this.rng()-.5)*spread*2;dy=dy/l+(this.rng()-.5)*spread;dz=dz/l+(this.rng()-.5)*spread*2;l=Math.hypot(dx,dy,dz);
   this.shoot(p.id,{life:p.life,sequence:p.sequence+1,weapon:0,...origin,dx:dx/l,dy:dy/l,dz:dz/l,range:75});
  }
 }
 shrink(r){
  const minute=Math.min(25,Math.floor((this.time-r.started+1e-6)/60)),old=r.zone.radius;
  const radius=Math.hypot(HALF,HALF)*(1-minute/25);
  if(radius<=0){r.zone.radius=0;r.respawnLocked=true;for(const p of r.players.values())if(!p.alive&&!p.eliminated){p.eliminated=true;p.respawnAt=0;this.sendState(p);}return;}
  const a=this.rng()*Math.PI*2,shift=Math.min(Math.max(0,old-radius),8)*this.rng();
  // Shift stays within previous circle; keep every future centre on traversable land.
  let x=r.zone.x+Math.cos(a)*shift,z=r.zone.z+Math.sin(a)*shift;
  if(!this.nav.walkable(x,z)||wet(x,z)){x=r.zone.x;z=r.zone.z;}
  r.zone={x,z,radius};
 }
 tick(dt){
  this.time+=dt;
  for(const r of this.rooms.values()){
   if(![...r.players.values()].some(p=>!p.bot)){this.removeRoom(r);continue;}
   if(r.phase==='finished'){if(this.time-r.finishedAt>60)this.removeRoom(r);continue;}
   if(r.phase==='waiting'){if(this.time+1e-7>=r.startAt||r.players.size>=20)this.start(r);}
   if(r.phase==='playing'){
    if(this.time+1e-7>=r.nextZone){this.shrink(r);r.nextZone=r.started+(Math.floor((this.time-r.started+1e-6)/60)+1)*60;}
    for(const p of r.players.values()){
     if(!p.alive&&p.respawnAt&&this.time+1e-7>=p.respawnAt)this.respawn(r,p);
     if(!p.alive)continue;
     if(p.healingUntil&&this.time>=p.healingUntil){p.healingUntil=0;p.hp=Math.min(100,p.hp+30);this.sendState(p);}
     if(p.bot)this.bot(r,p,dt);
    }
    if(this.time+1e-7>=r.nextDamage){
     r.nextDamage=this.time+1;this.batchDamage=true;this.zoneHit=true;
     try{for(const p of r.players.values())if(p.alive&&(r.zone.radius<=0||dist(p,r.zone)>r.zone.radius))this.damage(p,10);}finally{this.batchDamage=false;this.zoneHit=false;}
    }
    this.settle(r);
   }
   if(this.time>=r.nextBroadcast){r.nextBroadcast=this.time+.5;this.broadcast(r);}
  }
 }
 packet(r,p){return {roomId:r.id,mode:'domination',serverTime:this.time,phase:r.phase,wait:Math.max(0,Math.ceil(r.startAt-this.time)),elapsed:r.phase==='waiting'?0:Math.max(0,this.time-r.started),nextShrink:Math.max(0,Math.ceil(r.nextZone-this.time)),zone:r.zone,remaining:this.participants(r).length,alive:[...r.players.values()].filter(q=>q.alive&&!q.eliminated).length,humans:[...r.players.values()].filter(q=>!q.bot).length,bots:[...r.players.values()].filter(q=>q.bot&&!q.eliminated).length,respawnLocked:r.respawnLocked,deaths:p.deaths,kills:p.kills,livesLeft:Math.max(0,3-p.deaths),respawnIn:p.respawnAt?Math.max(0,Math.ceil(p.respawnAt-this.time)):0,winnerId:r.winnerId||''};}
 broadcast(r){for(const p of r.players.values())if(!p.bot)this.emit(p.id,'dominationState',this.packet(r,p));}
 sendSnapshot(p){if(p.bot)return;const r=this.rooms.get(p.roomId);if(!r)return;this.emit(p.id,'monsterSnapshot',{serverTime:this.time,roomId:r.id,monsters:[],projectiles:[]});this.sendPlayerSnapshot(p);}
 leave(id){const p=this.players.get(id);if(!p)return;const r=this.rooms.get(p.roomId);p.dash=null;this.players.delete(id);if(!r)return;r.players.delete(id);if(![...r.players.values()].some(q=>!q.bot))this.removeRoom(r);else this.settle(r);}
 removeRoom(r){this.rooms.delete(r.id);for(const p of r.players.values()){this.players.delete(p.id);if(this.dash)this.dash.cooldowns.delete(p.id);}}
 checkClose(){} // Pending respawns must not close an otherwise empty arena.
}
module.exports={DominationWorld,RULES};
