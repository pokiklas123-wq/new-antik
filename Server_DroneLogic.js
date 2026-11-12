'use strict';
const {performance}=require('node:perf_hooks');
const {HALF_SIZE}=require('./world-layout');
const {rayTriangle}=require('./navigation');
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
const SAMPLE_OFFSETS=Object.freeze([[0,0],[.48,0],[-.48,0],[0,.48],[0,-.48]]);
const SLIDE_DIRS=Object.freeze([
    [Math.SQRT1_2,Math.SQRT1_2,.7071],
    [Math.SQRT1_2,-Math.SQRT1_2,.7071]
]);

class DroneLogic {
    constructor(world,{now=()=>performance.now()/1000}={}){
        this.world=world;
        this.now=now;
        this.cooldowns=new Map();
        this.serial=0;
        const triCount=world.nav&&world.nav.triangles?Math.ceil(world.nav.triangles.length/9):1;
        this.localTris=new Int32Array(2048);
        this.localCount=0;
        this.seenStamp=new Int32Array(triCount);
        this.stamp=0;
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

    /** Broad-phase triangle gather once per tick around player's motion volume (zero allocations). */
    prepareLocalTriangles(x0,y0,z0,x1,y1,z1){
        const nav=this.world.nav;
        if(!nav.triangles||!nav.cells){this.localCount=-1;return;}
        const tris=nav.triangles;
        const minX=Math.min(x0,x1)-.65, maxX=Math.max(x0,x1)+.65;
        const minY=Math.min(y0,y1)-.15, maxY=Math.max(y0,y1)+2.75;
        const minZ=Math.min(z0,z1)-.65, maxZ=Math.max(z0,z1)+.65;
        const cx0=Math.floor(minX/16), cx1=Math.floor(maxX/16);
        const cz0=Math.floor(minZ/16), cz1=Math.floor(maxZ/16);
        const stamp=(this.stamp=(this.stamp+1)|0);
        const seen=this.seenStamp, out=this.localTris;
        let count=0;
        for(let cz=cz0;cz<=cz1;cz++){
            for(let cx=cx0;cx<=cx1;cx++){
                const list=nav.cells.get(cx+','+cz);
                if(!list)continue;
                for(let i=0,n=list.length;i<n;i++){
                    const off=list[i], idx=(off/9)|0;
                    if(seen[idx]===stamp)continue;
                    seen[idx]=stamp;
                    if(tris[off]<minX&&tris[off+3]<minX&&tris[off+6]<minX)continue;
                    if(tris[off]>maxX&&tris[off+3]>maxX&&tris[off+6]>maxX)continue;
                    if(tris[off+1]<minY&&tris[off+4]<minY&&tris[off+7]<minY)continue;
                    if(tris[off+1]>maxY&&tris[off+4]>maxY&&tris[off+7]>maxY)continue;
                    if(tris[off+2]<minZ&&tris[off+5]<minZ&&tris[off+8]<minZ)continue;
                    if(tris[off+2]>maxZ&&tris[off+5]>maxZ&&tris[off+8]>maxZ)continue;
                    if(count<out.length)out[count++]=off;
                }
            }
        }
        this.localCount=count;
    }

    segmentHitsLocal(ax,ay,az,bx,by,bz){
        const vx=bx-ax, vy=by-ay, vz=bz-az, len=Math.hypot(vx,vy,vz);
        if(len<=.00001)return false;
        const dx=vx/len, dy=vy/len, dz=vz/len;
        // Shift origin back by 0.03m so any surface at distance >= 0 in front of `a` has h >= 0.03
        const o={x:ax-dx*.03, y:ay-dy*.03, z:az-dz*.03};
        const d={x:dx, y:dy, z:dz};
        const maxHit=len+.06;
        const tris=this.world.nav.triangles, local=this.localTris, n=this.localCount;
        for(let i=0;i<n;i++){
            const h=rayTriangle(o,d,tris,local[i]);
            if(h!==null&&h>=.03&&h<=maxHit)return true;
        }
        return false;
    }

    clear(p,x,y,z){
        const nav=this.world.nav;
        if(Math.abs(x)>HALF_SIZE-.6||Math.abs(z)>HALF_SIZE-.6||y<nav.height(x,z)-.03)return false;

        // Fast path when real navigation mesh is loaded: use pre-filtered local obstacle triangles
        if(this.localCount>=0&&nav.triangles&&nav.cells){
            if(this.localCount===0)return true;
            const horizMove=Math.hypot(x-p.x,z-p.z)>.00001;
            for(const h of HEIGHT_OFFSETS){
                const ay0=p.y+h, by0=y+h;
                for(const [dx,dz] of SAMPLE_OFFSETS){
                    if(this.segmentHitsLocal(p.x+dx,ay0,p.z+dz,x+dx,by0,z+dz))return false;
                    if(horizMove&&(dx!==0||dz!==0)&&this.segmentHitsLocal(x,by0,z,x+dx,by0,z+dz))return false;
                }
            }
            return true;
        }

        // Fallback path for unit tests with custom nav.ray or nav.clear mocks
        for(const h of HEIGHT_OFFSETS){
            for(const [dx,dz] of SAMPLE_OFFSETS){
                const a={x:p.x+dx,y:p.y+h,z:p.z+dz}, b={x:x+dx,y:y+h,z:z+dz};
                if(nav.ray){
                    const vx=b.x-a.x, vy=b.y-a.y, vz=b.z-a.z, length=Math.hypot(vx,vy,vz);
                    if(length>.00001&&nav.ray(a,{x:vx/length,y:vy/length,z:vz/length},length+.08)<=length+.03)return false;
                }else if(!nav.clear(a,b))return false;
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

        if(Math.abs(dx)>=Math.abs(dz)){
            if(Math.abs(dx)>1e-7&&this.tryHorizontal(p,p.x+dx,p.z))return;
            if(Math.abs(dz)>1e-7&&this.tryHorizontal(p,p.x,p.z+dz))return;
        }else{
            if(Math.abs(dz)>1e-7&&this.tryHorizontal(p,p.x,p.z+dz))return;
            if(Math.abs(dx)>1e-7&&this.tryHorizontal(p,p.x+dx,p.z))return;
        }

        for(const [c,s,scale] of SLIDE_DIRS){
            const sx=(dx*c-dz*s)*scale, sz=(dx*s+dz*c)*scale;
            if(this.tryHorizontal(p,p.x+sx,p.z+sz))return;
        }

        if(this.tryHorizontal(p,p.x+dx*.5,p.z+dz*.5))return;
    }

    stepVertical(p,targetY){
        if(Math.abs(targetY-p.y)<=1e-7)return;
        if(this.clear(p,p.x,targetY,p.z)){
            p.y=targetY;
            return;
        }
        let lo=p.y, hi=targetY;
        for(let i=0;i<5;i++){
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
                const maxReach=CONFIG.normalSpeed*CONFIG.maxMultiplier*remaining+.5;
                this.prepareLocalTriangles(
                    p.x-maxReach, p.y-3, p.z-maxReach,
                    p.x+maxReach, p.y+CONFIG.height+3, p.z+maxReach
                );
                
                while(remaining>1e-8){
                    const dt=Math.min(remaining,1/60);
                    cursor+=dt; remaining-=dt;
                    
                    const age=Math.max(0,cursor-d.flyAt);
                    const multiplier=1+(CONFIG.maxMultiplier-1)*smooth(age/CONFIG.acceleration);
                    const active=cursor>=d.flyAt&&t-d.inputAt<CONFIG.inputTimeout;
                    
                    const vx=active?d.ix*CONFIG.normalSpeed*multiplier:0;
                    const vz=active?d.iz*CONFIG.normalSpeed*multiplier:0;
                    
                    if(active) this.stepHorizontal(p,vx*dt,vz*dt);
                    
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
