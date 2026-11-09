'use strict';
const fs=require('node:fs'),path=require('node:path');
const VERSION='herb-grid-1800-v1',MIN=-278,SIDE=556,STEP=1.8,DURATION=1.5;
function hash(x,z,s){let h=Math.imul(x,73856093)^Math.imul(z,19349663)^Math.imul(s,83492791);h^=h>>>13;h=Math.imul(h,1274126177);return (h^(h>>>16))|0;}
const mod=(a,b)=>((a%b)+b)%b;
const point=(gx,gz)=>({x:(gx*1800+900+mod(hash(gx,gz,1),201)-100)/1000,z:(gz*1800+900+mod(hash(gx,gz,2),201)-100)/1000});
const id=(gx,gz)=>(gz-MIN)*SIDE+(gx-MIN);
function height(gx,gz){const p=point(gx,gz);if(Math.hypot(p.x+85,p.z+315)>=130)return .2;const v=(hash(gx,gz,3)&65535)/65535;return v<.28?.35+v*1.5:1.6+(hash(gx,gz,4)&65535)/65535*1.2;}
let shared;
function manifest(){if(shared)return shared;const d=JSON.parse(fs.readFileSync(path.join(__dirname,'vegetation.json'),'utf8'));
 if(d.version!==VERSION||d.min!==MIN||d.side!==SIDE||d.allowed.length!==SIDE*SIDE||!/^[01]+$/.test(d.allowed)||d.baseY.length!==SIDE*SIDE||d.trees.length!==140)throw Error('Vegetation manifest mismatch');return shared=d;}
class GrassWorld{
 constructor(nav,data=manifest()){this.nav=nav;this.data=data;this.active=new Map();this.actors=new Map();}
 removeActor(key){this.actors.delete(key);}
 actor(key,p,radius,now){
  if(!p||!Number.isFinite(p.x+p.y+p.z))return;
  const old=this.actors.get(key);this.actors.set(key,{x:p.x,y:p.y,z:p.z});
  if(old&&Math.hypot(p.x-old.x,p.y-old.y,p.z-old.z)<.015)return;
  const previous=old||p,len=Math.hypot(p.x-previous.x,p.z-previous.z);
  // No infinite sweep or fake teleport can generate unbounded work.
  if(len>90)return;const steps=Math.max(1,Math.ceil(len/.65));
  for(let n=0;n<=steps;n++){
   const f=n/steps,x=previous.x+(p.x-previous.x)*f,z=previous.z+(p.z-previous.z)*f,y=previous.y+(p.y-previous.y)*f;
   const gx=Math.floor(x/STEP),gz=Math.floor(z/STEP),reach=radius+.38,cells=Math.ceil((reach+.11)/STEP);
   for(let iz=gz-cells;iz<=gz+cells;iz++)for(let ix=gx-cells;ix<=gx+cells;ix++){
    if(ix<MIN||iz<MIN||ix>=MIN+SIDE||iz>=MIN+SIDE)continue;
    const i=id(ix,iz);if(this.data.allowed[i]!=='1')continue;const q=point(ix,iz);if((q.x-x)**2+(q.z-z)**2>reach*reach)continue;
    const base=this.data.baseY[i];if(y<base-.6||y>base+height(ix,iz))continue;
    const last=this.active.get(i);if(last!==undefined&&now-last<DURATION)continue;
    this.active.set(i,now);
   }
  }
 }
 prune(now){for(const [i,start] of this.active)if(now-start>DURATION+.2)this.active.delete(i);}
 snapshot(p,now){const grass=[];for(const [i,start] of this.active){if(now-start>DURATION+.15)continue;const q=point(i%SIDE+MIN,Math.floor(i/SIDE)+MIN);if((q.x-p.x)**2+(q.z-p.z)**2<85*85)grass.push({id:i,start});}return grass;}
}
module.exports={GrassWorld,VERSION,MIN,SIDE,STEP,DURATION,hash,point,id,height,manifest};
