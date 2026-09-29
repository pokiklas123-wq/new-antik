const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
 
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 25000,
    pingTimeout: 60000
});

const PORT = process.env.PORT || 3000;
const DB_URL = "https://game-worboat-default-rtdb.europe-west1.firebasedatabase.app";
const MAX_PLAYERS_4V = 4;
const RESPAWN_MS = 3000;
const WORLD_SIZE = 10000;
const WORLD_MIN = 700;
const WORLD_MAX = WORLD_SIZE - 700;
const TICK_MS = 100; 
const BOT_SPAWN_MIN_DIST = 3500;
const BOT_SPAWN_MAX_DIST = 6000;
const OFFLINE_DEATH_MS = 60000;

const SHIPS_CONFIG = {
    'bot':             { hp: 100, speed: 10.0 }, // Level 1
    'devilahorns':     { hp: 100, speed: 18.5 }, // Level 10
    'devilsfangs':     { hp: 150, speed: 12.0 }, // Level 20
    'finish':          { hp: 140, speed: 18.5 }, // Level 30
    'proskin':         { hp: 140, speed: 19.5 }, // Level 40
    'suphigh':         { hp: 110, speed: 20.0 }, // Level 50
    'suplis':          { hp: 110, speed: 20.5 }, // Level 60
    'suplis2':         { hp: 120, speed: 20.5 }, // Level 70
    'gemini':          { hp: 300, speed: 17.0 }, // Level 80
    'war':             { hp: 250, speed: 20.0 }, // Level 90
    'geminiprosimple': { hp: 300, speed: 19.0 }, // Level 100
    'deepseek':        { hp: 280, speed: 20.5 }, // Level 110
    'geminipro':       { hp: 300, speed: 21.0 }, // Level 120
    'legendary':       { hp: 350, speed: 20.0 }  // Level 130
};

function getShipStats(hullId) {
    return SHIPS_CONFIG[hullId.toLowerCase()] || SHIPS_CONFIG['bot'];
}

let rooms = {};
let nextRoomId = 1;
let wipedRoomsLog = new Set();

app.get('/', (req, res) => {
    res.send('Grand3D Co-op Server v28.6 - Fixed Chaser Top Speed');
});

function rnd(a, b) { return a + Math.random() * (b - a); }

function dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
}

function botSpeedForWave(wave) {
    return Math.min(10.0 + (wave * 0.1), 16.0); 
}

function botHPForWave(wave) {
    if (wave > 150) return 4;
    if (wave > 80) return 3;
    if (wave > 30) return 2;
    return 1;
}

function botCountForWave(wave) {
    return Math.min(5 + Math.floor(wave * 0.3), 30);
}

function getChaserCountForWave(wave) {
    if (wave < 50) return 0;
    return 1 + Math.floor((wave - 50) / 10);
}

function getMaxSpeedInRoom(room) {
    let maxSpd = 10.0;
    for (const uid in room.players) {
        const p = room.players[uid];
        if (p.maxSpeed && p.maxSpeed > maxSpd) {
            maxSpd = p.maxSpeed;
        }
    }
    return maxSpd;
}

