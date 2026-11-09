'use strict';
const express=require('express'),http=require('node:http'),path=require('node:path');
const {VERSION,HALF_SIZE}=require('./world-layout');
const {Server}=require('socket.io');const {Navigation}=require('./navigation');const {CombatWorld}=require('./combat');
function createServer(){
 const app=express(),server=http.createServer(app),io=new Server(server,{cors:{origin:process.env.CORS_ORIGIN||'*'},maxHttpBufferSize:16384});
 const nav=new Navigation(path.join(__dirname,'world-nav.json'));if(nav.data.layout!==VERSION||nav.data.format!==2||!nav.data.terrainSignature||nav.data.seed!==48391||nav.data.halfSize!==HALF_SIZE)throw Error('world-nav.json mismatch: deploy the navigation generated with this client');const world=new CombatWorld(nav,(id,event,data)=>io.to(id).emit(event,data));
 app.get('/health',(_,res)=>res.json({ok:true,rooms:world.rooms.size,players:world.players.size,protocol:2,layout:VERSION,maxPlayers:20,monstersPerRoom:100,terrainSignature:nav.data.terrainSignature}));
 io.on('connection',socket=>{
  let window=Date.now(),requests=0,lastJoin=0,lastLight=0;
  socket.use((packet,next)=>{let t=Date.now();if(t-window>1000){window=t;requests=0;}if(++requests>100)return next(Error('Rate limit'));next();});
  const join=data=>{let now=Date.now();if(now-lastJoin<1000)return;lastJoin=now;let old=world.players.get(socket.id);if(old)socket.leave(old.roomId);let room=world.join(socket.id,data&&typeof data.roomId==='string'?data.roomId:undefined,!!(data&&data.fresh));socket.join(room.id);};
  socket.on('joinRoom',join);socket.on('retry',()=>join({fresh:true}));
  socket.on('playerMove',data=>world.move(socket.id,data));
  socket.on('updatePosition',data=>world.move(socket.id,{...data,y:Number.isFinite(data?.y)?data.y:12}));
  socket.on('shoot',data=>world.shoot(socket.id,data));
  socket.on('flashlightState',data=>{const p=world.players.get(socket.id),now=Date.now();if(!p||!p.alive||!data)return;
   if(data.on!==false&&now-lastLight<80)return;lastLight=now;
   const clean=world.light(socket.id,data);if(clean)socket.to(p.roomId).emit('flashlightState',clean);
  });
  socket.on('disconnect',()=>world.leave(socket.id));
 });
 let last=performance.now(),acc=0,broadcast=0;
 const timer=setInterval(()=>{let now=performance.now();acc+=Math.min(.25,(now-last)/1000);last=now;let steps=0;while(acc>=.05&&steps++<5){world.tick(.05);acc-=.05;broadcast++;for(const p of world.players.values()){if(broadcast%2===0)world.sendSnapshot(p);else world.sendPlayerSnapshot(p);}}},10);
 const close=()=>new Promise(resolve=>{clearInterval(timer);io.close(()=>resolve());});
 return {app,server,io,world,nav,close};
}
if(require.main===module){let game=createServer();const port=process.env.PORT||3000;game.server.listen(port,()=>console.log('Cave combat protocol v2 on port '+port));for(let signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await game.close();process.exit(0);});}
module.exports={createServer};
