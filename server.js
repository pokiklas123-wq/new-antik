'use strict';
const http=require('node:http'),path=require('node:path'),express=require('express'),{Server}=require('socket.io');
const {DroneLogic}=require('./Server_DroneLogic');
const {Navigation}=require('./navigation'),{CombatWorld}=require('./combat');
const {HALF_SIZE,MAX_PLAYERS,VERSION,MONSTER_COUNT}=require('./world-layout');
function createServer(){
 const app=express(),httpServer=http.createServer(app),io=new Server(httpServer,{cors:{origin:'*'},transports:['websocket']});
 const nav=new Navigation(path.join(__dirname,'world-nav.json'));if(nav.data.layout!==VERSION||nav.data.format!==2||!nav.data.terrainSignature||nav.data.seed!==48391||nav.data.halfSize!==HALF_SIZE)throw Error('world-nav.json mismatch: deploy the navigation generated with this client');const world=new CombatWorld(nav,(id,event,data)=>io.to(id).emit(event,data));
 const drone=new DroneLogic(world);world.drone=drone;
 app.get('/health',(_,res)=>res.json({ok:true,rooms:world.rooms.size,players:world.players.size,protocol:2,objectiveProtocol:1,layout:VERSION,maxPlayers:20,monstersPerRoom:MONSTER_COUNT,terrainSignature:nav.data.terrainSignature}));
 io.on('connection',socket=>{
  socket.on('joinRoom',d=>{const old=world.players.get(socket.id);if(old&&old.alive)return;world.join(socket.id,d&&d.roomId,Boolean(d&&d.fresh));drone.sync(world.players.get(socket.id));});
  socket.on('RequestDrone',d=>drone.request(socket.id,d));
  socket.on('DroneInput',d=>drone.input(socket.id,d));
  socket.on('retry',()=>{const p=world.players.get(socket.id);if(p&&!p.alive)world.join(socket.id,undefined,true);});
  socket.on('playerMove',d=>world.move(socket.id,d));
  socket.on('flashlightState',d=>{const light=world.light(socket.id,d),p=world.players.get(socket.id),r=p&&world.rooms.get(p.roomId);if(!light||!r)return;for(const q of r.players.values())if(q.id!==socket.id&&q.alive&&Math.hypot(q.x-p.x,q.z-p.z)<110)io.to(q.id).emit('flashlightState',light);});
  socket.on('shoot',d=>world.shoot(socket.id,d));
  socket.on('disconnect',()=>world.leave(socket.id));
 });
 let timer=setInterval(()=>{drone.tick();world.tick(.05);for(let p of world.players.values())if(p.alive)world.sendSnapshot(p);},50);
 return {io,world,httpServer,server:httpServer,close:()=>{clearInterval(timer);io.close();return new Promise(r=>httpServer.close(r));}};
}
if(require.main===module){const port=process.env.PORT||3000;createServer().httpServer.listen(port,()=>console.log('listening on '+port));}
module.exports={createServer};
