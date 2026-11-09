'use strict';
const {randomUUID}=require('node:crypto');
const {HALF_SIZE,CAVE_X,MAX_PLAYERS,VERSION,spawn,MONSTER_COUNT,ZONES}=require('./world-layout');
const WEAPONS=[{interval:.16,damage:12,range:160},{interval:.25,damage:20,range:130},{interval:.35,damage:30,range:145},{interval:.10,damage:8,range:140},{interval:.90,damage:85,range:180}];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
class CombatWorld{
 constructor(nav,emit=()=>{}){this.nav=nav;this.emit=emit;this.rooms=new Map();this.players=new Map();this.time=0;}
 createRoom(){let room={id:randomUUID(),players:new Map(),monsters:[],closed:false,awake:false};
  if(this.spawnTemplate){room.monsters=this.spawnTemplate.map(m=>({...m,home:{...m.home},since:this.time}));}
  else for(const zone of ZONES){
   const candidates=[],d=this.nav.data;
   if(d){for(let i=0;i<d.n*d.n;i++)if(d.small[i]==='1'){
    const p=this.nav.point(i);if(Math.hypot(p.x-zone.x,p.z-zone.z)>zone.radius-8)continue;
    if(zone.id==='cave'&&(Math.abs(p.y-12)>.25||Math.hypot(p.x-CAVE_X,p.z)>245))continue;
    if(ZONES.some(other=>other.id!==zone.id&&Math.hypot(p.x-other.x,p.z-other.z)<Math.hypot(p.x-zone.x,p.z-zone.z)))continue;
    candidates.push({i,...p});
   }}else {for(let i=0;i<100;i++)candidates.push({i,...this.nav.point(this.nav.nearest(zone.x+(i%10)*3,zone.z+Math.floor(i/10)*3,false))});}
   candidates.sort((a,b)=>Math.hypot(a.x-zone.x,a.z-zone.z)-Math.hypot(b.x-zone.x,b.z-zone.z));
   let selected=[];
   for(const seed of candidates){if(d&&d.boss[seed.i]!=='1')continue;
    selected=[seed];
    for(const p of candidates){if(selected.length===20)break;if(selected.some(q=>Math.hypot(q.x-p.x,q.z-p.z)<3))continue;
     if(!this.nav.next(p.x,p.z,seed.x,seed.z,false,this.time))continue;selected.push(p);}
    if(selected.length===20)break;
   }
   if(selected.length!==20)throw Error('Zone '+zone.id+' lacks 20 reachable monster spawns');
   for(let n=0;n<20;n++){const p=selected[n],boss=n===0,caveBoss=boss&&zone.id==='cave';
    room.monsters.push({id:room.monsters.length,zone:zone.id,boss,x:p.x,y:caveBoss?36:p.y,z:p.z,home:{x:p.x,y:p.y,z:p.z},hp:boss?300:100,maxHp:boss?300:100,yaw:0,state:caveBoss?'suspended':'idle',since:this.time,attackAt:0,hitDone:false,target:null,pathAt:0,waypoint:null,revision:0,vx:0,vy:0,vz:0});
   }
  }
  if(!this.spawnTemplate)this.spawnTemplate=room.monsters.map(m=>({...m,home:{...m.home}}));
  this.rooms.set(room.id,room);return room;
 }
 join(id,roomId,fresh=false){this.leave(id);let room=this.rooms.get(roomId);if(!roomId&&!fresh)room=[...this.rooms.values()].find(r=>!r.closed&&r.players.size<MAX_PLAYERS);if(!room||room.closed||room.players.size>=MAX_PLAYERS)room=this.createRoom();let used=new Set([...room.players.values()].map(p=>p.spawnSlot)),slot=0;while(used.has(slot))slot++;let start=spawn(slot);let p={id,roomId:room.id,...start,spawnSlot:slot,hp:100,alive:true,positioned:false,lastMove:this.time,lastShot:-100,sequence:0,equipped:-1,inHands:false,aiming:false,firing:false,grounded:true,proneTransition:0,speed:0,localForward:0,vy:0,pitch:0,flashlight:null,yaw:0,crouched:false,prone:false,swimming:true};room.players.set(id,p);this.players.set(id,p);this.emit(id,'roomJoined',{roomId:room.id,hp:100,serverTime:this.time,spawn:start,spawnSlot:slot,layout:VERSION,maxPlayers:MAX_PLAYERS,protocol:2,seed:48391,halfSize:HALF_SIZE,terrainSignature:this.nav.data?.terrainSignature||""});this.sendSnapshot(p);return room;}
 leave(id){let p=this.players.get(id);if(!p)return;this.players.delete(id);let r=this.rooms.get(p.roomId);if(!r)return;r.players.delete(id);this.checkClose(r);}
 checkClose(r){if(![...r.players.values()].some(p=>p.alive)){r.closed=true;this.rooms.delete(r.id);for(let p of r.players.values())this.emit(p.id,'roomClosed',{roomId:r.id});}}
 move(id,data){let p=this.players.get(id);if(!p||!p.alive||!data||![data.x,data.y,data.z].every(finite)||Math.abs(data.x)>HALF_SIZE||Math.abs(data.z)>HALF_SIZE||data.y< -50||data.y>400)return false;
  let dt=Math.max(.05,Math.min(1,this.time-p.lastMove));if(distance(p,data)>85*dt+2)return false;
  const nextWeapon=Number.isInteger(data.weapon)&&data.weapon>=-1&&data.weapon<5?data.weapon:-1;
  const nextCrouch=data.crouched===true,nextProne=data.prone===true,nextSwim=data.swimming===true,nextGround=data.grounded!==false;
  const nextInHands=data.inHands===true,nextAim=data.aiming===true,nextFire=data.firing===true;
  const stateChanged=(p.crouched!==nextCrouch)||(p.prone!==nextProne)||(p.swimming!==nextSwim)||(p.grounded!==nextGround)||(p.equipped!==nextWeapon)||(p.inHands!==nextInHands)||(p.aiming!==nextAim)||(p.firing!==nextFire);
  p.x=data.x;p.y=data.y;p.z=data.z;p.yaw=finite(data.yaw)?data.yaw%360:p.yaw;
  p.pitch=finite(data.pitch)?Math.max(-85,Math.min(85,data.pitch)):p.pitch;
  p.crouched=nextCrouch;p.prone=nextProne;p.swimming=nextSwim;p.grounded=nextGround;
  p.inHands=nextInHands;p.aiming=nextAim;p.firing=nextFire;
  p.proneTransition=Number.isInteger(data.proneTransition)?Math.max(-1,Math.min(1,data.proneTransition)):0;
  p.speed=finite(data.speed)?Math.max(0,Math.min(90,data.speed)):0;
  p.localForward=finite(data.localForward)?Math.max(-1,Math.min(1,data.localForward)):0;
  p.vy=finite(data.vy)?Math.max(-50,Math.min(50,data.vy)):0;
  p.positioned=true;p.lastMove=this.time;p.equipped=nextWeapon;
  // Immediately push playerSnapshot to nearby peers on stance/jump/weapon change for 0ms server broadcast delay
  if(stateChanged){
   const r=this.rooms.get(p.roomId);
   if(r)for(const q of r.players.values())if(q.id!==p.id&&q.alive&&distance(q,p)<100)this.sendPlayerSnapshot(q);
  }
  return true;}
 state(m,state){if(m.state!==state){m.state=state;m.since=this.time;m.revision++;}}
 alive(r){return [...r.players.values()].filter(p=>p.alive&&p.positioned);}
 damage(p,amount){if(!p.alive)return;p.hp=Math.max(0,p.hp-amount);if(p.hp===0)p.alive=false;this.emit(p.id,'playerState',{hp:p.hp,alive:p.alive});let r=this.rooms.get(p.roomId);if(r)this.checkClose(r);}
 shoot(id,data){let p=this.players.get(id),r=p&&this.rooms.get(p.roomId);if(!p||!p.alive||!r||!data)return false;let w=WEAPONS[data.weapon];if(!w||data.weapon!==p.equipped||!Number.isInteger(data.sequence)||data.sequence<=p.sequence||![data.x,data.y,data.z,data.dx,data.dy,data.dz,data.range].every(finite))return false;
  p.sequence=data.sequence;if(this.time-p.lastShot<w.interval-.015)return false;
  let origin={x:data.x,y:data.y,z:data.z},dir={x:data.dx,y:data.dy,z:data.dz},l=Math.hypot(dir.x,dir.y,dir.z);if(l<.98||l>1.02||Math.hypot(origin.x-p.x,origin.y-(p.y+1),origin.z-p.z)>8)return false;
  if(!this.nav.clear({x:p.x,y:p.y+1,z:p.z},origin))return false;
  p.lastShot=this.time;p.firing=true;let range=Math.max(0,Math.min(w.range,data.range)),wall=this.nav.ray(origin,dir,range),nearest=wall,hit=null;
  for(let m of r.monsters){if(m.hp<=0||m.state==='suspended'||m.state==='dropping'||m.state==='roar')continue;let radius=m.boss?2.3:.95,centerY=m.y+(m.boss?1.5:.6),ox=origin.x-m.x,oy=origin.y-centerY,oz=origin.z-m.z,b=ox*dir.x+oy*dir.y+oz*dir.z,c=ox*ox+oy*oy+oz*oz-radius*radius,disc=b*b-c;if(disc<0)continue;let t=Math.max(0,-b-Math.sqrt(disc));if(t<nearest){nearest=t;hit=m;}}
  let victim=null;
  for(const q of r.players.values()){
   if(q.id===p.id||!q.alive||!q.positioned)continue;
   const h=q.prone?.55:q.crouched?1.12:1.78,radius=.48;
   const y0=q.y+Math.min(radius,h*.5),y1=q.y+h-Math.min(radius,h*.5),rad=Math.min(radius,h*.5);
   let t=Infinity;const ox=origin.x-q.x,oz=origin.z-q.z,A=dir.x**2+dir.z**2,B=ox*dir.x+oz*dir.z,C=ox**2+oz**2-rad**2;
   if(A>1e-9){const D=B*B-A*C;if(D>=0){const v=(-B-Math.sqrt(D))/A,yy=origin.y+v*dir.y;if(v>=0&&yy>=y0&&yy<=y1)t=v;}}
   for(const cy of [y0,y1]){const oy=origin.y-cy,bb=ox*dir.x+oy*dir.y+oz*dir.z,cc=ox*ox+oy*oy+oz*oz-rad*rad,disc=bb*bb-cc;if(disc>=0){const v=-bb-Math.sqrt(disc);if(v>=0)t=Math.min(t,v);}}
   if(t<nearest){nearest=t;victim=q;hit=null;}
  }
  for(const q of r.players.values()){
   if(q.id!==p.id&&q.alive&&distance(q,p)<110){
    this.emit(q.id,'playerShot',{id:p.id,weapon:data.weapon,x:origin.x,y:origin.y,z:origin.z,dx:dir.x/l,dy:dir.y/l,dz:dir.z/l,range:nearest});
   }
  }
  if(victim){this.damage(victim,w.damage);this.emit(p.id,'hitConfirm',{playerId:victim.id,damage:w.damage,hp:victim.hp});}
  else if(hit){hit.hp=Math.max(0,hit.hp-w.damage);if(hit.hp===0)this.state(hit,'dead');else hit.target=p.id;this.emit(p.id,'hitConfirm',{id:hit.id,damage:w.damage,hp:hit.hp});}return true;
 }
 light(id,data){
  const p=this.players.get(id);if(!p||!p.alive||!data)return null;
  if(data.on===false){p.flashlight={id,on:false};return p.flashlight;}
  if(data.on!==true||![data.x,data.y,data.z,data.dx,data.dy,data.dz].every(finite))return null;
  const len=Math.hypot(data.dx,data.dy,data.dz);if(len<.98||len>1.02||Math.hypot(data.x-p.x,data.y-(p.y+1),data.z-p.z)>8)return null;
  if(!this.nav.clear({x:p.x,y:p.y+1,z:p.z},{x:data.x,y:data.y,z:data.z}))return null;
  p.flashlight={id,on:true,ads:data.ads===true,x:data.x,y:data.y,z:data.z,dx:data.dx/len,dy:data.dy/len,dz:data.dz/len,range:80};return p.flashlight;
 }

