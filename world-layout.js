'use strict';
const HALF_SIZE=500,CAVE_X=265,CAVE_Z=0,MAX_PLAYERS=20,VERSION='dark-survival-1000-v1',MONSTER_COUNT=60;
const ZONES=Object.freeze([
 Object.freeze({id:'cave',x:CAVE_X,z:CAVE_Z,radius:255}),
 Object.freeze({id:'graveyard',x:-255,z:0,radius:175}),
 Object.freeze({id:'forest',x:-85,z:-315,radius:130})
]);
const SOUTH=[[0,-224],[-18,-187],[-35,-153],[-38,-123],[-6,-102],[25,-78],[22,-52],[0,-24]];
const NORTH=[[0,224],[25,188],[39,151],[28,120],[-8,98],[-27,72],[-18,47],[0,23]];
const ALCOVES=[[-57,-150,12],[-58,-123,13],[43,-78,12],[-40,72,14],[50,151,13],[46,119,11]];
const ANCHORS=[[-35,-153],[-38,-123],[25,-78],[-27,72],[39,151],[28,120]];
const clamp=(t,a,b)=>Math.max(a,Math.min(b,t));
const dist=(x,z,a,b)=>Math.hypot(x-a,z-b);
function segment(x,z,ax,az,bx,bz){const dx=bx-ax,dz=bz-az,t=clamp(((x-ax)*dx+(z-az)*dz)/Math.max(.001,dx*dx+dz*dz),0,1);return dist(x,z,ax+dx*t,az+dz*t);}
function pathDistance(x,z,p){let d=Infinity;for(let i=1;i<p.length;i++)d=Math.min(d,segment(x,z,p[i-1][0],p[i-1][1],p[i][0],p[i][1]));return d;}
const arch=(d,r,h)=>{const t=d/r;return t>=1?0:h*Math.sqrt(1-t*t);};
function caveClearance(x,z){
 x-=CAVE_X;z-=CAVE_Z;if(Math.abs(x)>80||Math.abs(z)>236)return 0;
 let h=arch(Math.min(pathDistance(x,z,SOUTH),pathDistance(x,z,NORTH)),10.5,11.5);
 for(let i=0;i<ALCOVES.length;i++){const a=ALCOVES[i],b=ANCHORS[i];h=Math.max(h,arch(dist(x,z,a[0],a[1]),a[2],9),arch(segment(x,z,a[0],a[1],b[0],b[1]),5.5,8));}
 return Math.max(h,arch(Math.sqrt(x*x+z*z*.83),39,30));
}
function spawn(slot=0){
 slot=((slot%MAX_PLAYERS)+MAX_PLAYERS)%MAX_PLAYERS;const edge=HALF_SIZE-24,t=(slot%5)*(edge*2/5),side=Math.floor(slot/5);
 const [x,z]=side===0?[-edge+t,-edge]:side===1?[edge,-edge+t]:side===2?[edge-t,edge]:[-edge,edge-t];
 return {x,y:-2.32,z};
}
module.exports={HALF_SIZE,CAVE_X,CAVE_Z,MAX_PLAYERS,VERSION,spawn,MONSTER_COUNT,ZONES,caveClearance};