function randomSpawnNearSafe(cx, cy, minD, maxD, islands) {
    for (let attempt = 0; attempt < 40; attempt++) {
        const a = Math.random() * Math.PI * 2;
        const d = rnd(minD, maxD);
        let x = cx + Math.cos(a) * d;
        let y = cy + Math.sin(a) * d;
        x = Math.max(WORLD_MIN, Math.min(WORLD_MAX, x));
        y = Math.max(WORLD_MIN, Math.min(WORLD_MAX, y));
        let inside = false;
        if (islands && islands.length) {
            for (const isl of islands) {
                if (dist2(x, y, isl.x, isl.y) < (isl.radius + 250) * (isl.radius + 250)) {
                    inside = true; break;
                }
            }
        }
        if (!inside) return { x, y };
    }
    return { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
}

function cleanSocket(socket) {
    if (!socket) return;
    socket.currentRoom = null;
    socket.uid = null;
    socket.username = null;
    socket.mode = null;
    socket.startLevel = null;
}

function findOpenRoom(mode) {
    for (const id in rooms) {
        const r = rooms[id];
        if (r.mode !== mode) continue;
        if (r.wiped) continue;
        if (mode === '1VBOT' && Object.keys(r.players).length === 0) return id;
        if (mode === '4VBOT' && Object.keys(r.players).length < MAX_PLAYERS_4V) return id;
    }
    return null;
}

function createRoom(mode, startWave) {
    const id = `${mode === '1VBOT' ? 'solo' : 'coop'}_${nextRoomId++}`;
    rooms[id] = {
        id, mode,
        players: {},
        wave: Math.max(1, startWave),
        bots: {},
        botIdCounter: 1,
        botTickInterval: null,
        islands: [],
        wiped: false
    };
    startBotTick(id);
    return id;
}

function startBotTick(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.botTickInterval = setInterval(() => {
        const r = rooms[roomId];
        if (!r || r.wiped) return;

        const playersList = Object.values(r.players).filter(p => p.hp > 0 && p.online);
        if (playersList.length === 0) {
            io.to(roomId).emit('bots_update', []);
            return;
        }

        for (let i = 0; i < playersList.length; i++) {
            const p = playersList[i];
            p.vx = p.x - (p.lastX || p.x);
            p.vy = p.y - (p.lastY || p.y);
            p.lastX = p.x;
            p.lastY = p.y;
        }

        const islands = r.islands || [];
        const islData = islands.map(i => ({
            x: i.x, y: i.y,
            r100sq: (i.radius + 150) * (i.radius + 150) 
        }));

        const maxRoomSpeed = getMaxSpeedInRoom(r);

        for (const botId in r.bots) {
            const bot = r.bots[botId];
            if (bot.hp <= 0) continue;

            let closest = null, closestD2 = Infinity;
            for (let i = 0; i < playersList.length; i++) {
                const p = playersList[i];
                const d2 = dist2(p.x, p.y, bot.x, bot.y);
                if (d2 < closestD2) { closestD2 = d2; closest = p; }
            }
            if (!closest) continue;

            const dx = closest.x - bot.x;
            const dy = closest.y - bot.y;
            const len = Math.sqrt(closestD2) || 1;

            let speed = bot.isChaser ? maxRoomSpeed : botSpeedForWave(r.wave);
            const step = speed * (TICK_MS / 50); 

            let moveDx = 0, moveDy = 0;
            
            if (bot.isChaser) {
                moveDx = dx;
                moveDy = dy;
            } else {
                if (len > 1800) {
                    moveDx = dx; 
                    moveDy = dy;
                } else if (len < 900) {
                    moveDx = -dx; 
                    moveDy = -dy;
                } else {
                    const circleDirection = (bot.id % 2 === 0) ? 1 : -1;
                    moveDx = dy * circleDirection; 
                    moveDy = -dx * circleDirection;
                    moveDx += dx * 0.15;
                    moveDy += dy * 0.15;
                }
            }

            const moveLen = Math.sqrt(moveDx * moveDx + moveDy * moveDy) || 1;
            let nx = bot.x + (moveDx / moveLen) * step;
            let ny = bot.y + (moveDy / moveLen) * step;

            let blocked = false;
            for (let i = 0; i < islData.length; i++) {
                if (dist2(nx, ny, islData[i].x, islData[i].y) < islData[i].r100sq) {
                    blocked = true; break;
                }
            }

            if (!blocked) {
                bot.x = nx; bot.y = ny;
            } else {
                const perp = Math.atan2(moveDy, moveDx) + Math.PI / 2;
                const tX = bot.x + Math.cos(perp) * step;
                const tY = bot.y + Math.sin(perp) * step;
                let b2 = false;
                for (let i = 0; i < islData.length; i++) {
                    if (dist2(tX, tY, islData[i].x, islData[i].y) < islData[i].r100sq) {
                        b2 = true; break;
                    }
                }
                if (!b2) { bot.x = tX; bot.y = tY; }
            }

            if (bot.x < WORLD_MIN) bot.x = WORLD_MIN; else if (bot.x > WORLD_MAX) bot.x = WORLD_MAX;
            if (bot.y < WORLD_MIN) bot.y = WORLD_MIN; else if (bot.y > WORLD_MAX) bot.y = WORLD_MAX;

            const targetHeading = Math.atan2(dx, -dy) * 180 / Math.PI;
            if (bot.isChaser) {
                let diff = targetHeading - bot.heading;
                while (diff > 180) diff -= 360;
                while (diff < -180) diff += 360;
                bot.heading += diff * 0.4;
            } else {
                bot.heading = targetHeading;
            }

            const fireCooldown = Math.max(0.8, 2.5 - (r.wave * 0.015));
            bot.fireTimer = (bot.fireTimer || 0) + (TICK_MS / 1000);

            if (bot.fireTimer > fireCooldown && closestD2 < 2000 * 2000) {
                bot.fireTimer = 0;
                
                const predictionFactor = (len / 100); 
                const targetX = closest.x + (closest.vx * predictionFactor);
                const targetY = closest.y + (closest.vy * predictionFactor);

                io.to(roomId).emit('bot_fired', {
                    botId: bot.id,
                    x: Math.round(bot.x), 
                    y: Math.round(bot.y),
                    targetX: Math.round(targetX), 
                    targetY: Math.round(targetY)
                });
            }
        }

        const botsPayload = Object.values(r.bots).map(b => ({
            id: b.id, x: Math.round(b.x), y: Math.round(b.y), heading: Math.round(b.heading), hp: b.hp
        }));
        io.to(roomId).emit('bots_update', botsPayload);
    }, TICK_MS);
}

function spawnWave(roomId) {
    const room = rooms[roomId];
    if (!room || room.wiped) return;

    room.bots = {};
    const count = botCountForWave(room.wave);
    const hpVal = botHPForWave(room.wave);
    const chaserCount = getChaserCountForWave(room.wave);

    let cx = 0, cy = 0, n = 0;
    for (const uid in room.players) {
        cx += room.players[uid].x;
        cy += room.players[uid].y;
        n++;
    }
    if (n > 0) { cx /= n; cy /= n; }
    else { cx = WORLD_SIZE / 2; cy = WORLD_SIZE / 2; }

    for (let i = 0; i < count; i++) {
        const sp = randomSpawnNearSafe(cx, cy, BOT_SPAWN_MIN_DIST, BOT_SPAWN_MAX_DIST, room.islands || []);
        const id = room.botIdCounter++;
        const isChaserBot = (i < chaserCount);

        room.bots[id] = {
            id, x: sp.x, y: sp.y,
            heading: rnd(0, 360),
            hp: hpVal,
            fireTimer: 0,
            isChaser: isChaserBot
        };
    }

    io.to(roomId).emit('wave_start', { wave: room.wave, count });
    
    const botsPayload = Object.values(room.bots).map(b => ({
        id: b.id, x: Math.round(b.x), y: Math.round(b.y), heading: Math.round(b.heading), hp: b.hp
    }));
    io.to(roomId).emit('bots_update', botsPayload);
}

let cachedLeaderboard = [];
let lastFetch = 0;
const CACHE_MS = 10000;

async function fetchLeaderboard() {
    const now = Date.now();
    if (now - lastFetch < CACHE_MS && cachedLeaderboard.length > 0) return cachedLeaderboard;
    try {
        const res = await fetch(DB_URL + "/users.json");
        if (!res.ok) return cachedLeaderboard;
        const data = await res.json();
        if (!data) return cachedLeaderboard;
        const arr = Object.values(data).map(u => ({
            name: u.username || "Commander",
            kills: u.total_kills || 0,
            level: u.level || 1
        }));
        arr.sort((a, b) => b.level - a.level || b.kills - a.kills);
        cachedLeaderboard = arr.slice(0, 5);
        lastFetch = now;
        return cachedLeaderboard;
    } catch (e) { return cachedLeaderboard; }
}

function sendLeaderboard(roomId) {
    fetchLeaderboard().then(top => {
        io.to(roomId).emit('leaderboard_update', top);
    }).catch(() => {});
}

function fetchUserKills(uid, callback) {
    if (!uid) return callback(0);
    fetch(DB_URL + "/users/" + uid + "/total_kills.json")
        .then(res => res.json())
        .then(v => {
            const current = (typeof v === 'number') ? v : 0;
            callback(current);
        })
        .catch(() => callback(0));
}

function pushUserStatsAsync(uid, kills, level) {
    if (!uid) return;
    if (kills != null) {
        fetch(DB_URL + "/users/" + uid + "/total_kills.json", {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kills)
        }).catch(() => {});
    }
    if (level != null && level > 0) {
        fetch(DB_URL + "/users/" + uid + "/level.json", {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(level)
        }).catch(() => {});
    }
    lastFetch = 0;
}

