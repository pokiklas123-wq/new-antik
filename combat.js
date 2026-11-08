'use strict';
const {randomUUID}=require('node:crypto');
const {HALF_SIZE,CAVE_X,MAX_PLAYERS,VERSION,spawn}=require('./world-layout');
const WEAPONS=[{interval:.16,damage:12,range:160},{interval:.25,damage:20,range:130},{interval:.35,damage:30,range:145},{interval:.10,damage:8,range:140},{interval:.90,damage:85,range:180}];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
class CombatWorld{
 constructor(nav,emit=()=>{}){this.nav=nav;this.emit=emit;this.rooms=new Map();this.players=new Map();this.time=0;}
 createRoom(){let room={id:randomUUID(),players:new Map(),monsters:[],closed:false,awake:false};
  const add=(id,boss,x,z)=>{let cell=this.nav.nearest(x,z,boss);if(cell<0)throw Error('No valid monster spawn');let p=this.nav.point(cell);room.monsters.push({id,boss,...p,home:{...p},hp:boss?300:100,maxHp:boss?300:100,yaw:0,state:boss?'suspended':'idle',since:this.time,attackAt:0,hitDone:false,target:null,pathAt:0,waypoint:null,revision:0,vx:0,vy:0,vz:0});};
  add(0,true,CAVE_X,0);room.monsters[0].y=36;
  for(let i=0;i<5;i++){add(i+1,false,CAVE_X-12+i*6,-238);add(i+6,false,CAVE_X-12+i*6,238);}
  for(let i=0;i<10;i++){let a=i*Math.PI*2/10;add(i+11,false,CAVE_X+Math.cos(a)*24,Math.sin(a)*23);}
  this.rooms.set(room.id,room);return room;
 }
 join(id,roomId,fresh=false){this.leave(id);let room=this.rooms.get(roomId);if(!roomId&&!fresh)room=[...this.rooms.values()].find(r=>!r.closed&&r.players.size<MAX_PLAYERS);if(!room||room.closed||room.players.size>=MAX_PLAYERS)room=this.createRoom();let used=new Set([...room.players.values()].map(p=>p.spawnSlot)),slot=0;while(used.has(slot))slot++;let start=spawn(slot);let p={id,roomId:room.id,...start,spawnSlot:slot,hp:100,alive:true,positioned:false,lastMove:this.time,lastShot:-100,sequence:0,equipped:-1};room.players.set(id,p);this.players.set(id,p);this.emit(id,'roomJoined',{roomId:room.id,hp:100,serverTime:this.time,spawn:start,spawnSlot:slot,layout:VERSION,maxPlayers:MAX_PLAYERS});this.sendSnapshot(p);return room;}
 leave(id){let p=this.players.get(id);if(!p)return;this.players.delete(id);let r=this.rooms.get(p.roomId);if(!r)return;r.players.delete(id);this.checkClose(r);}
 checkClose(r){if(![...r.players.values()].some(p=>p.alive)){r.closed=true;this.rooms.delete(r.id);for(let p of r.players.values())this.emit(p.id,'roomClosed',{roomId:r.id});}}
 move(id,data){let p=this.players.get(id);if(!p||!p.alive||!data||![data.x,data.y,data.z].every(finite)||Math.abs(data.x)>HALF_SIZE||Math.abs(data.z)>HALF_SIZE||data.y< -50||data.y>400)return false;
  let dt=Math.max(.05,Math.min(1,this.time-p.lastMove));if(distance(p,data)>85*dt+2)return false; // vehicles retained, walking is client-collided
  p.x=data.x;p.y=data.y;p.z=data.z;p.positioned=true;p.lastMove=this.time;p.equipped=Number.isInteger(data.weapon)&&data.weapon>=-1&&data.weapon<5?data.weapon:-1;return true;}
 state(m,state){if(m.state!==state){m.state=state;m.since=this.time;m.revision++;}}
 alive(r){return [...r.players.values()].filter(p=>p.alive&&p.positioned);}
 damage(p,amount){if(!p.alive)return;p.hp=Math.max(0,p.hp-amount);if(p.hp===0)p.alive=false;this.emit(p.id,'playerState',{hp:p.hp,alive:p.alive});let r=this.rooms.get(p.roomId);if(r)this.checkClose(r);}
 shoot(id,data){let p=this.players.get(id),r=p&&this.rooms.get(p.roomId);if(!p||!p.alive||!r||!data)return false;let w=WEAPONS[data.weapon];if(!w||data.weapon!==p.equipped||!Number.isInteger(data.sequence)||data.sequence<=p.sequence||![data.x,data.y,data.z,data.dx,data.dy,data.dz,data.range].every(finite))return false;
  p.sequence=data.sequence;if(this.time-p.lastShot<w.interval-.015)return false;
  let origin={x:data.x,y:data.y,z:data.z},dir={x:data.dx,y:data.dy,z:data.dz},l=Math.hypot(dir.x,dir.y,dir.z);if(l<.98||l>1.02||Math.hypot(origin.x-p.x,origin.y-(p.y+1),origin.z-p.z)>8)return false;
  // A camera/muzzle may not originate through a wall.
  if(!this.nav.clear({x:p.x,y:p.y+1,z:p.z},origin))return false;
  p.lastShot=this.time;let range=Math.max(0,Math.min(w.range,data.range)),wall=this.nav.ray(origin,dir,range),nearest=wall,hit=null;
  for(let m of r.monsters){if(m.hp<=0||m.state==='suspended'||m.state==='dropping'||m.state==='roar')continue;let radius=m.boss?2.3:.95,centerY=m.y+(m.boss?1.5:.6),ox=origin.x-m.x,oy=origin.y-centerY,oz=origin.z-m.z,b=ox*dir.x+oy*dir.y+oz*dir.z,c=ox*ox+oy*oy+oz*oz-radius*radius,disc=b*b-c;if(disc<0)continue;let t=Math.max(0,-b-Math.sqrt(disc));if(t<nearest){nearest=t;hit=m;}}
  if(hit){hit.hp=Math.max(0,hit.hp-w.damage);if(hit.hp===0)this.state(hit,'dead');else hit.target=p.id;this.emit(p.id,'hitConfirm',{id:hit.id,damage:w.damage,hp:hit.hp});}return true;
 }
 tick(dt){this.time+=dt;for(let r of [...this.rooms.values()]){let players=this.alive(r),boss=r.monsters[0];
   if(!r.awake&&players.some(p=>Math.hypot(p.x-CAVE_X,p.z*.91)<34&&p.y>=10&&p.y<33)){r.awake=true;this.state(boss,'dropping');}
   for(let m of r.monsters){let old={x:m.x,y:m.y,z:m.z};this.updateMonster(r,m,players,dt);m.vx=(m.x-old.x)/dt;m.vy=(m.y-old.y)/dt;m.vz=(m.z-old.z)/dt;}
  }}
 updateMonster(r,m,players,dt){if(m.hp<=0||m.state==='suspended')return;
  if(m.state==='dropping'){let t=Math.min(1,(this.time-m.since)/1.5);m.y=36+(12-36)*(t*t*(3-2*t));if(t===1){m.y=12;this.state(m,'roar');}return;}
  if(m.state==='roar'){if(this.time-m.since>=2.2)this.state(m,'idle');return;}
  let target=players.filter(p=>{let d=distance(m,p);return Math.abs(p.y-this.nav.height(p.x,p.z))<4&&(!m.boss?Math.hypot(p.x-CAVE_X,p.z)<285:true)&&(r.awake||d<32);}).sort((a,b)=>distance(m,a)-distance(m,b))[0];
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
   if(!m.boss&&Math.hypot(x-CAVE_X,z)>280)break;
   if(!this.nav.walkable(x,z,m.boss)){m.waypoint=null;m.pathAt=0;break;}
   m.x=x;m.z=z;m.y=this.nav.height(x,z);heading=Math.atan2(dx,dz)*180/Math.PI;budget-=step;moved=true;
   if(step>=l-.001){m.waypoint=null;m.pathAt=0;}
  }
  if(moved){m.yaw=heading;this.state(m,m.boss&&m.hp<100?'roll':'run');}
  else if(distance(m,target)<1.5)this.state(m,'idle');
 }

 snapshot(p){let r=this.rooms.get(p.roomId);if(!r)return {serverTime:this.time,roomId:p.roomId,monsters:[]};return {serverTime:this.time,roomId:r.id,monsters:r.monsters.filter(m=>distance(m,p)<360).map(m=>({id:m.id,boss:m.boss,x:m.x,y:m.y,z:m.z,yaw:m.yaw,hp:m.hp,maxHp:m.maxHp,state:m.state,age:this.time-m.since,revision:m.revision,vx:m.vx,vy:m.vy,vz:m.vz}))};}
 sendSnapshot(p){this.emit(p.id,'monsterSnapshot',this.snapshot(p));}
}
module.exports={CombatWorld,WEAPONS};