 tick(dt){this.time+=dt;for(let r of this.rooms.values()){let players=this.alive(r),boss=r.monsters.find(m=>m.boss&&m.zone==='cave');
   for(const p of players)p.groundEligible=Math.abs(p.y-this.nav.height(p.x,p.z))<4;
   if(boss&&!r.awake&&players.some(p=>Math.hypot(p.x-CAVE_X,p.z*.91)<34&&p.y>=10&&p.y<33)){r.awake=true;this.state(boss,'dropping');}
   for(let m of r.monsters){let x=m.x,y=m.y,z=m.z;this.updateMonster(r,m,players,dt);m.vx=(m.x-x)/dt;m.vy=(m.y-y)/dt;m.vz=(m.z-z)/dt;}
  }}
 updateMonster(r,m,players,dt){if(m.hp<=0||m.state==='suspended')return;
  if(m.state==='dropping'){let t=Math.min(1,(this.time-m.since)/1.5);m.y=36+(m.home.y-36)*(t*t*(3-2*t));if(t===1){m.y=m.home.y;this.state(m,'roar');}return;}
  if(m.state==='roar'){if(this.time-m.since>=2.2)this.state(m,'idle');return;}
  let target=null,best=Infinity;
  for(const p of players){
   const zone=ZONES.find(z=>z.id===(m.zone||'cave'));if(!p.groundEligible||Math.hypot(p.x-zone.x,p.z-zone.z)>zone.radius)continue;
   let d=(m.x-p.x)**2+(m.z-p.z)**2;if(((m.zone==='cave'&&r.awake)||d<32*32)&&d<best){target=p;best=d;}
  }
  if(m.state==='attack'){
   if(!m.hitDone&&this.time-m.since>=(m.boss?.58:.56)){m.hitDone=true;let p=this.players.get(m.target);if(p&&p.alive&&distance(m,p)<=(m.boss?5:2.1)&&Math.abs(p.y-m.y)<3&&this.nav.clear({x:m.x,y:m.y+1,z:m.z},{x:p.x,y:p.y+1,z:p.z}))this.damage(p,m.boss?30:12);}
   if(this.time-m.since>=(m.boss?1.35:1.45))this.state(m,'idle');return;
  }
  if(target){m.target=target.id;let range=m.boss?5:2.1;
   if(distance(m,target)<=range&&this.time>=m.attackAt&&this.nav.clear({x:m.x,y:m.y+1,z:m.z},{x:target.x,y:target.y+1,z:target.z})){m.attackAt=this.time+(m.boss?1.55:1.8);m.hitDone=false;m.yaw=Math.atan2(target.x-m.x,target.z-m.z)*180/Math.PI;this.state(m,'attack');return;}
   this.moveMonster(m,target,m.boss?(m.hp<100?16:13):10,dt);
  }else if(distance(m,m.home)>1.5){this.moveMonster(m,m.home,m.boss?13:10,dt);}else this.state(m,'idle');
 }
 moveMonster(m,target,speed,dt){
  let budget=speed*dt,moved=false,heading=m.yaw;
  for(let attempt=0;attempt<8&&budget>.001;attempt++){
   if(this.time>=m.pathAt||!m.waypoint||distance(m,m.waypoint)<.015){m.pathAt=this.time+.25;m.waypoint=this.nav.next(m.x,m.z,target.x,target.z,m.boss,this.time);}
   let p=m.waypoint;if(!p)break;
   let dx=p.x-m.x,dz=p.z-m.z,l=Math.hypot(dx,dz);if(l<.015){m.waypoint=null;break;}
   let step=Math.min(l,budget),x=m.x+dx/l*step,z=m.z+dz/l*step;
   const zone=ZONES.find(z=>z.id===(m.zone||'cave'));if(Math.hypot(x-zone.x,z-zone.z)>zone.radius)break;
   if(!this.nav.walkable(x,z,m.boss)){m.waypoint=null;m.pathAt=0;break;}
   m.x=x;m.z=z;m.y=this.nav.height(x,z);heading=Math.atan2(dx,dz)*180/Math.PI;budget-=step;moved=true;
   if(step>=l-.001){m.waypoint=null;m.pathAt=0;}
  }
  if(moved){m.yaw=heading;this.state(m,m.boss&&m.hp<100?'roll':'run');}
  else if(distance(m,target)<1.5)this.state(m,'idle');
 }