function flushWaveStats(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    for (const uid in room.players) {
        const pl = room.players[uid];
        if (!pl.uid) continue;

        fetchUserKills(pl.uid, (oldKills) => {
            const newTotal = oldKills + (pl.kills || 0);
            pushUserStatsAsync(pl.uid, newTotal, pl.level);
            pl.kills = 0;
        });
    }
    sendLeaderboard(roomId);
}

io.on('connection', (socket) => {

    socket.on('check_active_session', (data) => {
        const { uid } = data || {};
        if (!uid) {
            socket.emit('no_active_session');
            return;
        }

        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.wiped) continue;

            const player = room.players[uid];
            if (player) {
                const anyAlive = Object.values(room.players).some(p => p.hp > 0);
                if (anyAlive) {
                    socket.emit('active_session_found', {
                        roomId: roomId,
                        wave: room.wave,
                        level: player.level,
                        hp: player.hp,
                        maxHp: player.maxHp, 
                        maxSpeed: player.maxSpeed, 
                        x: Math.round(player.x),
                        y: Math.round(player.y),
                        heading: Math.round(player.heading),
                        islands: room.islands,
                        hullId: player.hullId,
                        skinPath: player.skinPath
                    });
                    return;
                }
            }
        }

        if (wipedRoomsLog.has(uid)) {
            wipedRoomsLog.delete(uid);
            socket.emit('previous_team_wipe');
            return;
        }

        socket.emit('no_active_session');
    });

    socket.on('reconnect_session', (data) => {
        const { uid, roomId, hullId, skinPath, finisherId } = data || {};
        const room = rooms[roomId];
        if (!room || room.wiped) {
            socket.emit('session_recovery_failed');
            return;
        }

        const player = room.players[uid];
        if (player) {
            if (player.deathTimer) {
                clearTimeout(player.deathTimer);
                player.deathTimer = null;
            }

            player.online = true;
            player.id = socket.id;
            
            if (hullId && hullId !== player.hullId) {
                player.hullId = hullId;
                const stats = getShipStats(hullId);
                player.maxHp = stats.hp;
                player.maxSpeed = stats.speed;
                if (player.hp > player.maxHp) player.hp = player.maxHp; 
            }
            
            if (skinPath) player.skinPath = skinPath;
            if (finisherId) player.finisherId = finisherId;

            socket.join(roomId);
            socket.currentRoom = roomId;
            socket.username = player.name;
            socket.uid = player.uid;
            socket.mode = room.mode;

            socket.emit('session_recovered', {
                wave: room.wave,
                level: player.level,
                hp: player.hp,
                maxHp: player.maxHp, 
                maxSpeed: player.maxSpeed,
                hullId: player.hullId,
                skinPath: player.skinPath
            });

            socket.to(roomId).emit('player_joined', {
                id: socket.id, name: player.name, 
                x: Math.round(player.x), y: Math.round(player.y), 
                heading: Math.round(player.heading), 
                hullId: player.hullId, skinPath: player.skinPath, finisherId: player.finisherId
            });

            const existing = Object.values(room.players)
                .filter(p => p.uid !== uid)
                .map(p => ({ 
                    id: p.id, name: p.name, 
                    x: Math.round(p.x), y: Math.round(p.y), 
                    heading: Math.round(p.heading), 
                    hullId: p.hullId, skinPath: p.skinPath, finisherId: p.finisherId 
                }));
            socket.emit('room_state', { players: existing, wave: room.wave });
            
            const botsPayload = Object.values(room.bots).map(b => ({
                id: b.id, x: Math.round(b.x), y: Math.round(b.y), heading: Math.round(b.heading), hp: b.hp
            }));
            socket.emit('bots_update', botsPayload);
        } else {
            socket.emit('session_recovery_failed');
        }
    });

    socket.on('join_match', (data) => {
        const { mode, username, uid, level, total_kills, islands, hullId, skinPath, finisherId } = data || {};

        if (socket.currentRoom) {
            const oldRoom = rooms[socket.currentRoom];
            if (oldRoom && socket.uid && oldRoom.players[socket.uid]) {
                if (oldRoom.players[socket.uid].deathTimer) clearTimeout(oldRoom.players[socket.uid].deathTimer);
                delete oldRoom.players[socket.uid];
                io.to(socket.currentRoom).emit('player_left', { id: socket.id });
                if (Object.keys(oldRoom.players).length === 0) endRoom(socket.currentRoom);
            }
            socket.leave(socket.currentRoom);
        }
        cleanSocket(socket);

        for (const rId in rooms) {
            const r = rooms[rId];
            if (r.players[uid]) {
                if (r.players[uid].deathTimer) clearTimeout(r.players[uid].deathTimer);
                delete r.players[uid];
                io.to(rId).emit('player_left', { id: socket.id });
                if (Object.keys(r.players).length === 0) endRoom(rId);
            }
        }

        socket.username = username || 'Commander';
        socket.uid = uid || '';
        socket.mode = mode || '4VBOT';
        socket.startLevel = Math.max(1, level || 1);

        if (socket.mode !== '1VBOT' && socket.mode !== '4VBOT') {
            socket.emit('mode_rejected');
            return;
        }

        let roomId = findOpenRoom(socket.mode);
        if (!roomId) roomId = createRoom(socket.mode, socket.startLevel + 1);

        const room = rooms[roomId];
        if (islands && Array.isArray(islands) && islands.length > 0 && room.islands.length === 0) {
            room.islands = islands;
        }

        socket.join(roomId);
        socket.currentRoom = roomId;

        let sx = WORLD_SIZE / 2, sy = WORLD_SIZE / 2;
        let bestDist = -1;
        for (let attempt = 0; attempt < 40; attempt++) {
            const cand = randomSpawnNearSafe(WORLD_SIZE / 2, WORLD_SIZE / 2, 300, 1500, room.islands || []);
            let minD = Infinity;
            for (const bid in room.bots) {
                const b = room.bots[bid];
                const d = dist2(cand.x, cand.y, b.x, b.y);
                if (d < minD) minD = d;
            }
            if (minD > bestDist) { bestDist = minD; sx = cand.x; sy = cand.y; }
            if (bestDist > 4000 * 4000) break;
        }

        const validHullId = hullId || 'bot';
        const stats = getShipStats(validHullId);

        room.players[socket.uid] = {
            id: socket.id,
            uid: socket.uid,
            name: socket.username,
            x: sx, y: sy, heading: 0,
            maxHp: stats.hp,       
            hp: stats.hp,          
            maxSpeed: stats.speed, 
            kills: 0,
            level: socket.startLevel,
            online: true,
            deathTimer: null,
            hullId: validHullId,
            skinPath: skinPath || 'bt/bot/bot.png',
            finisherId: finisherId || 'none'
        };

        socket.emit('match_found', {
            matchId: roomId,
            role: 'Player',
            spawnX: Math.round(sx), 
            spawnY: Math.round(sy), 
            spawnHeading: 0,
            opponentId: '',
            serverId: socket.id,
            wave: room.wave,
            playerLevel: room.players[socket.uid].level,
            mode: socket.mode,
            maxHp: stats.hp,       
            maxSpeed: stats.speed, 
            islands: room.islands || [],
            hullId: room.players[socket.uid].hullId,
            skinPath: room.players[socket.uid].skinPath
        });

        const existing = Object.values(room.players)
            .filter(p => p.uid !== socket.uid)
            .map(p => ({ 
                id: p.id, name: p.name, 
                x: Math.round(p.x), y: Math.round(p.y), 
                heading: Math.round(p.heading), 
                hullId: p.hullId, skinPath: p.skinPath, finisherId: p.finisherId 
            }));
        socket.emit('room_state', { players: existing, wave: room.wave });

        socket.to(roomId).emit('player_joined', {
            id: socket.id, name: socket.username, 
            x: Math.round(sx), y: Math.round(sy), 
            heading: 0, hullId: room.players[socket.uid].hullId, 
            skinPath: room.players[socket.uid].skinPath, 
            finisherId: room.players[socket.uid].finisherId
        });

        const botsPayload = Object.values(room.bots).map(b => ({
            id: b.id, x: Math.round(b.x), y: Math.round(b.y), heading: Math.round(b.heading), hp: b.hp
        }));
        socket.emit('bots_update', botsPayload);

        if (Object.keys(room.bots).length === 0) spawnWave(roomId);

        sendLeaderboard(roomId);
    });

    socket.on('player_moved', (data) => {
        const room = rooms[socket.currentRoom];
        if (!room || !room.players[socket.uid]) return;
        const p = room.players[socket.uid];
        p.x = data.x; p.y = data.y; p.heading = data.heading;
        if (data.hullId && data.hullId !== p.hullId) {
            p.hullId = data.hullId;
        }
        if (data.skinPath) p.skinPath = data.skinPath; 
        if (data.finisherId) p.finisherId = data.finisherId;
        
        socket.to(socket.currentRoom).emit('player_moved', {
            id: socket.id, 
            x: Math.round(p.x), 
            y: Math.round(p.y), 
            heading: Math.round(p.heading), 
            hullId: p.hullId, skinPath: p.skinPath, finisherId: p.finisherId
        });
    });

    socket.on('hit_bot', (data) => {
        const room = rooms[socket.currentRoom];
        if (!room || room.wiped) return;
        const bot = room.bots[data.botId];
        if (!bot || bot.hp <= 0) return;

        bot.hp -= 1;

        if (bot.hp <= 0) {
            delete room.bots[data.botId];
            const p = room.players[socket.uid];
            if (p) p.kills += 1;

            const isLastBot = (Object.keys(room.bots).length === 0);

            io.to(socket.currentRoom).emit('bot_killed', {
                botId: data.botId,
                byId: socket.id,
                byName: p ? p.name : '?',
                finisherId: data.finisherId || 'none',
                isLastBot: isLastBot
            });

            if (isLastBot) {
                const clearedWave = room.wave; 
                room.wave += 1;

                for (const uid in room.players) {
                    const pl = room.players[uid];
                    if (clearedWave >= pl.level) pl.level += 1;
                    pl.hp = pl.maxHp; 
                }

                flushWaveStats(socket.currentRoom);

                for (const uid in room.players) {
                    const pl = room.players[uid];
                    if (pl.online && pl.id) {
                        io.to(pl.id).emit('level_up', { wave: room.wave, level: pl.level });
                        io.to(pl.id).emit('hp_update', { hp: pl.hp }); 
                    }
                }

                setTimeout(() => {
                    spawnWave(socket.currentRoom);
                }, 2500);
            }
        } else {
            io.to(socket.currentRoom).emit('bot_hp', { botId: data.botId, hp: bot.hp });
        }
    });

    socket.on('bot_hit_player', (data) => {
        const room = rooms[socket.currentRoom];
        if (!room || room.wiped) return;
        const p = room.players[socket.uid];
        if (!p || p.hp <= 0) return;

        p.hp -= data.damage || 15;
        if (p.hp <= 0) {
            p.hp = 0;
            io.to(socket.currentRoom).emit('player_died', { id: socket.id, name: p.name });

            const roomIdAtDeath = socket.currentRoom;
            const uidAtDeath = socket.uid;

            setTimeout(() => {
                const r = rooms[roomIdAtDeath];
                if (!r || r.wiped) return;

                const onlineAlive = Object.values(r.players).filter(pl => pl.online && pl.hp > 0);

                if (onlineAlive.length === 0) {
                    for (const uid in r.players) {
                        const pl = r.players[uid];
                        if (pl.hp > 0) pl.hp = 0;
                    }
                }

                const allDead = Object.values(r.players).every(pl => pl.hp <= 0);

                if (allDead && Object.keys(r.players).length > 0) {
                    for (const uid in r.players) {
                        const pl = r.players[uid];
                        pl.level = Math.max(1, pl.level - 1);
                    }

                    flushWaveStats(roomIdAtDeath);
                    io.to(roomIdAtDeath).emit('team_wipe');

                    for (const uid in r.players) { wipedRoomsLog.add(uid); }
                    endRoom(roomIdAtDeath);
                    return;
                }

                const currentPlayer = r.players[uidAtDeath];
                if (currentPlayer && currentPlayer.hp <= 0) {
                    const sp = randomSpawnNearSafe(WORLD_SIZE / 2, WORLD_SIZE / 2, 300, 1200, r.islands || []);
                    currentPlayer.x = sp.x;
                    currentPlayer.y = sp.y;
                    currentPlayer.hp = currentPlayer.maxHp; 
                    if (currentPlayer.online && currentPlayer.id) {
                        io.to(currentPlayer.id).emit('player_respawned', { 
                            x: Math.round(sp.x), 
                            y: Math.round(sp.y) 
                        });
                    }
                }
            }, RESPAWN_MS);
        } else {
            io.to(socket.id).emit('hp_update', { hp: p.hp });
        }
    });

    socket.on('leave_match', () => leaveRoom(socket, true));
    socket.on('disconnect', () => leaveRoom(socket, false));
});

