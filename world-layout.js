'use strict';
const HALF_SIZE=850,CAVE_X=560,CAVE_Z=0,MAX_PLAYERS=20,VERSION='strategic-1700-v3';
function spawn(slot){let e=HALF_SIZE-24,t=(slot%5)*e*2/5;switch(Math.floor(slot/5)){case 0:return {x:-e+t,y:2,z:-e};case 1:return {x:e,y:2,z:-e+t};case 2:return {x:e-t,y:2,z:e};default:return {x:-e,y:2,z:e-t};}}
module.exports={HALF_SIZE,CAVE_X,CAVE_Z,MAX_PLAYERS,VERSION,spawn};