 snapshot(p){
  let r=this.rooms.get(p.roomId);if(!r)return {serverTime:this.time,roomId:p.roomId,monsters:[]};
  // Omit dead non-boss spiders once their 1.5s death animation completes; retain dead bosses as strategic landmarks
  return {serverTime:this.time,roomId:r.id,monsters:r.monsters.filter(m=>distance(m,p)<100&&(m.boss||m.hp>0||(this.time-m.since)<1.6)).map(m=>({id:m.id,zone:m.zone,boss:m.boss,x:m.x,y:m.y,z:m.z,yaw:m.yaw,hp:m.hp,maxHp:m.maxHp,state:m.state,age:this.time-m.since,revision:m.revision,vx:m.vx,vy:m.vy,vz:m.vz}))};
 }
 sendPlayerSnapshot(p){
  const r=this.rooms.get(p.roomId);if(!r)return;
  const players=[...r.players.values()].filter(q=>q.id!==p.id&&q.alive&&q.positioned&&distance(q,p)<100).map(q=>({
   id:q.id,x:q.x,y:q.y,z:q.z,yaw:q.yaw,pitch:q.pitch,
   crouched:q.crouched,prone:q.prone,swimming:q.swimming,grounded:q.grounded,
   weapon:q.equipped,inHands:q.inHands,aiming:q.aiming,
   firing:q.firing||(this.time-q.lastShot<.38),
   proneTransition:q.proneTransition,speed:q.speed,localForward:q.localForward,vy:q.vy,
   light:q.flashlight
  }));
  this.emit(p.id,'playerSnapshot',{serverTime:this.time,roomId:r.id,players});
 }
 sendSnapshot(p){
  this.emit(p.id,'monsterSnapshot',this.snapshot(p));
  this.sendPlayerSnapshot(p);
 }
}
module.exports={CombatWorld,WEAPONS};
