'use strict';
const fs=require('node:fs');
class Navigation{
 constructor(file){this.data=JSON.parse(fs.readFileSync(file,'utf8'));this.cells=new Map();this.fields=new Map();
  for(const t of this.data.triangles){let x0=Math.floor(Math.min(t[0],t[3],t[6])/16),x1=Math.floor(Math.max(t[0],t[3],t[6])/16),z0=Math.floor(Math.min(t[2],t[5],t[8])/16),z1=Math.floor(Math.max(t[2],t[5],t[8])/16);
   for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){let k=x+','+z;if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k).push(t);}}
 }
 index(x,z){let d=this.data,ix=Math.round((x-d.minX)/d.step),iz=Math.round((z-d.minZ)/d.step);return ix<0||iz<0||ix>=d.n||iz>=d.n?-1:iz*d.n+ix;}
 point(i){let d=this.data;return {x:d.minX+(i%d.n)*d.step,z:d.minZ+Math.floor(i/d.n)*d.step,y:d.heights[i]};}
 mask(boss){return boss?this.data.boss:this.data.small;}
 nearest(x,z,boss){let d=this.data,ix=Math.max(0,Math.min(d.n-1,Math.round((x-d.minX)/d.step))),iz=Math.max(0,Math.min(d.n-1,Math.round((z-d.minZ)/d.step))),mask=this.mask(boss);for(let r=0;r<32;r++)for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){if(r&&Math.abs(dx)!==r&&Math.abs(dz)!==r)continue;let xx=ix+dx,zz=iz+dz,i=zz*d.n+xx;if(xx>=0&&zz>=0&&xx<d.n&&zz<d.n&&mask[i]==='1')return i;}return -1;}
 height(x,z){let d=this.data,u=(x-d.minX)/d.step,v=(z-d.minZ)/d.step,ix=Math.floor(u),iz=Math.floor(v);if(ix<0||iz<0||ix>=d.n-1||iz>=d.n-1)return 12;u-=ix;v-=iz;let i=iz*d.n+ix,a=d.heights[i],b=d.heights[i+1],c=d.heights[i+d.n],e=d.heights[i+d.n+1];return u+v<=1?a+(b-a)*u+(c-a)*v:e+(c-e)*(1-u)+(b-e)*(1-v);}
 walkable(x,z,boss){let i=this.index(x,z);return i>=0&&this.mask(boss)[i]==='1';}
 // Shared reverse BFS fields: at most one per target cell and monster-size mask.
 next(x,z,tx,tz,boss,now){let start=this.nearest(x,z,boss),goal=this.nearest(tx,tz,boss);if(start<0||goal<0)return null;if(start===goal)return this.point(goal);let key=goal+':'+boss,entry=this.fields.get(key),d=this.data;
  if(!entry||now-entry.time>1){let dist=new Int32Array(d.n*d.n);dist.fill(-1);let q=new Int32Array(dist.length),a=0,b=1;q[0]=goal;dist[goal]=0;let mask=this.mask(boss);
   while(a<b){let i=q[a++],xx=i%d.n;for(const j of [xx>0?i-1:-1,xx<d.n-1?i+1:-1,i-d.n,i+d.n])if(j>=0&&j<dist.length&&dist[j]<0&&mask[j]==='1'){dist[j]=dist[i]+1;q[b++]=j;}}
   entry={time:now,dist};this.fields.set(key,entry);if(this.fields.size>20){for(const [k,e] of this.fields)if(now-e.time>1)this.fields.delete(k);while(this.fields.size>20)this.fields.delete(this.fields.keys().next().value);}}
  let best=start;for(const j of [start%d.n>0?start-1:-1,start%d.n<d.n-1?start+1:-1,start-d.n,start+d.n])if(j>=0&&j<entry.dist.length&&entry.dist[j]>=0&&(entry.dist[best]<0||entry.dist[j]<entry.dist[best]))best=j;
  return entry.dist[best]<0?null:this.point(best);
 }
 ray(origin,dir,range){let end=range,seen=new Set();let steps=Math.ceil(range/8);for(let k=0;k<=steps;k++){let t=Math.min(range,k*8),x=origin.x+dir.x*t,z=origin.z+dir.z*t;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){let list=this.cells.get((Math.floor(x/16)+dx)+','+(Math.floor(z/16)+dz));if(!list)continue;for(const tri of list)if(!seen.has(tri)){seen.add(tri);let h=rayTriangle(origin,dir,tri);if(h!==null&&h>=.03)end=Math.min(end,h);}}if(t>end+16)break;}return end;}
 clear(a,b){let x=b.x-a.x,y=b.y-a.y,z=b.z-a.z,l=Math.hypot(x,y,z);return l<.01||this.ray(a,{x:x/l,y:y/l,z:z/l},l)>l-.15;}
}
function rayTriangle(o,d,t){let ax=t[3]-t[0],ay=t[4]-t[1],az=t[5]-t[2],bx=t[6]-t[0],by=t[7]-t[1],bz=t[8]-t[2],px=d.y*bz-d.z*by,py=d.z*bx-d.x*bz,pz=d.x*by-d.y*bx,det=ax*px+ay*py+az*pz;if(Math.abs(det)<1e-8)return null;let inv=1/det,tx=o.x-t[0],ty=o.y-t[1],tz=o.z-t[2],u=(tx*px+ty*py+tz*pz)*inv;if(u<0||u>1)return null;let qx=ty*az-tz*ay,qy=tz*ax-tx*az,qz=tx*ay-ty*ax,v=(d.x*qx+d.y*qy+d.z*qz)*inv;if(v<0||u+v>1)return null;let h=(bx*qx+by*qy+bz*qz)*inv;return h>=0?h:null;}
module.exports={Navigation,rayTriangle};
