'use strict';
const {performance}=require('node:perf_hooks');
const {HALF_SIZE}=require('./world-layout');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};

// Seconds/metres. No value below is accepted from a client packet.
const CONFIG=Object.freeze({
    duration:10,
    cooldown:300,
    height:6,
    normalSpeed:7.5,
    maxMultiplier:3,
    assemble:.8,
    idle:.2,
    mount:1.7,
    rise:2,
    acceleration:2,
    landing:1.4,
    inputTimeout:.45
});

const HEIGHT_OFFSETS=Object.freeze([.18,.95,1.8,2.5]);
const RADIAL_OFFSETS=Object.freeze([[.48,0],[-.48,0],[0,.48],[0,-.48]]);
const SLIDE_ANGLES=Object.freeze([
    [Math.cos(Math.PI/4),Math.sin(Math.PI/4),Math.cos(Math.PI/4)],
    [Math.cos(-Math.PI/4),Math.sin(-Math.PI/4),Math.cos(Math.PI/4)],
    [Math.cos(Math.PI*7/18),Math.sin(Math.PI*7/18),Math.cos(Math.PI*7/18)],
    [Math.cos(-Math.PI*7/18),Math.sin(-Math.PI*7/18),Math.cos(Math.PI*7/18)]
]);

class DroneLogic {
    constructor(world,{now=()=>performance.now()/1000}={}){
        this.world=world;
        this.now=now;
        this.cooldowns=new Map();
        this.serial=0;
    }

    packet(p){
        const t=this.now(), d=p.drone;
        return {
            id:p.id, roomId:p.roomId, life:p.life,
            serverTime:t, revision:d?d.revision:(p.droneRevision||0), state:d?d.state:'GROUND',
            x:p.x, y:p.y, z:p.z, yaw:p.yaw, speed:p.speed||0,
            vx:p.vx||0, vy:p.vy||0, vz:p.vz||0,
            startedAt:d?d.startedAt:0, mountAt:d?d.mountAt:0, flyAt:d?d.flyAt:0,
            endsAt:d?d.endsAt:0, landingEndsAt:d?d.landingEndsAt:0,
            cooldownUntil:this.cooldowns.get(p.id)||0,
            cooldownSeconds:CONFIG.cooldown, flightSeconds:CONFIG.duration,
            assembleSeconds:CONFIG.assemble, idleSeconds:CONFIG.idle, mountSeconds:CONFIG.mount
        };
    }

    emit(p,event,onlySelf=false){
        const r=this.world.rooms.get(p.roomId), o=this.packet(p);
        if(onlySelf) this.world.emit(p.id,event,o);
        else if(r) for(const q of r.players.values()) this.world.emit(q.id,event,o);
    }

    sync(p){if(p) this.emit(p,'SyncDrone',true);}
    
    locked(p){return !!(p&&p.drone);}

    request(id,data){
        const p=this.world.players.get(id), t=this.now();
        if(!p||!p.alive||p.escaped||!data||data.life!==p.life)return false;
        if(t<(p.droneRequestAt||0))return false;
        p.droneRequestAt=t+.25;
        
        if(p.drone||t<(this.cooldowns.get(id)||0)||!p.positioned){this.sync(p);return false;}
        
        const floor=this.world.nav.height(p.x,p.z);
        if(!finite(floor)||Math.abs(p.y-floor)>.7||!this.world.nav.walkable(p.x,p.z,false)){
            this.sync(p);return false;
        }
        
        p.y=floor;p.positioned=true;p.grounded=false;p.swimming=false;
        p.crouched=p.prone=p.inHands=p.aiming=p.firing=false;p.proneTransition=0;
        p.vx=p.vy=p.vz=p.speed=0;
        
        p.drone={
            revision:++this.serial, state:'SUMMON', startedAt:t,
            mountAt:t+CONFIG.assemble+CONFIG.idle,
            flyAt:t+CONFIG.assemble+CONFIG.idle+CONFIG.mount,
            endsAt:t+CONFIG.duration, landingEndsAt:0,
            floor, lastAt:t, inputAt:-Infinity, inputSequence:-1, ix:0, iz:0
        };
        p.droneRevision=p.drone.revision;
        this.emit(p,'StartDrone');
        return true;
    }

    input(id,o){
        const p=this.world.players.get(id), d=p&&p.drone, t=this.now();
        if(!p||!p.alive||!d||d.state==='LANDING'||!o||o.life!==p.life||o.revision!==d.revision||
           !Number.isSafeInteger(o.sequence)||o.sequence<=d.inputSequence||
           ![o.stickX,o.stickY,o.cameraYaw].every(finite)) return false;
           
        if(Math.abs(o.stickX)>1||Math.abs(o.stickY)>1||Math.abs(o.cameraYaw)>1e6)return false;
        
        let x=o.stickX, y=o.stickY, len=Math.hypot(x,y);
        if(len>1){x/=len;y/=len;}
        
        const a=o.cameraYaw*Math.PI/180, s=Math.sin(a), c=Math.cos(a);
        d.ix=x*c-y*s; d.iz=-x*s-y*c;
        d.inputSequence=o.sequence; d.inputAt=t;
        return true;
    }

