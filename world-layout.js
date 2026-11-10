'use strict';
const HALF_SIZE=500,CAVE_X=265,CAVE_Z=0,MAX_PLAYERS=20,VERSION='dark-survival-1000-v1',MONSTER_COUNT=100;
const ZONES=Object.freeze([
 Object.freeze({id:'cave',x:CAVE_X,z:0,radius:255}),
 Object.freeze({id:'graveyard',x:-255,z:0,radius:180}),
 Object.freeze({id:'mountain',x:-20,z:300,radius:145}),
 Object.freeze({id:'forest',x:-85,z:-315,radius:130}),
 Object.freeze({id:'swamp',x:285,z:310,radius:145})
]);
function spawn(slot){slot=((slot%20)+20)%20;let e=HALF_SIZE-24,t=(slot%5)*e*2/5;switch(Math.floor(slot/5)){case 0:return {x:-e+t,y:-2.32,z:-e};case 1:return {x:e,y:-2.32,z:-e+t};case 2:return {x:e-t,y:-2.32,z:e};default:return {x:-e,y:-2.32,z:e-t};}}
// Same tunnel/hall/alcove footprint as client WorldLayout.caveClearance; no roof patrols.
const SOUTH=[[0,-224],[-18,-187],[-35,-153],[-38,-123],[-6,-102],[25,-78],[22,-52],[0,-24]];
const NORTH=[[0,224],[25,188],[39,151],[28,120],[-8,98],[-27,72],[-18,47],[0,23]];
const ALCOVES=[[-57,-150,12],[-58,-123,13],[43,-78,12],[-40,72,14],[50,151,13],[46,119,11]];
const ANCHORS=[[-35,-153],[-38,-123],[25,-78],[-27,72],[39,151],[28,120]];
function segment(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/Math.max(.001,dx*dx+dz*dz)));return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);}
function caveClearance(x,z){
 x-=CAVE_X;if(Math.abs(x)>80||Math.abs(z)>236)return 0;
 const arch=(d,r,h)=>d>=r?0:h*Math.sqrt(1-(d/r)**2);
 let d=Infinity;for(const path of [SOUTH,NORTH])for(let i=1;i<path.length;i++)d=Math.min(d,segment(x,z,path[i-1],path[i]));
 let h=arch(d,10.5,11.5);
 for(let i=0;i<ALCOVES.length;i++){const a=ALCOVES[i];h=Math.max(h,arch(Math.hypot(x-a[0],z-a[1]),a[2],9),arch(segment(x,z,a,ANCHORS[i]),5.5,8));}
 return Math.max(h,arch(Math.sqrt(x*x+z*z*.83),39,30));
}
module.exports={HALF_SIZE,CAVE_X,CAVE_Z,MAX_PLAYERS,VERSION,spawn,MONSTER_COUNT,ZONES,caveClearance};
