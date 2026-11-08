'use strict';
const fs=require('node:fs');
class Navigation{
 constructor(file){
  if(!fs.existsSync(file))throw Error('Missing world-nav.json. Use the matching file included with this server, or run the supplied Java exporter.');
  const d=JSON.parse(fs.readFileSync(file,'utf8'));this.data=d;this.cells=new Map();this.fields=new Map();
  if(!Number.isInteger(d.n)||d.n<2||d.n>2048||!Number.isFinite(d.step)||d.step<=0||!Number.isFinite(d.minX)||!Number.isFinite(d.minZ)||d.heights?.length!==d.n*d.n||d.small?.length!==d.n*d.n||d.boss?.length!==d.n*d.n||!Array.isArray(d.triangles))throw Error('Invalid navigation dimensions/masks');
  if(!d.heights.every(Number.isFinite)||!/^[01]+$/.test(d.small)||!/^[01]+$/.test(d.boss))throw Error('Invalid navigation values');
  d.heights=Float32Array.from(d.heights);this.queue=new Int32Array(d.n*d.n);
  this.triangles=new Float32Array(d.triangles.length*9);
  for(let i=0;i<d.triangles.length;i++){
   const t=d.triangles[i];if(!Array.isArray(t)||t.length!==9||!t.every(Number.isFinite))throw Error('Invalid collision triangle '+i);
   const offset=i*9;this.triangles.set(t,offset);
   let x0=Math.floor(Math.min(t[0],t[3],t[6])/16),x1=Math.floor(Math.max(t[0],t[3],t[6])/16),z0=Math.floor(Math.min(t[2],t[5],t[8])/16),z1=Math.floor(Math.max(t[2],t[5],t[8])/16);
   if((x1-x0+1)*(z1-z0+1)>4096)throw Error('Oversized collision triangle');
   for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){let k=x+','+z;if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k).push(offset);}
  }
  // Drop the enormous parsed number-array graph after compacting it.
  delete d.triangles;
 }
 index(x,z){let d=this.data,ix=Math.round((x-d.minX)/d.step),iz=Math.round((z-d.minZ)/d.step);return ix<0||iz<0||ix>=d.n||iz>=d.n?-1:iz*d.n+ix;}
 point(i){let d=this.data;return {x:d.minX+(i%d.n)*d.step,z:d.minZ+Math.floor(i/d.n)*d.step,y:d.heights[i]};}
 mask(boss){return boss?this.data.boss:this.data.small;}
 nearest(x,z,boss){let d=this.data,ix=Math.max(0,Math.min(d.n-1,Math.round((x-d.minX)/d.step))),iz=Math.max(0,Math.min(d.n-1,Math.round((z-d.minZ)/d.step))),mask=this.mask(boss);for(let r=0;r<32;r++)for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){if(r&&Math.abs(dx)!==r&&Math.abs(dz)!==r)continue;let xx=ix+dx,zz=iz+dz,i=zz*d.n+xx;if(xx>=0&&zz>=0&&xx<d.n&&zz<d.n&&mask[i]==='1')return i;}return -1;}
 height(x,z){let d=this.data,u=(x-d.minX)/d.step,v=(z-d.minZ)/d.step,ix=Math.floor(u),iz=Math.floor(v);if(ix<0||iz<0||ix>=d.n-1||iz>=d.n-1)return 12;u-=ix;v-=iz;let i=iz*d.n+ix,a=d.heights[i],b=d.heights[i+1],c=d.heights[i+d.n],e=d.heights[i+d.n+1];return u+v<=1?a+(b-a)*u+(c-a)*v:e+(c-e)*(1-u)+(b-e)*(1-v);}
 walkable(x,z,boss){let i=this.index(x,z);return i>=0&&this.mask(boss)[i]==='1';}
 // Navigation is immutable: a reverse field is valid until its goal changes, not for just 1s.
 // LRU is bounded. Neighbour iteration creates no per-cell arrays; queue is reused.
 next(x,z,tx,tz,boss,now){
  let start=this.nearest(x,z,boss),goal=this.nearest(tx,tz,boss);if(start<0||goal<0)return null;if(start===goal)return this.point(goal);
  let key=goal+':'+boss,entry=this.fields.get(key),d=this.data;
  if(entry){this.fields.delete(key);this.fields.set(key,entry);}
  else{
   if(this.fields.size>=20)this.fields.delete(this.fields.keys().next().value);
   let dist=new Int32Array(d.n*d.n);dist.fill(-1);let q=this.queue;if(!q||q.length!==dist.length)q=this.queue=new Int32Array(dist.length);
   let a=0,b=1;q[0]=goal;dist[goal]=0;let mask=this.mask(boss);
   while(a<b){let i=q[a++],xx=i%d.n;
    for(let edge=0;edge<4;edge++){
     let j=edge===0?(xx>0?i-1:-1):edge===1?(xx<d.n-1?i+1:-1):edge===2?i-d.n:i+d.n;
     if(j>=0&&j<dist.length&&dist[j]<0&&mask[j]==='1'){dist[j]=dist[i]+1;q[b++]=j;}
    }
   }
   entry={time:now,dist};this.fields.set(key,entry);
  }
  let best=start,xx=start%d.n;for(let edge=0;edge<4;edge++){
   let j=edge===0?(xx>0?start-1:-1):edge===1?(xx<d.n-1?start+1:-1):edge===2?start-d.n:start+d.n;
   if(j>=0&&j<entry.dist.length&&entry.dist[j]>=0&&(entry.dist[best]<0||entry.dist[j]<entry.dist[best]))best=j;
  }
  return entry.dist[best]<0?null:this.point(best);
 }
 terrainRay(o,dir,range){
  const d=this.data,h=d.heights,s=d.step;let ix=Math.floor((o.x-d.minX)/s),iz=Math.floor((o.z-d.minZ)/s),best=range;
  const sx=Math.sign(dir.x),sz=Math.sign(dir.z),dx=sx?s/Math.abs(dir.x):Infinity,dz=sz?s/Math.abs(dir.z):Infinity;
  let tx=sx?(d.minX+(ix+(sx>0?1:0))*s-o.x)/dir.x:Infinity,tz=sz?(d.minZ+(iz+(sz>0?1:0))*s-o.z)/dir.z:Infinity;
  const t=new Float32Array(9),maxSteps=Math.min(10000,Math.ceil(range*(Math.abs(dir.x)+Math.abs(dir.z))/s)+3);
  for(let k=0;k<maxSteps;k++){
   if(ix>=0&&iz>=0&&ix<d.n-1&&iz<d.n-1){let i=iz*d.n+ix,x=d.minX+ix*s,z=d.minZ+iz*s;
    t.set([x,h[i],z,x,h[i+d.n],z+s,x+s,h[i+1],z]);let a=rayTriangle(o,dir,t);if(a!==null&&a>=.03)best=Math.min(best,a);
    t.set([x+s,h[i+1],z,x,h[i+d.n],z+s,x+s,h[i+d.n+1],z+s]);let b=rayTriangle(o,dir,t);if(b!==null&&b>=.03)best=Math.min(best,b);
   }
   const next=Math.min(tx,tz);if(next>best||next===Infinity)break;
   if(tx<tz){ix+=sx;tx+=dx;}else if(tz<tx){iz+=sz;tz+=dz;}else{ix+=sx;iz+=sz;tx+=dx;tz+=dz;}
  }
  return best;
 }
 ray(origin,dir,range){let end=this.data.format>=2?this.terrainRay(origin,dir,range):range,seen=new Set();let steps=Math.ceil(end/8);for(let k=0;k<=steps;k++){let t=Math.min(end,k*8),x=origin.x+dir.x*t,z=origin.z+dir.z*t;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){let list=this.cells.get((Math.floor(x/16)+dx)+','+(Math.floor(z/16)+dz));if(!list)continue;for(const offset of list)if(!seen.has(offset)){seen.add(offset);let h=rayTriangle(origin,dir,this.triangles,offset);if(h!==null&&h>=.03)end=Math.min(end,h);}}if(t>end+16)break;}return end;}
 clear(a,b){let x=b.x-a.x,y=b.y-a.y,z=b.z-a.z,l=Math.hypot(x,y,z);return l<.01||this.ray(a,{x:x/l,y:y/l,z:z/l},l)>l-.15;}
}
function rayTriangle(o,d,t,k=0){let ax=t[k+3]-t[k],ay=t[k+4]-t[k+1],az=t[k+5]-t[k+2],bx=t[k+6]-t[k],by=t[k+7]-t[k+1],bz=t[k+8]-t[k+2],px=d.y*bz-d.z*by,py=d.z*bx-d.x*bz,pz=d.x*by-d.y*bx,det=ax*px+ay*py+az*pz;if(Math.abs(det)<1e-8)return null;let inv=1/det,tx=o.x-t[k],ty=o.y-t[k+1],tz=o.z-t[k+2],u=(tx*px+ty*py+tz*pz)*inv;if(u<0||u>1)return null;let qx=ty*az-tz*ay,qy=tz*ax-tx*az,qz=tx*ay-ty*ax,v=(d.x*qx+d.y*qy+d.z*qz)*inv;if(v<0||u+v>1)return null;let h=(bx*qx+by*qy+bz*qz)*inv;return h>=0?h:null;}
module.exports={Navigation,rayTriangle};