function leaveRoom(socket, immediate) {
    const roomId = socket.currentRoom;
    const room = roomId ? rooms[roomId] : null;

    if (!room) {
        cleanSocket(socket);
        return;
    }

    const player = room.players[socket.uid];
    if (!player) {
        cleanSocket(socket);
        return;
    }

    if (immediate) {
        if (player.deathTimer) clearTimeout(player.deathTimer);
        
        if (player.uid) {
            fetchUserKills(player.uid, (oldKills) => {
                const newTotal = oldKills + (player.kills || 0);
                pushUserStatsAsync(player.uid, newTotal, player.level);
                
                delete room.players[socket.uid];
                io.to(roomId).emit('player_left', { id: socket.id });
                socket.leave(roomId);
                cleanSocket(socket);

                if (Object.keys(room.players).length === 0) endRoom(roomId);
            });
        } else {
            delete room.players[socket.uid];
            io.to(roomId).emit('player_left', { id: socket.id });
            socket.leave(roomId);
            cleanSocket(socket);

            if (Object.keys(room.players).length === 0) endRoom(roomId);
        }
    } else {
        player.online = false;
        io.to(roomId).emit('player_left', { id: socket.id });

        player.deathTimer = setTimeout(() => {
            const r = rooms[roomId];
            if (!r || r.wiped) return;

            const p = r.players[socket.uid];
            if (!p || p.online) return;

            p.hp = 0;
            p.deathTimer = null;

            delete r.players[socket.uid];
            if (Object.keys(r.players).length === 0) {
                flushWaveStats(roomId);
                endRoom(roomId);
            }
        }, OFFLINE_DEATH_MS);
    }
}

function endRoom(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.wiped = true;

    if (room.botTickInterval) clearInterval(room.botTickInterval);

    for (const uid in room.players) {
        const p = room.players[uid];
        if (p.deathTimer) clearTimeout(p.deathTimer);
        if (!p.id) continue;
        const s = io.sockets.sockets.get(p.id);
        if (s) {
            s.leave(roomId);
            cleanSocket(s);
        }
    }
    delete rooms[roomId];
}

setInterval(() => {
    for (const id in rooms) {
        if (Object.keys(rooms[id].players).length === 0) endRoom(id);
    }
}, 60000);

server.listen(PORT, () => { });
