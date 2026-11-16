'use strict';
const http=require('node:http'),path=require('node:path'),express=require('express'),{Server}=require('socket.io');
const {DroneLogic}=require('./Server_DroneLogic');
const {DashLogic}=require('./dash');
const {Navigation}=require('./navigation'),{CombatWorld}=require('./combat');
const {DominationWorld}=require('./domination');
const {HALF_SIZE,VERSION,MONSTER_COUNT}=require('./world-layout');
function createServer(){
 const app=express(),httpServer=http.createServer(app),io=new Server(httpServer,{cors:{origin:'*'},transports:['websocket']});
 const emit=(id,event,data)=>io.to(id).emit(event,data);
 const nav=new Navigation(path.join(__dirname,'world-nav.json'));
 if(nav.data.layout!==VERSION||nav.data.format!==2||!nav.data.terrainSignature||nav.data.seed!==48391||nav.data.halfSize!==HALF_SIZE)throw Error('world-nav.json mismatch: deploy the navigation generated with this client');
 const world=new CombatWorld(nav,emit),domination=new DominationWorld(emit);
 const drone=new DroneLogic(world);world.drone=drone;
 const dash=new DashLogic(world);world.dash=dash;
 const dominationDash=new DashLogic(domination);domination.dash=dominationDash;
 const owner=id=>domination.players.has(id)?domination:world;
 app.get('/health',(_,res)=>res.json({ok:true,rooms:world.rooms.size+domination.rooms.size,players:world.players.size+[...domination.players.values()].filter(p=>!p.bot).length,protocol:2,objectiveProtocol:1,dashProtocol:1,layout:VERSION,maxPlayers:20,monstersPerRoom:MONSTER_COUNT,terrainSignature:nav.data.terrainSignature,maps:[{id:'mission',name:'المهمة'},{id:'domination',name:'الهيمنة',size:500,drone:false}]}));
 io.on('connection',socket=>{
  socket.on('joinRoom',d=>{
   // A joined participant cannot reset health/lives or change arenas mid-match.
   if(domination.players.has(socket.id))return;
   const old=world.players.get(socket.id);if(old&&old.alive)return;
   const mode=d&&d.mapId==='domination'?domination:world;
   world.leave(socket.id);mode.join(socket.id,d&&d.roomId,Boolean(d&&d.fresh));
   if(mode===world)drone.sync(world.players.get(socket.id));
   mode.dash.sync(mode.players.get(socket.id));
  });
  socket.on('RequestDash',d=>{const w=owner(socket.id),p=w.players.get(socket.id),r=p&&w.rooms.get(p.roomId);if(w===world||r?.phase==='playing')w.dash.request(socket.id,d);});
  socket.on('PickupShield',d=>owner(socket.id).pickupShield(socket.id,d));
  socket.on('RequestHeal',d=>owner(socket.id).heal(socket.id,d));
  socket.on('leaveRoom',()=>owner(socket.id).leave(socket.id));
  // Authoritative drone prohibition: requests and input never reach DroneLogic in this mode.
  socket.on('RequestDrone',d=>{if(owner(socket.id)===world&&!dash.locked(world.players.get(socket.id)))drone.request(socket.id,d);});
  socket.on('DroneInput',d=>{if(owner(socket.id)===world)drone.input(socket.id,d);});
  socket.on('retry',()=>{if(owner(socket.id)!==world)return;const p=world.players.get(socket.id);if(p&&!p.alive)world.join(socket.id,undefined,true);});
  socket.on('playerMove',d=>owner(socket.id).move(socket.id,d));
  socket.on('flashlightState',d=>{const w=owner(socket.id),light=w.light(socket.id,d),p=w.players.get(socket.id),r=p&&w.rooms.get(p.roomId);if(!light||!r)return;for(const q of r.players.values())if(!q.bot&&q.id!==socket.id&&q.alive&&Math.hypot(q.x-p.x,q.z-p.z)<110)emit(q.id,'flashlightState',light);});
  socket.on('shoot',d=>owner(socket.id).shoot(socket.id,d));
  socket.on('disconnect',()=>owner(socket.id).leave(socket.id));
 });
 const timer=setInterval(()=>{dash.tick();dominationDash.tick();drone.tick();world.tick(.05);domination.tick(.05);for(const w of [world,domination])for(const p of w.players.values())if(p.alive&&!p.bot)w.sendSnapshot(p);},50);
 return {io,world,domination,httpServer,server:httpServer,close:()=>{clearInterval(timer);io.close();return new Promise(r=>httpServer.close(r));}};
}
if(require.main===module){const port=process.env.PORT||3000;createServer().httpServer.listen(port,()=>console.log('listening on '+port));}
module.exports={createServer};
