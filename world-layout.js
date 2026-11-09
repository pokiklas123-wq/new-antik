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
module.exports={HALF_SIZE,CAVE_X,CAVE_Z,MAX_PLAYERS,VERSION,spawn,MONSTER_COUNT,ZONES};
