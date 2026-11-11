'use strict';
// Forest-only anaconda encounter. No roll, poison ticks or spider behaviours.
const {ZONES}=require('./world-layout');
const ZONE=ZONES.find(z=>z.id==='forest');
const CLIPS=Object.freeze({attack:2,hit:.8,minionDeath:3,bossDeath:3});
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const inside=p=>Math.hypot(p.x-ZONE.x,p.z-ZONE.z)<=ZONE.radius;
const eligible=(w,p)=>p&&p.alive&&p.positioned&&inside(p)&&Math.abs(p.y-w.nav.height(p.x,p.z))<4;
const eye=p=>({x:p.x,y:p.y+.7,z:p.z});
const damage=m=>m.boss?(m.hp<100?12:10):7;
const speed=m=>m.boss?(m.hp<100?15:13):11;
function choose(w,m,players){
 let best=null,score=Infinity;
 const g=w.nav.region(ZONE,m.boss),a=w.nav.regionNearest(m.x,m.z,ZONE,m.boss);
 for(const p of players){
  if(!eligible(w,p))continue;
  const d=dist(m,p);if(d>90&&m.target!==p.id)continue;
  const b=w.nav.regionNearest(p.x,p.z,ZONE,m.boss);
  if(a<0||b<0||g.labels[a]!==g.labels[b])continue;
  const s=d-(m.target===p.id?5:0);
  if(s<score){best=p;score=s;}
 }
 return best;
}
function approach(w,r,m,p){
 // Stable encirclement slots and a short movement lead; never all chase one point.
 const d=dist(m,p);if(d>26)return p;
 const a=(m.id%8)*Math.PI/4,rad=m.boss?3.8:2.5;
 const lead=Math.min(.3,d/60),heading=(p.yaw||0)*Math.PI/180;
 let x=p.x+Math.sin(a)*rad+Math.sin(heading)*(p.speed||0)*lead;
 let z=p.z+Math.cos(a)*rad+Math.cos(heading)*(p.speed||0)*lead;
 let sx=0,sz=0;
 for(const other of r.monsters){
  if(other===m||other.zone!==ZONE.id||other.hp<=0)continue;
  const dx=m.x-other.x,dz=m.z-other.z,l=Math.hypot(dx,dz);
  if(l>0&&l<3){sx+=dx/l*(3-l);sz+=dz/l*(3-l);}
 }
 const l=Math.hypot(sx,sz);if(l>0){x+=sx/l*Math.min(1.4,l);z+=sz/l*Math.min(1.4,l);}
 const i=w.nav.index(x,z),g=w.nav.region(ZONE,m.boss),start=w.nav.regionNearest(m.x,m.z,ZONE,m.boss);
 if(!inside({x,z})||i<0||!g.allowed[i]||start<0||g.labels[i]!==g.labels[start])return p;
 return {x,z,y:w.nav.height(x,z)};
}
function update(w,r,m,players,dt){
 if(m.hp<=0)return;
 const p=choose(w,m,players),range=m.boss?5:2.6;
 if(m.state==='attack'){
  const victim=w.players.get(m.target),valid=eligible(w,victim)&&Math.abs(victim.y-m.y)<3;
  if(!valid){m.target=null;m.waypoint=null;m.pathAt=0;w.state(m,'run');return;}
  w.moveMonster(m,victim,speed(m),dt,true,range*.65);
  m.yaw=Math.atan2(victim.x-m.x,victim.z-m.z)*180/Math.PI;
  if(!m.hitDone&&w.time-m.since>=CLIPS.hit){
   m.hitDone=true;
   if(dist(m,victim)<=range&&w.nav.clear(eye(m),eye(victim)))w.damage(victim,damage(m));
  }
  if(w.time-m.since>=CLIPS.attack)w.state(m,'run');
  return;
 }
 if(!p){
  if(m.target!==null){m.target=null;m.waypoint=null;m.pathAt=0;m.patrol=null;}
  // Existing per-ID region-bounded routes spread all nineteen minions across the forest.
  w.patrolMonster(m,ZONE,dt);return;
 }
 if(m.target!==p.id){m.target=p.id;m.waypoint=null;m.pathAt=0;}
 m.patrol=null;
 if(dist(m,p)<=range&&w.time>=m.attackAt&&w.nav.clear(eye(m),eye(p))){
  m.hitDone=false;m.attackAt=w.time+(m.boss?2.6:2.35);
  m.yaw=Math.atan2(p.x-m.x,p.z-m.z)*180/Math.PI;w.state(m,'attack');return;
 }
 const goal=approach(w,r,m,p),before={x:m.x,z:m.z};
 w.moveMonster(m,goal,speed(m),dt,true,goal===p?range*.65:.3);
 // A blocked flank must not become a permanent stationary obstacle.
 if(dist(m,before)<.001&&dist(m,p)>range){m.waypoint=null;m.pathAt=0;w.moveMonster(m,p,speed(m),dt,true,range*.65);}
 w.state(m,dist(m,before)>.001?'run':'idle');
}
// Five overlapping volumes follow the long body, instead of a spider-sized hit sphere.
function rayHit(m,o,d){
 const a=(m.yaw||0)*Math.PI/180,half=m.boss?3.2:1.5,radius=m.boss?1:.5;
 let nearest=Infinity;
 for(let i=0;i<5;i++){
  const along=-half+2*half*i/4,cx=m.x+Math.sin(a)*along,cz=m.z+Math.cos(a)*along;
  const ox=o.x-cx,oy=o.y-(m.y+radius),oz=o.z-cz;
  const b=ox*d.x+oy*d.y+oz*d.z,c=ox*ox+oy*oy+oz*oz-radius*radius,disc=b*b-c;
  if(c<=0)nearest=0;else if(disc>=0){const t=-b-Math.sqrt(disc);if(t>=0)nearest=Math.min(nearest,t);}
 }
 return nearest;
}
module.exports={update,eligible,approach,damage,rayHit,CLIPS};
