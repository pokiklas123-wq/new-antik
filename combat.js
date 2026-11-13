'use strict';
const {randomUUID}=require('node:crypto');
const cemetery=require('./cemetery');
const forest=require('./forest');
const objectives=require('./objectives');
const {HALF_SIZE,CAVE_X,MAX_PLAYERS,VERSION,spawn,MONSTER_COUNT,ZONES,caveClearance}=require('./world-layout');
const WEAPONS=[{interval:.16,damage:12,range:160},{interval:.25,damage:20,range:130},{interval:.35,damage:30,range:145},{interval:.10,damage:8,range:140},{interval:.90,damage:85,range:180}];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
class CombatWorld{
 constructor(nav,emit=()=>{}){this.nav=nav;this.emit=emit;this.rooms=new Map();this.players=new Map();this.time=0;}
createRoom(){
 let room={id:randomUUID(),players:new Map(),monsters:[],closed:false,awake:false};
 if(this.spawnTemplate){room.monsters=this.spawnTemplate.map(m=>({...m,home:{...m.home},since:this.time}));}
 else for(const zone of ZONES){
  const d=this.nav.data,graph=this.nav.region(zone,false);
  const component=graph.components.reduce((a,b)=>a.length>b.length?a:b,[]);
  const candidates=component.map(i=>({i,...this.nav.point(i)}));
  const bossGraph=this.nav.region(zone,true);
  let bossLabel=0,bossArea=0;
  for(const p of candidates){const label=bossGraph.labels[p.i],area=label?bossGraph.components[label-1].length:0;if(area>bossArea){bossArea=area;bossLabel=label;}}
  const legalBoss=candidates.filter(p=>d.boss[p.i]==='1'&&bossGraph.allowed[p.i]&&bossGraph.labels[p.i]===bossLabel);
  legalBoss.sort((a,b)=>Math.hypot(a.x-zone.x,a.z-zone.z)-Math.hypot(b.x-zone.x,b.z-zone.z));
  if(!legalBoss.length||candidates.length<20)throw Error('Zone '+zone.id+' lacks reachable monster spawns');
  const selected=[legalBoss[0]],separation=new Float64Array(candidates.length);separation.fill(Infinity);
  for(let n=1;n<20;n++){
   const last=selected[selected.length-1];let best=-1,score=-1;
   for(let i=0;i<candidates.length;i++){
    const p=candidates[i],dist=(p.x-last.x)**2+(p.z-last.z)**2;
    separation[i]=Math.min(separation[i],dist);
    if(separation[i]>score){score=separation[i];best=i;}
   }
   if(score<9)throw Error('Zone '+zone.id+' lacks separated monster spawns');
   selected.push(candidates[best]);
  }
  for(let n=0;n<20;n++){
   const p=selected[n],boss=n===0,caveBoss=boss&&zone.id==='cave';
   // 👇 هنا تم التعديل إلى 60 للتابع و 300 للزعيم 👇
   room.monsters.push({id:room.monsters.length,zone:zone.id,boss,x:p.x,y:caveBoss?36:p.y,z:p.z,home:{x:p.x,y:p.y,z:p.z},hp:boss?0:0,maxHp:boss?0:0,yaw:0,state:caveBoss?'suspended':'idle',since:this.time,attackAt:0,hitDone:false,target:null,pathAt:0,waypoint:null,patrol:null,patrolStep:0,patrolSerial:0,patrolRetry:0,revision:0,vx:0,vy:0,vz:0});
  }
 }
 for(const m of room.monsters)cemetery.init(m);
 if(!this.spawnTemplate)this.spawnTemplate=room.monsters.map(m=>({...m,home:{...m.home}}));
 objectives.init(this,room);this.rooms.set(room.id,room);return room;
}
 join(id,roomId,fresh=false){this.leave(id);let room=this.rooms.get(roomId);if(!roomId&&!fresh)room=[...this.rooms.values()].find(r=>!r.closed&&r.players.size<MAX_PLAYERS);if(!room||room.closed||room.players.size>=MAX_PLAYERS)room=this.createRoom();let used=new Set([...room.players.values()].map(p=>p.spawnSlot)),slot=0;while(used.has(slot))slot++;let start=spawn(slot);let p={id,roomId:room.id,...start,spawnSlot:slot,initialSpawn:Object.freeze({...start}),life:0,gateArmed:false,hp:100,alive:true,positioned:false,lastMove:this.time,lastShot:-100,sequence:0,equipped:-1,inHands:false,aiming:false,firing:false,grounded:true,proneTransition:0,speed:0,localForward:0,vy:0,pitch:0,flashlight:null,yaw:0,crouched:false,prone:false,swimming:true};room.players.set(id,p);this.players.set(id,p);this.emit(id,'roomJoined',{id:p.id,droneProtocol:1,dashProtocol:1,roomId:room.id,hp:100,serverTime:this.time,spawn:start,life:p.life,objectiveProtocol:1,spawnSlot:slot,layout:VERSION,maxPlayers:MAX_PLAYERS,protocol:2,seed:48391,halfSize:HALF_SIZE,terrainSignature:this.nav.data?.terrainSignature||""});this.sendSnapshot(p);return room;}
 leave(id){let p=this.players.get(id);if(!p)return;if(this.drone)this.drone.cancel(p);this.players.delete(id);let r=this.rooms.get(p.roomId);if(!r)return;objectives.drop(this,r,p);r.players.delete(id);this.checkClose(r);}
 checkClose(r){if(![...r.players.values()].some(p=>p.alive)){r.closed=true;this.rooms.delete(r.id);for(let p of r.players.values())this.emit(p.id,'roomClosed',{roomId:r.id});}}
 move(id,data){let p=this.players.get(id);if(this.dash&&this.dash.rejectMove(p,data))return false;if(this.drone&&this.drone.rejectMove(p,data))return false;if(!p||!p.alive||!data||![data.x,data.y,data.z].every(finite)||Math.abs(data.x)>HALF_SIZE||Math.abs(data.z)>HALF_SIZE||data.y< -50||data.y>400)return false;
  if((data.life===undefined?0:data.life)!==p.life)return false;
  let dt=Math.max(.05,Math.min(1,this.time-p.lastMove));if(distance(p,data)>85*dt+2)return false;
  const nextWeapon=Number.isInteger(data.weapon)&&data.weapon>=-1&&data.weapon<5?data.weapon:-1;
  const nextCrouch=data.crouched===true,nextProne=data.prone===true,nextSwim=data.swimming===true,nextGround=data.grounded!==false;
  const nextInHands=data.inHands===true,nextAim=data.aiming===true,nextFire=data.firing===true;
  const stateChanged=(p.crouched!==nextCrouch)||(p.prone!==nextProne)||(p.swimming!==nextSwim)||(p.grounded!==nextGround)||(p.equipped!==nextWeapon)||(p.inHands!==nextInHands)||(p.aiming!==nextAim)||(p.firing!==nextFire);
  p.x=data.x;p.y=data.y;p.z=data.z;p.yaw=finite(data.yaw)?data.yaw%360:p.yaw;
  p.viewYaw=finite(data.viewYaw)?data.viewYaw%360:p.yaw;
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
 damage(p,amount){
  if(!p.alive||this.time<(p.invulnerableUntil||0))return;
  const r=this.rooms.get(p.roomId);p.hp=Math.max(0,p.hp-amount);if(p.hp===0&&this.drone)this.drone.cancel(p);
  if(p.hp===0&&r&&objectives.held(r,p).length>0){
   objectives.drop(this,r,p);p.dash=null;p.life++;p.hp=100;p.alive=true;p.escaped=false;
   Object.assign(p,p.initialSpawn);
   p.positioned=false;p.lastMove=this.time;p.equipped=-1;p.inHands=p.aiming=p.firing=false;
   p.crouched=p.prone=false;p.grounded=false;p.swimming=true;p.proneTransition=0;
   p.vy=p.speed=p.localForward=0;p.flashlight=null;p.gateArmed=false;
   p.invulnerableUntil=this.time+.35;
   this.emit(p.id,'playerState',{hp:100,alive:true,respawn:true,spawn:{...p.initialSpawn},life:p.life,clearWeapons:true});
   if(this.dash)this.dash.sync(p);
   this.emit(p.id,'objectiveSnapshot',objectives.snapshot(this,r,p));return;
  }
  if(p.hp===0){p.alive=false;p.equipped=-1;p.inHands=p.aiming=p.firing=false;p.flashlight=null;}
  this.emit(p.id,'playerState',{hp:p.hp,alive:p.alive,life:p.life});
  if(r)this.checkClose(r);
 }
 shoot(id,data){let p=this.players.get(id);if(this.dash&&this.dash.locked(p))return false;if(this.drone&&this.drone.locked(p))return false;let r=p&&this.rooms.get(p.roomId);if(!p||!p.alive||!r||!data)return false;if((data.life===undefined?0:data.life)!==p.life)return false;let w=WEAPONS[data.weapon];if(!w||data.weapon!==p.equipped||!Number.isInteger(data.sequence)||data.sequence<=p.sequence||![data.x,data.y,data.z,data.dx,data.dy,data.dz,data.range].every(finite))return false;
  p.sequence=data.sequence;if(this.time-p.lastShot<w.interval-.015)return false;
  let origin={x:data.x,y:data.y,z:data.z},dir={x:data.dx,y:data.dy,z:data.dz},l=Math.hypot(dir.x,dir.y,dir.z);if(l<.98||l>1.02||Math.hypot(origin.x-p.x,origin.y-(p.y+1),origin.z-p.z)>8)return false;
  if(!this.nav.clear({x:p.x,y:p.y+1,z:p.z},origin))return false;
  if(finite(data.viewYaw))p.viewYaw=data.viewYaw%360;
  p.lastShot=this.time;p.firing=true;let range=Math.max(0,Math.min(w.range,data.range)),wall=this.nav.ray(origin,dir,range),nearest=wall,hit=null;
  for(let m of r.monsters){if(m.hp<=0||m.state==='suspended'||m.state==='dropping'||m.state==='roar'||(m.zone==='graveyard'&&['dormant','rise','scream'].includes(m.state)))continue;if(m.zone==='graveyard'&&m.boss&&(m.retreating||!m.awakened||!cemetery.eligible(this,p)))continue;if(m.zone==='forest'){const t=forest.rayHit(m,origin,dir);if(t<nearest){nearest=t;hit=m;}continue;}if(m.zone==='graveyard'){const t=cemetery.rayHit(m,origin,dir);if(t<nearest){nearest=t;hit=m;}continue;}let radius=m.boss?2.3:.95,centerY=m.y+(m.boss?1.5:.6),ox=origin.x-m.x,oy=origin.y-centerY,oz=origin.z-m.z,b=ox*dir.x+oy*dir.y+oz*dir.z,c=ox*ox+oy*oy+oz*oz-radius*radius,disc=b*b-c;if(disc<0)continue;let t=Math.max(0,-b-Math.sqrt(disc));if(t<nearest){nearest=t;hit=m;}}
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
  else if(hit){hit.hp=Math.max(0,hit.hp-w.damage);if(hit.hp===0){this.state(hit,'dead');cemetery.killed(this,r,hit,p);}else hit.target=p.id;this.emit(p.id,'hitConfirm',{id:hit.id,damage:w.damage,hp:hit.hp});}return true;
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
   for(let m of r.monsters){let x=m.x,y=m.y,z=m.z,teleports=m.teleports||0;this.updateMonster(r,m,players,dt);let jumped=(m.teleports||0)!==teleports;m.vx=jumped?0:(m.x-x)/dt;m.vy=jumped?0:(m.y-y)/dt;m.vz=jumped?0:(m.z-z)/dt;}
   cemetery.tickProjectiles(this,r,dt);
   objectives.tick(this,r);
  }}
 updateMonster(r,m,players,dt){if(m.zone==='forest'){forest.update(this,r,m,players,dt);return;}if(m.zone==='graveyard'){cemetery.update(this,r,m,players,dt);return;}if(m.hp<=0||m.state==='suspended')return;
  if(m.state==='dropping'){let t=Math.min(1,(this.time-m.since)/1.5);m.y=36+(m.home.y-36)*(t*t*(3-2*t));if(t===1){m.y=m.home.y;this.state(m,'roar');}return;}
  if(m.state==='roar'){if(this.time-m.since>=2.2)this.state(m,'idle');return;}
  const zone=ZONES.find(z=>z.id===(m.zone||'cave'));
  let target=null,best=Infinity;
  for(const p of players){
   if(!p.groundEligible||Math.hypot(p.x-zone.x,p.z-zone.z)>zone.radius)continue;
   if(m.zone==='cave'&&(Math.abs(p.y-12)>=4||caveClearance(p.x,p.z)<2))continue;
   const d=(m.x-p.x)**2+(m.z-p.z)**2;
   // Cave-floor intruders trigger the entire connected cave, not just a 32m circle.
   const caveIntruder=m.zone==='cave'&&Math.abs(p.y-12)<4;
   if((caveIntruder||d<90*90||m.target===p.id)&&d<best){
    const a=this.nav.regionNearest(m.x,m.z,zone,m.boss),b=this.nav.regionNearest(p.x,p.z,zone,m.boss),g=this.nav.region(zone,m.boss);
    if(a>=0&&b>=0&&g.labels[a]===g.labels[b]){target=p;best=d;}
   }
  }
  if(m.state==='attack'){
   const p=this.players.get(m.target);
   const valid=p&&p.alive&&p.positioned&&p.groundEligible&&Math.abs(p.y-m.y)<6&&Math.hypot(p.x-zone.x,p.z-zone.z)<=zone.radius&&(m.zone!=='cave'||(Math.abs(p.y-12)<4&&caveClearance(p.x,p.z)>=2));
   // Translate throughout windup/recovery. An attack must never root the monster.
   if(valid)this.moveMonster(m,p,m.boss?(m.hp<100?16:13):12,dt,true,(m.boss?5:2.1)*.6);
   if(!m.hitDone&&this.time-m.since>=(m.boss?.58:.32)){
    m.hitDone=true;
    if(valid&&distance(m,p)<=(m.boss?5:2.1)&&Math.abs(p.y-m.y)<3&&this.nav.clear({x:m.x,y:m.y+1,z:m.z},{x:p.x,y:p.y+1,z:p.z}))this.damage(p,m.boss?12:6);
   }
   if(this.time-m.since>=(m.boss?1.0:.7))this.state(m,valid?'run':'idle');
   return;
  }
  if(target){
   if(m.target!==target.id){m.waypoint=null;m.pathAt=0;}
   m.target=target.id;m.patrol=null;
   const range=m.boss?5:2.1;
   if(distance(m,target)<=range&&this.time>=m.attackAt&&this.nav.clear({x:m.x,y:m.y+1,z:m.z},{x:target.x,y:target.y+1,z:target.z})){
    m.attackAt=this.time+(m.boss?1.55:1.15);m.hitDone=false;
    m.yaw=Math.atan2(target.x-m.x,target.z-m.z)*180/Math.PI;this.state(m,'attack');
    this.moveMonster(m,target,m.boss?(m.hp<100?16:13):12,dt,true,range*.6);return;
   }
   this.moveMonster(m,target,m.boss?(m.hp<100?16:13):12,dt,false,range*.6);
  }else{
   if(m.target!==null){m.target=null;m.waypoint=null;m.pathAt=0;}
   this.patrolMonster(m,zone,dt);
  }
 }
 patrolMonster(m,zone,dt){
  if(!m.patrol||m.patrolStep>=m.patrol.length){
   if(this.time<(m.patrolRetry||0)){this.state(m,'idle');return;}
   const g=this.nav.region(zone,m.boss),start=this.nav.regionNearest(m.x,m.z,zone,m.boss);
   if(start<0){m.patrolRetry=this.time+2;return;}
   const cells=g.components[g.labels[start]-1];
   // Deterministic per-monster goals: no shared centre or synchronized marching.
   let seed=((m.id+1)*2654435761+(++m.patrolSerial)*2246822519)>>>0,goal=null;
   for(let attempt=0;attempt<24;attempt++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const p=this.nav.point(cells[seed%cells.length]);goal=p;
    if(distance(m,p)>Math.min(45,zone.radius*.35))break;
   }
   m.patrol=this.nav.route(m.x,m.z,goal.x,goal.z,m.boss,zone);m.patrolStep=0;
   m.waypoint=null;m.pathAt=0;
   if(!m.patrol||!m.patrol.length){m.patrolRetry=this.time+1;this.state(m,'idle');return;}
  }
  const speed=m.zone==='forest'?(m.boss?4.2:3.6):(m.boss?7:6),budget=speed*dt;let remaining=budget,moved=false;
  for(let attempt=0;attempt<8&&remaining>.001&&m.patrolStep<m.patrol.length;attempt++){
   const p=m.patrol[m.patrolStep],dx=p.x-m.x,dz=p.z-m.z,l=Math.hypot(dx,dz);
   if(l<.015){m.patrolStep++;continue;}
   const step=Math.min(l,remaining),x=m.x+dx/l*step,z=m.z+dz/l*step;
   if(Math.hypot(x-zone.x,z-zone.z)>zone.radius||!this.nav.walkable(x,z,m.boss)){m.patrol=null;break;}
   m.x=x;m.z=z;m.y=this.nav.height(x,z);m.yaw=Math.atan2(dx,dz)*180/Math.PI;
   remaining-=step;moved=true;if(step>=l-.001)m.patrolStep++;
  }
  if(moved)this.state(m,'run');else this.state(m,'idle');
 }
 moveMonster(m,target,speed,dt,preserveState=false,stopDistance=0){
  let budget=Math.min(speed*dt,Math.max(0,distance(m,target)-stopDistance)),moved=false,heading=m.yaw;
  const zone=ZONES.find(z=>z.id===(m.zone||'cave'));
  for(let attempt=0;attempt<8&&budget>.001;attempt++){
   if(this.time>=m.pathAt||!m.waypoint||distance(m,m.waypoint)<.015){m.pathAt=this.time+.25;m.waypoint=this.nav.next(m.x,m.z,target.x,target.z,m.boss,this.time,zone);}
   let p=m.waypoint;if(!p)break;
   let dx=p.x-m.x,dz=p.z-m.z,l=Math.hypot(dx,dz);
   // Inside the goal cell, finish approaching the actual player rather than stop at its centre.
   if(l<.015&&distance(m,target)>stopDistance&&this.nav.clear({x:m.x,y:m.y+1,z:m.z},{x:target.x,y:target.y+1,z:target.z})){
    p=target;dx=p.x-m.x;dz=p.z-m.z;l=Math.hypot(dx,dz);
   }
   if(l<.015){m.waypoint=null;break;}
   let step=Math.min(l,budget),x=m.x+dx/l*step,z=m.z+dz/l*step;
   if(Math.hypot(x-zone.x,z-zone.z)>zone.radius)break;
   if(!this.nav.walkable(x,z,m.boss)){m.waypoint=null;m.pathAt=0;break;}
   m.x=x;m.z=z;m.y=this.nav.height(x,z);heading=Math.atan2(dx,dz)*180/Math.PI;budget-=step;moved=true;
   if(step>=l-.001){m.waypoint=null;m.pathAt=0;}
  }
  if(moved){m.yaw=heading;if(!preserveState)this.state(m,m.zone!=='forest'&&m.boss&&m.hp<100?'roll':'run');}
  else if(!preserveState&&distance(m,target)<1.5)this.state(m,'idle');
 }

