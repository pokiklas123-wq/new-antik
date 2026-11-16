'use strict';
// Metres. These integer hashes and coordinates are mirrored by DominationMap.java.
const HALF=250,LAYOUT='domination-500-v1',SIGNATURE='domination-flat-forest-73917-v1';
function hash(x,z,s){let h=(Math.imul(x,374761393)+Math.imul(z,668265263)+Math.imul(s,1442695041))|0;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))&0x7fffffff)/2147483647;}
const marshes=[];
for(let z=-2;z<=2;z++)for(let x=-2;x<=2;x++)if(hash(x,z,901)>.32)marshes.push({x:x*88+(hash(x,z,902)-.5)*22,z:z*88+(hash(x,z,903)-.5)*22,r:2+hash(x,z,904)*3});
function wet(x,z){return marshes.some(p=>(x-p.x)**2+(z-p.z)**2<p.r*p.r);}
const trees=[];
for(let z=-25;z<25;z++)for(let x=-25;x<25;x++){
 const tx=x*10+2+hash(x,z,41)*6,tz=z*10+2+hash(x,z,42)*6;
 // Broad natural clearings, never roads, buildings, monsters or props.
 const field=Math.sin(tx*.021)*Math.cos(tz*.024)>.56;
 if(hash(x,z,43)<(field?.93:.24)||wet(tx,tz))continue;
 trees.push({x:tx,z:tz,w:1.0,h:8+hash(x,z,44)*5});
}
class DominationNavigation{
 constructor(){this.data={layout:LAYOUT,terrainSignature:SIGNATURE,halfSize:HALF,seed:73917};this.buckets=new Map();for(const t of trees){let k=Math.floor(t.x/10)+','+Math.floor(t.z/10);this.buckets.set(k,t);}}
 height(){return 0;}
 nearby(x,z){let out=[];for(let iz=-1;iz<=1;iz++)for(let ix=-1;ix<=1;ix++){const t=this.buckets.get((Math.floor(x/10)+ix)+','+(Math.floor(z/10)+iz));if(t)out.push(t);}return out;}
 walkable(x,z){return Number.isFinite(x)&&Number.isFinite(z)&&Math.abs(x)<HALF-.6&&Math.abs(z)<HALF-.6&&!this.nearby(x,z).some(t=>Math.hypot(t.x-x,t.z-z)<.95);}
 ray(o,d,range){
  let best=range;
  for(const axis of ['x','z'])if(Math.abs(d[axis])>1e-10){const boundary=Math.sign(d[axis])*(HALF-.31),t=(boundary-o[axis])/d[axis];if(t>=0)best=Math.min(best,t);}
  if(d.y<0){let t=-o.y/d.y;if(t>=0)best=Math.min(best,t);}
  // Sampling buckets along the ray avoids checking all trees per shot/AI query.
  const seen=new Set();
  for(let s=0;s<=range+5;s+=5){let x=o.x+d.x*Math.min(s,range),z=o.z+d.z*Math.min(s,range);for(const t of this.nearby(x,z)){
   if(seen.has(t))continue;seen.add(t);
   let ax=o.x-t.x,az=o.z-t.z,A=d.x*d.x+d.z*d.z,B=ax*d.x+az*d.z,C=ax*ax+az*az-.5*.5,D=B*B-A*C;
   if(A<1e-10||D<0)continue;
   const a=(-B-Math.sqrt(D))/A,b=(-B+Math.sqrt(D))/A;
   for(const hit of [a,b])if(hit>=0&&hit<best&&o.y+d.y*hit>=0&&o.y+d.y*hit<=t.h*.82)best=hit;
  }}return best;
 }
 clear(a,b){let dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,l=Math.hypot(dx,dy,dz);return l<.0001||this.ray(a,{x:dx/l,y:dy/l,z:dz/l},l)>=l-.015;}
}
module.exports={HALF,LAYOUT,SIGNATURE,hash,marshes,trees,wet,DominationNavigation};
