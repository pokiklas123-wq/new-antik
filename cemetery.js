'use strict';
// Isolated graveyard AI. Other regions retain the original combat implementation.
const {ZONES}=require('./world-layout');
const ZONE=ZONES.find(z=>z.id==='graveyard');
const CLIPS=Object.freeze({rise:3.4,scream:3,death:3.4,minionDeath:1.65,attack:1,minionAttack:.7});
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const inside=p=>Math.hypot(p.x-ZONE.x,p.z-ZONE.z)<=ZONE.radius;
const eligible=(w,p)=>p&&p.alive&&p.positioned&&inside(p)&&Math.abs(p.y-w.nav.height(p.x,p.z))<4;
const eye=p=>({x:p.x,y:p.y+1.25,z:p.z});
const yaw=p=>(Number.isFinite(p.viewYaw)?p.viewYaw:p.yaw||0)*Math.PI/180;
function init(m){if(m.zone!==ZONE.id)return;m.hp=m.maxHp=300;m.teleports=0;m.awakened=false;m.retreating=false;m.attackSerial=0;m.attackKind='claw';if(m.boss)m.state='dormant';}
function killed(w,r,m,p){
 if(m.zone!==ZONE.id||m.boss||!eligible(w,p))return;
 const b=r.monsters.find(n=>n.zone===ZONE.id&&n.boss);
 if(!b||b.hp<=0||b.awakened)return;
 b.awakened=true;b.target=p.id;b.wakeTarget=p.id;b.waypoint=null;b.patrol=null;b.pathAt=0;
 w.state(b,'rise');
}
function frontPoint(w,b,p){
 const a=yaw(p),fx=Math.sin(a),fz=Math.cos(a);
 const start=w.nav.regionNearest(p.x,p.z,ZONE,true),g=w.nav.region(ZONE,true);
 const home=w.nav.regionNearest(b.home?b.home.x:b.x,b.home?b.home.z:b.z,ZONE,true);
 if(start<0||home<0||g.labels[start]!==g.labels[home])return null;
 // Never move to the side/behind or silently snap to a distant grid cell.
 // 1.35m centre separation is very close, but avoids placing the camera inside the mesh.
 for(const d of [1.35,1.6,1.9,2.2]){
  const q={x:p.x+fx*d,z:p.z+fz*d};q.y=w.nav.height(q.x,q.z);
  const i=w.nav.index(q.x,q.z);
  if(!inside(q)||i<0||!g.allowed[i]||g.labels[i]!==g.labels[start]||!w.nav.walkable(q.x,q.z,true)||Math.abs(q.y-p.y)>1.5)continue;
  if(w.nav.clear(eye(p),eye(q)))return q;
 }
 return null;
}
function teleport(w,b,p){
 const q=frontPoint(w,b,p);if(!q)return false;
 b.x=q.x;b.y=q.y;b.z=q.z;b.yaw=Math.atan2(p.x-b.x,p.z-b.z)*180/Math.PI;
 b.teleports=1;b.waypoint=null;b.pathAt=0;b.patrol=null;
 w.state(b,'scream');return true;
}
function choose(w,m,players){
 let best=null,score=Infinity;
 for(const p of players){if(!eligible(w,p))continue;const d=dist(m,p);if(d>90&&m.target!==p.id&&!m.boss)continue;
  const a=w.nav.regionNearest(m.x,m.z,ZONE,m.boss),b=w.nav.regionNearest(p.x,p.z,ZONE,m.boss),g=w.nav.region(ZONE,m.boss);
  if(a<0||b<0||g.labels[a]!==g.labels[b])continue;
  // Low-health boss favours an exposed/weak opponent, without changing base damage.
  const s=d+(m.boss&&m.hp<100?p.hp*.08:0)-(m.target===p.id?3:0);
  if(s<score){score=s;best=p;}
 }
 return best;
}
function flank(w,m,p){
 const a=yaw(p),r=m.boss?(m.hp<100?3:3.8):3.4;
 // Stable slots, not a random side change every frame: front, rear, left and right.
 const slot=m.boss?((m.attackSerial||0)%2?Math.PI/2:-Math.PI/2):((m.id%4)*Math.PI/2);
 const lead=m.boss&&m.hp<100?.25:0;
 const q={x:p.x+Math.sin(a+slot)*r+Math.sin(p.yaw*Math.PI/180)*(p.speed||0)*lead,z:p.z+Math.cos(a+slot)*r+Math.cos(p.yaw*Math.PI/180)*(p.speed||0)*lead};q.y=w.nav.height(q.x,q.z);
 const i=w.nav.index(q.x,q.z),g=w.nav.region(ZONE,m.boss),start=w.nav.regionNearest(m.x,m.z,ZONE,m.boss);
 return inside(q)&&i>=0&&g.allowed[i]&&start>=0&&g.labels[i]===g.labels[start]?q:p;
}
function projectile(w,r,m,p){
 if(!r.cemeteryProjectiles)r.cemeteryProjectiles=[];
 const o=eye(m),end=eye(p),dx=end.x-o.x,dy=end.y-o.y,dz=end.z-o.z,l=Math.hypot(dx,dy,dz);
 if(l<.01)return;
 const speed=m.boss?15:22;
 r.cemeteryProjectiles.push({id:(r.cemeteryProjectileSerial=(r.cemeteryProjectileSerial||0)+1),owner:m.id,boss:m.boss,x:o.x,y:o.y,z:o.z,dx:dx/l,dy:dy/l,dz:dz/l,speed,remaining:m.boss?24:20,damage:m.boss?12:6});
}
function retreat(w,m,dt){
 if(!m.retreating){m.retreating=true;m.waypoint=null;m.pathAt=0;m.patrol=null;}
 m.target=null;m.hitDone=true;
 // Run home at the existing pursuit speed, not the slow idle patrol speed.
 if(dist(m,m.home)>.4){w.moveMonster(m,m.home,m.boss?13:12,dt,true,.25);w.state(m,'return');}
 else{m.retreating=false;m.waypoint=null;m.pathAt=0;w.patrolMonster(m,ZONE,dt);}
}
function update(w,r,m,players,dt){
 if(m.hp<=0)return;
 if(m.boss&&!m.awakened)return;
 if(m.state==='rise'){
  if(w.time-m.since>=CLIPS.rise){
   const p=w.players.get(m.wakeTarget);
   if(eligible(w,p))teleport(w,m,p);
   else {const other=choose(w,m,players);if(other){m.wakeTarget=other.id;teleport(w,m,other);}}
  }
  return;
 }
 if(m.state==='scream'){if(w.time-m.since>=CLIPS.scream)w.state(m,'idle');return;}
 // If blocked by a wall during the first reveal, retry only directly in front.
 // No additional teleports after the first successful reveal, including re-entry.
 if(m.boss&&!m.teleports){const p=choose(w,m,players);if(p){m.target=p.id;teleport(w,m,p);}return;}
 const p=choose(w,m,players);
 if(!p){if(m.target!==null||m.retreating)retreat(w,m,dt);else w.patrolMonster(m,ZONE,dt);return;}
 if(m.retreating||m.target!==p.id){m.waypoint=null;m.pathAt=0;m.patrol=null;}
 m.retreating=false;
 if(m.state==='attack'){
  const victim=w.players.get(m.target),valid=eligible(w,victim)&&Math.abs(victim.y-m.y)<4;
  if(!valid){w.state(m,'return');retreat(w,m,dt);return;}
  m.yaw=Math.atan2(victim.x-m.x,victim.z-m.z)*180/Math.PI;
  if(m.attackKind==='claw')w.moveMonster(m,victim,m.boss?(m.hp<100?14.5:13):12,dt,true,m.boss?2:1.25);
  if(!m.hitDone&&w.time-m.since>=(m.boss?.58:.32)){
   m.hitDone=true;
   if(w.nav.clear(eye(m),eye(victim))){
    if(m.attackKind==='orb'||m.attackKind==='arrow')projectile(w,r,m,victim);
    else if(dist(m,victim)<=(m.boss?5:2.1))w.damage(victim,m.boss?12:6);
   }
  }
  if(w.time-m.since>=(m.boss?CLIPS.attack:CLIPS.minionAttack))w.state(m,'run');
  return;
 }
 m.target=p.id;
 const d=dist(m,p),range=m.boss?5:2.1;
 const ranged=m.boss?(d>range&&d<=18):d>6&&d<=16;
 if((d<=range||ranged)&&w.time>=m.attackAt&&w.nav.clear(eye(m),eye(p))){
  m.attackKind=ranged?(m.boss?'orb':'arrow'):'claw';m.attackSerial++;
  m.attackAt=w.time+(m.boss?1.55:1.15);m.hitDone=false;
  m.yaw=Math.atan2(p.x-m.x,p.z-m.z)*180/Math.PI;
  w.state(m,'attack');return;
 }
 // Direct chase when far away; coordinated flank/rear slots during approach/recovery.
 const goal=d>20?p:flank(w,m,p);
 const before={x:m.x,z:m.z};
 w.moveMonster(m,goal,m.boss?(m.hp<100?14.5:13):12,dt,true,d>20?range*.6:.4);
 if(dist(m,before)>.001)w.state(m,'run');
 else if(d>range){m.waypoint=null;m.pathAt=0;w.moveMonster(m,p,m.boss?(m.hp<100?14.5:13):12,dt,true,range*.6);w.state(m,'run');}
 else w.state(m,'idle');
}
function tickProjectiles(w,r,dt){
 if(!r.cemeteryProjectiles)return;
 r.cemeteryProjectiles=r.cemeteryProjectiles.filter(b=>{
  const step=Math.min(b.remaining,b.speed*dt),end={x:b.x+b.dx*step,y:b.y+b.dy*step,z:b.z+b.dz*step};
  let wall=w.nav.ray(b,{x:b.dx,y:b.dy,z:b.dz},step),nearest=wall,victim=null;
  for(const p of r.players.values()){
   if(!eligible(w,p))continue;
   const height=p.prone?.55:p.crouched?1.12:1.78,rad=b.boss?.25:.10;
   // Swept projectile versus expanded upright player capsule; cannot tunnel at 20Hz.
   for(const cy of [p.y+height*.25,p.y+height*.5,p.y+height*.75]){
    const ox=b.x-p.x,oy=b.y-cy,oz=b.z-p.z,radius=(p.prone?.5:.43)+rad;
    const dot=ox*b.dx+oy*b.dy+oz*b.dz,c=ox*ox+oy*oy+oz*oz-radius*radius,disc=dot*dot-c;
    if(disc<0)continue;const t=c<=0?0:-dot-Math.sqrt(disc);if(t<0)continue;
    if(t<=step&&t<nearest){nearest=t;victim=p;}
   }
  }
  if(victim){w.damage(victim,b.damage);return false;}
  if(wall<step-.001)return false;
  Object.assign(b,end);b.remaining-=step;return b.remaining>.001&&inside(b);
 });
}
// Humanoid hurt volumes replace the old low spider sphere in this region only.
function rayHit(m,o,d){
 const radius=m.boss?1:.48,height=m.boss?3.8:2.2,y0=m.y+radius,y1=m.y+height-radius;
 const ox=o.x-m.x,oz=o.z-m.z,A=d.x*d.x+d.z*d.z,B=ox*d.x+oz*d.z,C=ox*ox+oz*oz-radius*radius;
 let nearest=Infinity;
 if(C<=0&&o.y>=y0&&o.y<=y1)nearest=0;
 if(A>1e-9){const D=B*B-A*C;if(D>=0)for(const t of [(-B-Math.sqrt(D))/A,(-B+Math.sqrt(D))/A]){const y=o.y+t*d.y;if(t>=0&&y>=y0&&y<=y1)nearest=Math.min(nearest,t);}}
 for(const cy of [y0,y1]){const oy=o.y-cy,b=B+oy*d.y,c=C+oy*oy,disc=b*b-c;if(c<=0)nearest=0;else if(disc>=0){const t=-b-Math.sqrt(disc);if(t>=0)nearest=Math.min(nearest,t);}}
 return nearest;
}
function snapshot(r,p){return (r.cemeteryProjectiles||[]).filter(b=>dist(b,p)<80).map(b=>({id:b.id,boss:b.boss,x:b.x,y:b.y,z:b.z,dx:b.dx,dy:b.dy,dz:b.dz,speed:b.speed}));}
module.exports={init,killed,update,tickProjectiles,snapshot,frontPoint,eligible,rayHit,CLIPS};