 snapshot(p){
  let r=this.rooms.get(p.roomId);if(!r)return {serverTime:this.time,roomId:p.roomId,monsters:[]};
  // Omit dead non-boss spiders once their 1.5s death animation completes; retain dead bosses as strategic landmarks
  return {serverTime:this.time,roomId:r.id,monsters:r.monsters.filter(m=>distance(m,p)<100&&(m.boss||m.hp>0||(this.time-m.since)<(m.zone==='forest'?forest.CLIPS.minionDeath+.15:m.zone==='graveyard'?1.8:1.6))).map(m=>({id:m.id,zone:m.zone,boss:m.boss,x:m.x,y:m.y,z:m.z,yaw:m.yaw,hp:m.hp,maxHp:m.maxHp,state:m.state,age:this.time-m.since,revision:m.revision,vx:m.vx,vy:m.vy,vz:m.vz,teleports:m.teleports||0,attackKind:m.attackKind||'',enraged:(m.zone==='graveyard'||m.zone==='forest')&&m.boss&&m.hp<100})),projectiles:cemetery.snapshot(r,p)};
 }
 sendPlayerSnapshot(p){
  const r=this.rooms.get(p.roomId);if(!r)return;
  const players=[...r.players.values()].filter(q=>q.id!==p.id&&q.alive&&q.positioned&&distance(q,p)<100).map(q=>({
   id:q.id,x:q.x,y:q.y,z:q.z,yaw:q.yaw,pitch:q.pitch,
   crouched:q.crouched,prone:q.prone,swimming:q.swimming,grounded:q.grounded,
   weapon:q.equipped,inHands:q.inHands,aiming:q.aiming,
   firing:q.firing||(this.time-q.lastShot<.38),
   proneTransition:q.proneTransition,speed:q.speed,localForward:q.localForward,vy:q.vy,
   dash:this.dash?this.dash.packet(q):null,drone:this.drone?this.drone.packet(q):null,light:q.flashlight
  }));
  this.emit(p.id,'playerSnapshot',{serverTime:this.time,roomId:r.id,players});
 }
 sendSnapshot(p){
  this.emit(p.id,'monsterSnapshot',this.snapshot(p));
  this.sendPlayerSnapshot(p);
  const r=this.rooms.get(p.roomId);if(r)this.emit(p.id,'objectiveSnapshot',objectives.snapshot(this,r,p));
 }
}
module.exports={CombatWorld,WEAPONS};