    beginLanding(p,t){
        const d=p.drone;
        if(!d||d.state==='LANDING')return;
        
        d.state='LANDING';
        d.landAt=d.endsAt;
        d.landingEndsAt=d.endsAt+CONFIG.landing;
        d.landY=p.y;
        d.floor=this.world.nav.height(p.x,p.z);
        
        if(this.world.nav.ray){
            const range=Math.max(.1,p.y-d.floor+.1);
            const hit=this.world.nav.ray({x:p.x,y:p.y+.1,z:p.z},{x:0,y:-1,z:0},range);
            d.floor=Math.min(p.y,Math.max(d.floor,p.y+.1-hit));
        }
        d.ix=d.iz=0;
        this.cooldowns.set(p.id,d.endsAt+CONFIG.cooldown);
        p.vx=p.vz=p.speed=0;
        this.emit(p,'EndDrone');
    }

    rayBlocked(ax,ay,az,bx,by,bz){
        const nav=this.world.nav;
        const vx=bx-ax, vy=by-ay, vz=bz-az, length=Math.hypot(vx,vy,vz);
        if(length<=.00001)return false;
        if(nav.ray){
            const dx=vx/length, dy=vy/length, dz=vz/length;
            // Shift ray origin back by 0.03m to eliminate the [0, 0.03) rayTriangle blind spot
            // while ignoring any surface already behind the starting point (h_a < 0 => h_origin < 0.03).
            const origin={x:ax-dx*.03, y:ay-dy*.03, z:az-dz*.03};
            return nav.ray(origin,{x:dx,y:dy,z:dz},length+.11)<=length+.06;
        }
        return !nav.clear({x:ax,y:ay,z:az},{x:bx,y:by,z:bz});
    }

    clear(p,x,y,z){
        const nav=this.world.nav;
        if(Math.abs(x)>HALF_SIZE-.6||Math.abs(z)>HALF_SIZE-.6||y<nav.height(x,z)-.03)return false;
        
        const hasRay=!!nav.ray;
        const horizMove=Math.hypot(x-p.x,z-p.z)>.00001;
        const gCenterA=hasRay?nav.height(p.x,p.z)+.18:-Infinity;
        const gCenterB=hasRay?nav.height(x,z)+.18:-Infinity;

        for(const h of HEIGHT_OFFSETS){
            const cyA=Math.max(p.y+h,gCenterA), cyB=Math.max(y+h,gCenterB);
            if(this.rayBlocked(p.x,cyA,p.z,x,cyB,z))return false;
            
            for(const [dx,dz] of RADIAL_OFFSETS){
                const ax=p.x+dx, az=p.z+dz, bx=x+dx, bz=z+dz;
                const ay=hasRay?Math.max(p.y+h,nav.height(ax,az)+.18):p.y+h;
                const by=hasRay?Math.max(y+h,nav.height(bx,bz)+.18):y+h;
                if(this.rayBlocked(ax,ay,az,bx,by,bz))return false;
                if(hasRay&&horizMove&&this.rayBlocked(x,cyB,z,bx,by,bz))return false;
            }
        }
        return true;
    }

    tryHorizontal(p,nx,nz){
        const hy=Math.max(p.y,this.world.nav.height(nx,nz));
        if(this.clear(p,nx,hy,nz)){
            p.x=nx; p.z=nz; p.y=hy;
            return true;
        }
        return false;
    }

    stepHorizontal(p,dx,dz){
        if(Math.hypot(dx,dz)<=1e-7)return;
        if(this.tryHorizontal(p,p.x+dx,p.z+dz))return;

        // Axis-aligned wall sliding (try dominant velocity component first)
        if(Math.abs(dx)>=Math.abs(dz)){
            if(Math.abs(dx)>1e-7&&this.tryHorizontal(p,p.x+dx,p.z))return;
            if(Math.abs(dz)>1e-7&&this.tryHorizontal(p,p.x,p.z+dz))return;
        }else{
            if(Math.abs(dz)>1e-7&&this.tryHorizontal(p,p.x,p.z+dz))return;
            if(Math.abs(dx)>1e-7&&this.tryHorizontal(p,p.x+dx,p.z))return;
        }

        // Angled obstacle / roof / tree-trunk tangent sliding
        for(const [c,s,scale] of SLIDE_ANGLES){
            const sx=(dx*c-dz*s)*scale, sz=(dx*s+dz*c)*scale;
            if(this.tryHorizontal(p,p.x+sx,p.z+sz))return;
        }

        // Fractional step to close remaining gap smoothly against a perpendicular wall
        for(const f of [.5,.25]){
            if(this.tryHorizontal(p,p.x+dx*f,p.z+dz*f))return;
        }
    }

