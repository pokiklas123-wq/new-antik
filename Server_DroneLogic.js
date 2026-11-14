'use strict';
const {performance}=require('node:perf_hooks');
const {HALF_SIZE}=require('./world-layout');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
// Seconds/metres. No value below is accepted from a client packet.
const CONFIG=Object.freeze({duration:15,cooldown:150,height:6,normalSpeed:7.5,
 maxMultiplier:3,assemble:.8,idle:.2,mount:1.7,rise:2,acceleration:2,landing:1.4,inputTimeout:.25});
class DroneLogic {
 constructor(world,{now=()=>performance.now()/1000}={}){
  this.world=world;this.now=now;this.cooldowns=new Map();this.serial=0;
 }
 packet(p){const t=this.now(),d=p.drone;return {id:p.id,roomId:p.roomId,life:p.life,
  serverTime:t,revision:d?d.revision:(p.droneRevision||0),state:d?d.state:'GROUND',
  x:p.x,y:p.y,z:p.z,yaw:p.yaw,speed:p.speed||0,vy:p.vy||0,
  startedAt:d?d.startedAt:0,mountAt:d?d.mountAt:0,flyAt:d?d.flyAt:0,
  endsAt:d?d.endsAt:0,landingEndsAt:d?d.landingEndsAt:0,
  cooldownUntil:this.cooldowns.get(p.id)||0,
  cooldownSeconds:CONFIG.cooldown,flightSeconds:CONFIG.duration,
  assembleSeconds:CONFIG.assemble,idleSeconds:CONFIG.idle,mountSeconds:CONFIG.mount};}
 emit(p,event,onlySelf=false){const r=this.world.rooms.get(p.roomId),o=this.packet(p);
  if(onlySelf)this.world.emit(p.id,event,o);
  else if(r)for(const q of r.players.values())this.world.emit(q.id,event,o);
 }
 sync(p){if(p)this.emit(p,'SyncDrone',true);}
 locked(p){return !!(p&&p.drone);}
 request(id,data){const p=this.world.players.get(id),t=this.now();
  if(!p||!p.alive||p.escaped||!data||data.life!==p.life)return false;
  if(t<(p.droneRequestAt||0))return false;p.droneRequestAt=t+.25;
  if(p.drone||t<(this.cooldowns.get(id)||0)||!p.positioned){this.sync(p);return false;}
  const floor=this.world.nav.height(p.x,p.z);
  // Never use a forged altitude as the launch baseline; require a grounded launch.
  if(!finite(floor)||Math.abs(p.y-floor)>.7||!this.world.nav.walkable(p.x,p.z,false)){
   this.sync(p);return false;
  }
  p.y=floor;p.positioned=true;p.grounded=false;p.swimming=false;
  p.crouched=p.prone=p.inHands=p.aiming=p.firing=false;p.proneTransition=0;
  p.vy=p.speed=0;
  p.drone={revision:++this.serial,state:'SUMMON',startedAt:t,
   mountAt:t+CONFIG.assemble+CONFIG.idle,
   flyAt:t+CONFIG.assemble+CONFIG.idle+CONFIG.mount,
   endsAt:t+CONFIG.duration,landingEndsAt:0,
   floor,lastAt:t,inputAt:-Infinity,inputSequence:-1,ix:0,iz:0};
  p.droneRevision=p.drone.revision;this.emit(p,'StartDrone');return true;
 }
 input(id,o){const p=this.world.players.get(id),d=p&&p.drone,t=this.now();
  if(!p||!p.alive||!d||d.state==='LANDING'||!o||o.life!==p.life||o.revision!==d.revision||
   !Number.isSafeInteger(o.sequence)||o.sequence<=d.inputSequence||
   ![o.stickX,o.stickY,o.cameraYaw].every(finite))return false;
  // Extra packets cannot advance time or move the player. Only the latest direction survives.
  if(Math.abs(o.stickX)>1||Math.abs(o.stickY)>1||Math.abs(o.cameraYaw)>1e6)return false;
  let x=o.stickX,y=o.stickY,len=Math.hypot(x,y);if(len>1){x/=len;y/=len;}
  const a=o.cameraYaw*Math.PI/180,s=Math.sin(a),c=Math.cos(a);
  d.ix=x*c-y*s;d.iz=-x*s-y*c;d.inputSequence=o.sequence;d.inputAt=t;return true;
 }
 beginLanding(p,t){const d=p.drone;if(!d||d.state==='LANDING')return;
  d.state='LANDING';d.landAt=d.endsAt;d.landingEndsAt=d.endsAt+CONFIG.landing;
  d.landY=p.y;d.floor=this.world.nav.height(p.x,p.z);
  // A roof/platform under the player is a landing surface, never tunnel down through it.
  if(this.world.nav.ray){const range=Math.max(.1,p.y-d.floor+.1);
   const hit=this.world.nav.ray({x:p.x,y:p.y+.1,z:p.z},{x:0,y:-1,z:0},range);
   d.floor=Math.min(p.y,Math.max(d.floor,p.y+.1-hit));}
  d.ix=d.iz=0;
  this.cooldowns.set(p.id,d.endsAt+CONFIG.cooldown);
  p.speed=0;this.emit(p,'EndDrone');
 }
 // Sampled swept player+drone envelope. No client-side collision decisions.
 clear(p,x,y,z){const nav=this.world.nav;
  if(Math.abs(x)>HALF_SIZE-.6||Math.abs(z)>HALF_SIZE-.6||y<nav.height(x,z)-.03)return false;
  for(const h of [.18,.95,1.8,2.5])for(const [dx,dz] of [[0,0],[.48,0],[-.48,0],[0,.48],[0,-.48]]){
   const a={x:p.x+dx,y:p.y+h,z:p.z+dz},b={x:x+dx,y:y+h,z:z+dz};
   if(nav.ray){const vx=b.x-a.x,vy=b.y-a.y,vz=b.z-a.z,length=Math.hypot(vx,vy,vz);
    // Navigation.clear() has 15cm endpoint forgiveness for combat LOS; movement must not.
    if(length>.00001&&nav.ray(a,{x:vx/length,y:vy/length,z:vz/length},length+.08)<=length+.03)return false;
   }else if(!nav.clear(a,b))return false;
  }
  return true;
 }
 tick(){const t=this.now();
  for(const p of this.world.players.values()){
   const d=p.drone;if(!d){if(t>=(p.droneSyncAt||0)){p.droneSyncAt=t+1;this.sync(p);}continue;}
   if(!p.alive||p.escaped){this.cancel(p);continue;}
   if(t>=d.endsAt&&d.state!=='LANDING')this.beginLanding(p,t);
   let oldY=p.y,oldX=p.x,oldZ=p.z;
   if(d.state==='LANDING'){
    const y=d.landY+(d.floor-d.landY)*smooth((t-d.landAt)/CONFIG.landing);
    // Reverse a previously checked ascent corridor; no horizontal drift during landing.
    p.y=y;p.speed=0;
    if(t>=d.landingEndsAt){p.y=d.floor;p.grounded=true;p.vy=0;p.lastMove=this.world.time;
     p.droneHandoffUntil=this.world.time+.3;
     p.drone=null;this.emit(p,'SyncDrone');continue;}
   }else{
    d.state=t<d.mountAt?'SUMMON':t<d.flyAt?'MOUNT':'FLYING';
    let remaining=Math.max(0,Math.min(.25,t-d.lastAt)),cursor=t-remaining;
    while(remaining>1e-8){const dt=Math.min(remaining,1/60);cursor+=dt;remaining-=dt;
     const age=Math.max(0,cursor-d.flyAt);
     const multiplier=1+(CONFIG.maxMultiplier-1)*smooth(age/CONFIG.acceleration);
     const active=cursor>=d.flyAt&&t-d.inputAt<CONFIG.inputTimeout;
     const vx=active?d.ix*CONFIG.normalSpeed*multiplier:0,vz=active?d.iz*CONFIG.normalSpeed*multiplier:0;
     const x=p.x+vx*dt,z=p.z+vz*dt;
     // 6m is the maximum feet altitude above the server launch floor (not global Y=6).
     const target=d.floor+CONFIG.height*smooth(age/CONFIG.rise);
     // Stop at terrain/solid geometry rather than tunnel through an obstacle or cliff.
     if(this.clear(p,x,target,z)){p.x=x;p.y=target;p.z=z;}
     else if(this.clear(p,p.x,target,p.z))p.y=target;
     if(Math.hypot(vx,vz)>.01)p.yaw=Math.atan2(vx,vz)*180/Math.PI;
    }
    const elapsed=Math.max(.001,t-d.lastAt);p.speed=Math.hypot(p.x-oldX,p.z-oldZ)/elapsed;
   }
   p.vy=(p.y-oldY)/Math.max(.001,t-d.lastAt);p.grounded=false;
   p.positioned=true;p.lastMove=this.world.time;d.lastAt=t;this.emit(p,'SyncDrone');
  }
  // Drop expired records for disconnected players; live records stay for HUD/rejoins.
  for(const [id,until] of this.cooldowns)if(t>=until&&!this.world.players.has(id))this.cooldowns.delete(id);
 }
 cancel(p){if(!p||!p.drone)return;const d=p.drone;
  this.cooldowns.set(p.id,Math.max(this.cooldowns.get(p.id)||0,this.now()+CONFIG.cooldown));
  d.state='LANDING';d.endsAt=this.now();d.landingEndsAt=this.now();this.emit(p,'EndDrone');
  p.drone=null;p.speed=p.vy=0;this.emit(p,'SyncDrone');
 }
 // During an active skill normal position/stance packets are never applied.
 // For the handoff window ignore old buffered flight positions after landing.
 rejectMove(p,data){return this.locked(p)||!!(p&&this.world.time<(p.droneHandoffUntil||0)&&
  (!data||Math.hypot(data.x-p.x,data.y-p.y,data.z-p.z)>1));}
}
module.exports={DroneLogic,CONFIG};
