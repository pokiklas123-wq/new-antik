'use strict';
const {performance}=require('node:perf_hooks');
const {HALF_SIZE}=require('./world-layout');
const CONFIG=Object.freeze({distance:10,duration:.25,cooldown:30,radius:.30,step:.08});
const finite=n=>typeof n==='number'&&Number.isFinite(n);
class DashLogic {
 constructor(world){this.world=world;this.now=()=>performance.now()/1000;this.cooldowns=new Map();this.serial=0;}
 packet(p,reason=''){
  return {id:p.id,roomId:p.roomId,life:p.life,serverTime:this.now(),
   cooldownUntil:this.cooldowns.get(p.id)||0,serial:p.dashSerial||0,
   active:!!p.dash,reason,...(p.dash||{}),x:p.x,y:p.y,z:p.z};
 }
 sync(p,reason=''){if(p)this.world.emit(p.id,'DashState',this.packet(p,reason));}
 locked(p){return !!(p&&p.dash);}
 // The serial is a hand-off barrier: queued pre-dash movement cannot rewind the player.
 rejectMove(p,data){return !!(p&&(p.dash||((p.dashSerial||0)>0&&(!data||typeof data.dashSerial!=='number'||data.dashSerial<p.dashSerial))));}
 clear(a,b){
  const nav=this.world.nav,r=CONFIG.radius;
  if(Math.abs(b.x)>HALF_SIZE-r||Math.abs(b.z)>HALF_SIZE-r)return false;
  for(const h of [.12,.55,1.05,1.6,1.98])for(const [x,z] of [[0,0],[r,0],[-r,0],[0,r],[0,-r]]){
   if(!nav.clear({x:a.x+x,y:a.y+h,z:a.z+z},{x:b.x+x,y:b.y+h,z:b.z+z}))return false;
   if((x||z)&&!nav.clear({x:b.x,y:b.y+h,z:b.z},{x:b.x+x,y:b.y+h,z:b.z+z}))return false;
  }
  return true;
 }
 request(id,o){
  const p=this.world.players.get(id),t=this.now();
  if(!p||!p.alive||p.escaped||!o||o.life!==p.life)return false;
  if(t<(p.dashRequestAt||0))return false;p.dashRequestAt=t+.15;
  if(p.dash||p.drone||!p.positioned||p.prone||p.crouched||p.swimming||!p.grounded||p.proneTransition){this.sync(p,'STANCE');return false;}
  if(t<(this.cooldowns.get(id)||0)){this.sync(p,'COOLDOWN');return false;}
  if(![o.dx,o.dz].every(finite)||Math.abs(o.dx)>1.001||Math.abs(o.dz)>1.001){this.sync(p,'DIRECTION');return false;}
  const length=Math.hypot(o.dx,o.dz);
  if(length<.13||length>1.42){this.sync(p,'DIRECTION');return false;}
  const dx=o.dx/length,dz=o.dz/length;
  const groundY=this.world.nav.height(p.x,p.z);
  if(!finite(groundY)||Math.abs(p.y-groundY)>2.2){this.sync(p,'GROUND');return false;}
  const from={x:p.x,y:groundY,z:p.z};
  let end={...from};const steps=Math.ceil(CONFIG.distance/CONFIG.step);
  for(let i=1;i<=steps;i++){
   const dist=CONFIG.distance*i/steps;
   const b={x:from.x+dx*dist,z:from.z+dz*dist};b.y=this.world.nav.height(b.x,b.z);
   if(!finite(b.y)||Math.abs(b.y-end.y)>.30||!this.clear(end,b))break;
   end=b;
  }
  const distance=Math.hypot(end.x-from.x,end.z-from.z);
  if(distance<.08){this.sync(p,'BLOCKED');return false;}
  const startedAt=this.now();
  // Client distance/duration/timestamps are deliberately ignored.
  p.dashSerial=++this.serial;
  p.dash={fromX:from.x,fromY:from.y,fromZ:from.z,toX:end.x,toY:end.y,toZ:end.z,
   startedAt,endsAt:startedAt+CONFIG.duration,distance};
  p.firing=p.aiming=false;p.speed=distance/CONFIG.duration;
  p.vx=dx*p.speed;p.vz=dz*p.speed;p.vy=0;
  this.cooldowns.set(id,startedAt+CONFIG.cooldown);
  const packet=this.packet(p),room=this.world.rooms.get(p.roomId);
  if(room)for(const q of room.players.values())this.world.emit(q.id,'DashState',packet);
  return true;
 }
 tick(){
  const t=this.now();
  for(const p of this.world.players.values()){
   const d=p.dash;if(!d)continue;
   if(!p.alive||p.drone){p.dash=null;this.sync(p,'CANCELLED');continue;}
   const u=Math.max(0,Math.min(1,(t-d.startedAt)/(d.endsAt-d.startedAt)));
   p.x=d.fromX+(d.toX-d.fromX)*u;p.z=d.fromZ+(d.toZ-d.fromZ)*u;
   p.y=this.world.nav.height(p.x,p.z);p.lastMove=this.world.time;
   if(u>=1){p.dash=null;p.vx=p.vz=p.speed=0;this.sync(p);}
  }
  for(const [id,until] of this.cooldowns)if(t>=until&&!this.world.players.has(id))this.cooldowns.delete(id);
 }
}
module.exports={DashLogic,CONFIG};
