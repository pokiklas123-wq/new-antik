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

function init(m){
 if(m.zone!==ZONE.id)return;
 // 🟢 التعديل: الزعيم 300 دم، والتابعين 60 دم
 m.hp=m.maxHp=m.boss?300:60; 
 m.teleports=0;m.awakened=false;m.retreating=false;m.attackSerial=0;m.attackKind='claw';
 if(m.boss){m.state='idle';m.yaw=180;}
}

// Kills no longer trigger a reveal or any instantaneous relocation.
function killed(){}
function choose(w,m,players){
 let best=null,score=Infinity;
 for(const p of players){if(!eligible(w,p))continue;const d=dist(m,p);if(m.boss&&!m.awakened&&d>90)continue;if(d>90&&m.target!==p.id&&!m.boss)continue;
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
 if(dist(m,m.home)>.25){w.moveMonster(m,m.home,m.boss?18:12,dt,true,.1);w.state(m,'return');}
 else{
  m.retreating=false;m.waypoint=null;m.pathAt=0;
  if(m.boss){
   // A failed encounter resets only after walking all the way home. Cannot chip
   // HP safely from outside the cemetery or snipe an invulnerable returning boss.
   m.hp=m.maxHp;m.awakened=false;m.yaw=180;w.state(m,'idle');
  }else w.patrolMonster(m,ZONE,dt);
 }
}
function update(w,r,m,players,dt){
 if(m.hp<=0)return;
 if(m.boss){
  if(m.retreating){retreat(w,m,dt);return;}
  if(!m.awakened){
   const intruder=choose(w,m,players);
   if(!intruder||dist(m,intruder)>90){w.state(m,'idle');return;}
   m.awakened=true;m.target=intruder.id;m.waypoint=null;m.pathAt=0;m.patrol=null;
  }else if(!eligible(w,w.players.get(m.target))){
   retreat(w,m,dt);return;
  }
 }

 const p=choose(w,m,players);
 if(!p){if(m.boss||m.target!==null||m.retreating)retreat(w,m,dt);else w.patrolMonster(m,ZONE,dt);return;}
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
module.exports={init,killed,update,tickProjectiles,snapshot,eligible,rayHit,CLIPS};