    stepVertical(p,targetY){
        if(Math.abs(targetY-p.y)<=1e-7)return;
        if(this.clear(p,p.x,targetY,p.z)){
            p.y=targetY;
            return;
        }
        let lo=p.y, hi=targetY;
        for(let i=0;i<6;i++){
            const mid=(lo+hi)*.5;
            if(this.clear(p,p.x,mid,p.z))lo=mid;
            else hi=mid;
        }
        p.y=lo;
    }

    tick(){
        const t=this.now();
        for(const p of this.world.players.values()){
            const d=p.drone;
            if(!d){
                if(t>=(p.droneSyncAt||0)){p.droneSyncAt=t+1;this.sync(p);}
                continue;
            }
            if(!p.alive||p.escaped){this.cancel(p);continue;}
            if(t>=d.endsAt&&d.state!=='LANDING')this.beginLanding(p,t);
            
            const oldY=p.y, oldX=p.x, oldZ=p.z;
            
            if(d.state==='LANDING'){
                const y=d.landY+(d.floor-d.landY)*smooth((t-d.landAt)/CONFIG.landing);
                p.y=y;p.vx=p.vz=p.speed=0;
                if(t>=d.landingEndsAt){
                    p.y=d.floor;p.grounded=true;p.vx=p.vy=p.vz=p.speed=0;p.lastMove=this.world.time;
                    p.droneHandoffUntil=this.world.time+.3;
                    p.drone=null;
                    this.emit(p,'SyncDrone');
                    continue;
                }
            }else{
                d.state = t<d.mountAt ? 'SUMMON' : t<d.flyAt ? 'MOUNT' : 'FLYING';
                let remaining=Math.max(0,Math.min(.25,t-d.lastAt)), cursor=t-remaining;
                
                while(remaining>1e-8){
                    const dt=Math.min(remaining,1/60);
                    cursor+=dt; remaining-=dt;
                    
                    const age=Math.max(0,cursor-d.flyAt);
                    const multiplier=1+(CONFIG.maxMultiplier-1)*smooth(age/CONFIG.acceleration);
                    const active=cursor>=d.flyAt&&t-d.inputAt<CONFIG.inputTimeout;
                    
                    const vx=active?d.ix*CONFIG.normalSpeed*multiplier:0;
                    const vz=active?d.iz*CONFIG.normalSpeed*multiplier:0;
                    
                    // 1. Move horizontally at current altitude (decoupled from vertical climb/descent)
                    if(active) this.stepHorizontal(p,vx*dt,vz*dt);
                    
                    // 2. Smoothly track ground height so drone maintains 6m over uneven terrain without jerks
                    const groundY=this.world.nav.height(p.x,p.z);
                    if(cursor>=d.flyAt){
                        d.floor+=(groundY-d.floor)*(1-Math.exp(-14*dt));
                    }else{
                        d.floor=groundY;
                    }
                    const rise=smooth(age/CONFIG.rise);
                    let targetY=Math.max(d.floor+CONFIG.height*rise,groundY+Math.min(1.2,CONFIG.height*rise));
                    const maxVert=24*dt;
                    if(targetY>p.y+maxVert)targetY=p.y+maxVert;
                    else if(targetY<p.y-maxVert)targetY=p.y-maxVert;
                    
                    this.stepVertical(p,targetY);
                    if(p.y<groundY)p.y=groundY;
                    
                    if(Math.hypot(vx,vz)>.01) p.yaw=Math.atan2(vx,vz)*180/Math.PI;
                }
                const elapsed=Math.max(.001,t-d.lastAt);
                p.vx=(p.x-oldX)/elapsed;
                p.vz=(p.z-oldZ)/elapsed;
                p.speed=Math.hypot(p.vx,p.vz);
            }
            
            const elapsed=Math.max(.01,t-d.lastAt);
            p.vy=Math.max(-25,Math.min(25,(p.y-oldY)/elapsed));
            p.grounded=false;
            p.positioned=true; p.lastMove=this.world.time; d.lastAt=t;
            this.emit(p,'SyncDrone');
        }
        for(const [id,until] of this.cooldowns) if(t>=until&&!this.world.players.has(id)) this.cooldowns.delete(id);
    }

    cancel(p){
        if(!p||!p.drone)return;
        const d=p.drone;
        this.cooldowns.set(p.id,Math.max(this.cooldowns.get(p.id)||0,this.now()+CONFIG.cooldown));
        d.state='LANDING'; d.endsAt=this.now(); d.landingEndsAt=this.now();
        this.emit(p,'EndDrone');
        p.drone=null; p.vx=p.vy=p.vz=p.speed=0;
        this.emit(p,'SyncDrone');
    }

    rejectMove(p,data){
        return this.locked(p)||!!(p&&this.world.time<(p.droneHandoffUntil||0)&&
         (!data||Math.hypot(data.x-p.x,data.y-p.y,data.z-p.z)>1));
    }
}

module.exports={DroneLogic,CONFIG};
