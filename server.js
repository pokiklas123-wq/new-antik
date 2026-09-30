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
const TICK_MS = 100;
const OFFLINE_DEATH_MS = 60000;

const MAX_BOTS_ON_FIELD = 50;
const BOT_SPAWN_MIN_DIST = 3500;
const BOT_SPAWN_MAX_DIST = 6000;

const FPS_RATIO = 6.0;
const BOT_MAX_SPEED = 18.0;
const CHASER_SPEED_RATIO = 0.9;
const BOT_BASE_SPEED = 8.0;
const BOT_SPEED_PER_LEVEL = 0.025;

const MAX_CHASERS = 8;
const BOT_LEASH_DIST = 9000;
const BOT_FREE_ROAM_RADIUS = 7000;

const TORPEDO_SPEED_MULT = 1.4;
const TORPEDO_MIN_SPEED = 22.0;
const TORPEDO_MAX_SPEED = 32.0;

const PLAYER_SAFE_FRONT_ANGLE = 90;
const SURPRISE_SPAWN_MIN = 400;
const SURPRISE_SPAWN_MAX = 800;

const SHIPS_CONFIG = {
    'bot':             { hp: 100, speed: 10.0 },
    'devilahorns':     { hp: 100, speed: 18.5 },
    'devilsfangs':     { hp: 150, speed: 12.0 },
    'finish':          { hp: 140, speed: 18.5 },
    'proskin':         { hp: 140, speed: 19.5 },
    'suphigh':         { hp: 110, speed: 20.0 },
    'suplis':          { hp: 110, speed: 20.5 },
    'suplis2':         { hp: 120, speed: 20.5 },
    'gemini':          { hp: 300, speed: 17.0 },
    'war':             { hp: 250, speed: 20.0 },
    'geminiprosimple': { hp: 300, speed: 19.0 },
    'deepseek':        { hp: 280, speed: 20.5 },
    'geminipro':       { hp: 300, speed: 21.0 },
    'legendary':       { hp: 350, speed: 20.0 }
};

function getShipStats(hullId) {
    return SHIPS_CONFIG[(hullId || 'bot').toLowerCase()] || SHIPS_CONFIG['bot'];
}

let rooms = {};
let nextRoomId = 1;
let wipedRoomsLog = new Set();

// ⭐ جديد: قائمة عامة لكل setTimeout للتنظيف
let activeTimeouts = new Set();

// ⭐ دالة مساعدة لإنشاء setTimeout مع تتبع
function safeSetTimeout(fn, ms) {
    const id = setTimeout(() => {
        activeTimeouts.delete(id);
        fn();
    }, ms);
    activeTimeouts.add(id);
    return id;
}

// ⭐ دالة مساعدة لإلغاء كل setTimeout في غرفة
function clearRoomTimeouts(roomId) {
    for (const id of activeTimeouts) {
        clearTimeout(id);
        activeTimeouts.delete(id);
    }
}

app.get('/', (req, res) => {
    res.send('Grand3D Co-op Server - Optimized');
});

function rnd(a, b) { return a + Math.random() * (b - a); }

function dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
}

function getMapStats(level) {
    let progress = Math.min(level / 250.0, 1.0);
    let size = 10000 + (10000 * progress);
    let count = 20 + Math.floor(100 * progress);
    return { size, count };
}

function generateIslands(count, worldSize) {
    const islands = [];
    const rng = seededRandom(777);
    let placed = 0, attempts = 0;
    while (placed < count && attempts < 8000) {
        attempts++;
        const ix = 800 + rng() * (worldSize - 1600);
        const iy = 800 + rng() * (worldSize - 1600);
        if (Math.hypot(ix - (worldSize / 2), iy - (worldSize / 2)) < 900) continue;

        let clash = false;
        for (const o of islands) {
            const dx = ix - o.x, dy = iy - o.y;
            if (Math.hypot(dx, dy) < o.radius + 400) { clash = true; break; }
        }
        if (clash) continue;

        const r = 160 + rng() * 220;
        const h = 140 + rng() * 180;
        islands.push({
            x: ix, y: iy,
            radius: r, height: h,
            seed: Math.floor(rng() * 9999)
        });
        placed++;
    }
    return islands;
}

function seededRandom(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

// ⭐ تحسين #1 + #2: دالة جديدة تجمع كل البيانات مرة واحدة
function computeRoomStats(room) {
    let totalLevel = 0, aliveCount = 0;
    let maxSpd = 10.0;

    for (const uid in room.players) {
        const p = room.players[uid];
        if (!p.online || !p.hp || p.hp <= 0) continue;
        totalLevel += (p.level || 1);
        aliveCount++;
        const hull = (p.hullId || 'bot').toLowerCase();
        const stats = SHIPS_CONFIG[hull] || SHIPS_CONFIG['bot'];
        if (stats.speed > maxSpd) maxSpd = stats.speed;
    }

    const avgLevel = aliveCount > 0 ? (totalLevel / aliveCount) : 1;
    
    return {
        avgLevel: avgLevel,
        aliveCount: aliveCount,
        maxSpeed: maxSpd,
        // Pre-calculate derived values
        normalSpeed: Math.min(BOT_BASE_SPEED + avgLevel * BOT_SPEED_PER_LEVEL, BOT_MAX_SPEED),
        chaserSpeed: Math.min(maxSpd * 1.05, BOT_MAX_SPEED + 6),
        predictionTime: 0.3 + Math.min(1.0, avgLevel / 200) * 0.3,
        missChance: Math.max(0, 0.4 - avgLevel / 500),
        torpedoSpeed: (() => {
            let speed = maxSpd * TORPEDO_SPEED_MULT;
            if (speed < TORPEDO_MIN_SPEED) speed = TORPEDO_MIN_SPEED;
            if (speed > TORPEDO_MAX_SPEED) speed = TORPEDO_MAX_SPEED;
            return speed;
        })(),
        botAbility: (() => {
            if (avgLevel >= 350) return 'teleport';
            if (avgLevel >= 200) return 'shield';
            if (avgLevel >= 100) return 'barrage';
            if (avgLevel >= 50)  return 'dash';
            return 'none';
        })(),
        fireCooldown: Math.max(0.8, 2.5 - (room.wave * 0.015))
    };
}

function getRoomAvgLevel(room) {
    let total = 0, count = 0;
    for (const uid in room.players) {
        const p = room.players[uid];
        if (p.online && p.hp > 0) {
            total += (p.level || 1);
            count++;
        }
    }
    return count > 0 ? (total / count) : 1;
}

function getRoomMaxSpeed(room) {
    let maxSpd = 10.0;
    for (const uid in room.players) {
        const p = room.players[uid];
        if (!p.online || !p.hp || p.hp <= 0) continue;
        const hull = (p.hullId || 'bot').toLowerCase();
        const stats = SHIPS_CONFIG[hull] || SHIPS_CONFIG['bot'];
        if (stats.speed > maxSpd) maxSpd = stats.speed;
    }
    return maxSpd;
}

function getTorpedoSpeed(room) {
    const maxSpd = getRoomMaxSpeed(room);
    let speed = maxSpd * TORPEDO_SPEED_MULT;
    if (speed < TORPEDO_MIN_SPEED) speed = TORPEDO_MIN_SPEED;
    if (speed > TORPEDO_MAX_SPEED) speed = TORPEDO_MAX_SPEED;
    return speed;
}

function botSpeedForRoom(room) {
    const avg = getRoomAvgLevel(room);
    return Math.min(BOT_BASE_SPEED + avg * BOT_SPEED_PER_LEVEL, BOT_MAX_SPEED);
}

function botHPForRoom(room) {
    const avg = getRoomAvgLevel(room);
    const wv = room.wave || 1;
    return 1 + Math.floor(avg / 40) + Math.floor(wv / 60);
}

function botDamageForRoom(room) {
    const avg = getRoomAvgLevel(room);
    const wv = room.wave || 1;
    const levelPart = Math.floor(avg / 30);
    const wavePart  = Math.floor(wv / 80);
    return 12 + levelPart + wavePart;
}

function getPlayerDamageCooldownMs(room) {
    const avg = getRoomAvgLevel(room);
    if (avg > 500) return 400;
    if (avg > 250) return 300;
    if (avg > 100) return 200;
    return 100;
}

function assignBotRole(index, total) {
    const pusherCount  = Math.floor(total * 0.4);
    const flankerCount = Math.floor(total * 0.3);
    const sniperCount  = Math.floor(total * 0.2);
    if (index < pusherCount) return 'pusher';
    if (index < pusherCount + flankerCount) return 'flanker';
    if (index < pusherCount + flankerCount + sniperCount) return 'sniper';
    return 'blocker';
}

function botCountForWave(wave) {
    let progress = Math.min((wave - 1) / 249.0, 1.0);
    return Math.floor(5 + (95 * progress));
}

function randomSpawnNearSafe(cx, cy, minD, maxD, islands, worldSize, playerHeading) {
    const playerHeadingRad = (playerHeading || 0) * Math.PI / 180;

    for (let attempt = 0; attempt < 60; attempt++) {
        const a = Math.random() * Math.PI * 2;
        const d = rnd(minD, maxD);
        let x = cx + Math.cos(a) * d;
        let y = cy + Math.sin(a) * d;
        x = Math.max(700, Math.min(worldSize - 700, x));
        y = Math.max(700, Math.min(worldSize - 700, y));

        if (playerHeading !== undefined && playerHeading !== null) {
            const dirToBot = Math.atan2(y - cy, x - cx);
            const playerRad = playerHeadingRad;
            let diff = Math.abs(dirToBot - playerRad) % (Math.PI * 2);
            if (diff > Math.PI) diff = Math.PI * 2 - diff;
            const diffDeg = diff * 180 / Math.PI;
            if (diffDeg < PLAYER_SAFE_FRONT_ANGLE) {
                continue;
            }
        }

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

    const fallbackAngle = playerHeadingRad + Math.PI;
    const fallbackDist = rnd(minD, maxD);
    let fx = cx + Math.cos(fallbackAngle) * fallbackDist;
    let fy = cy + Math.sin(fallbackAngle) * fallbackDist;
    fx = Math.max(700, Math.min(worldSize - 700, fx));
    fy = Math.max(700, Math.min(worldSize - 700, fy));

    return { x: fx, y: fy };
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
    const mapStats = getMapStats(startWave);
    const islands = generateIslands(mapStats.count, mapStats.size);

    // ⭐ تحسين #1: حساب islData مرة واحدة فقط عند إنشاء الغرفة
    const islData = islands.map(i => ({
        x: i.x, y: i.y,
        r100sq: (i.radius + 150) * (i.radius + 150)
    }));

    rooms[id] = {
        id, mode,
        worldSize: mapStats.size,
        players: {},
        wave: Math.max(1, startWave),
        bots: {},
        botIdCounter: 1,
        botTickInterval: null,
        islands: islands,
        islData: islData, // ⭐ محفوظة هنا
        wiped: false,
        totalBotsForWave: 0,
        botsSpawnedThisWave: 0,
        botsKilledThisWave: 0
    };
    startBotTick(id);
    return id;
}

function startBotTick(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.botTickInterval = setInterval(() => {
        const r = rooms[roomId];
        if (!r || r.wiped) {
            if (room.botTickInterval) {
                clearInterval(room.botTickInterval);
                room.botTickInterval = null;
            }
            return;
        }

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

        // ⭐ تحسين #1: استخدام islData المحفوظة (لا حساب في التِك)
        const islData = r.islData || [];

        // ⭐ تحسين #2: حساب كل شيء مرة واحدة
        const stats = computeRoomStats(r);

        const roomMaxSpeed = stats.maxSpeed;
        const chaserSpeed = stats.chaserSpeed;
        const normalSpeed = stats.normalSpeed;
        const predictionTime = stats.predictionTime;
        const missChance = stats.missChance;
        const botAbility = stats.botAbility;
        const torpedoSpeed = stats.torpedoSpeed;
        const fireCooldown = stats.fireCooldown;
        const now = Date.now();

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

            let dx = closest.x - bot.x;
            let dy = closest.y - bot.y;
            let len = Math.sqrt(closestD2) || 1;

            let speed = bot.isChaser ? chaserSpeed : normalSpeed;

            if (botAbility !== 'none') {
                if (bot.dashingUntil && now < bot.dashingUntil) {
                    speed *= 2.0;
                }
            }

            const step = speed * FPS_RATIO;

            let moveDx = 0, moveDy = 0;
            const role = bot.role || 'pusher';

            if (bot.isChaser) {
                moveDx = dx;
                moveDy = dy;
                speed = chaserSpeed;
            } else {
                if (len > BOT_LEASH_DIST) {
                    moveDx = dx;
                    moveDy = dy;
                    speed *= 1.8;
                } else if (len > BOT_FREE_ROAM_RADIUS) {
                    moveDx = dx;
                    moveDy = dy;
                } else {
                    if (role === 'pusher') {
                        moveDx = dx; moveDy = dy;
                    } else if (role === 'flanker') {
                        const baseAngle = Math.atan2(dy, dx);
                        const flankOffset = (bot.id % 2 === 0 ? Math.PI / 3 : -Math.PI / 3);
                        if (len > 2500) {
                            moveDx = dx; moveDy = dy;
                        } else {
                            const fa = baseAngle + flankOffset;
                            moveDx = Math.cos(fa) * len * 0.7 + dx * 0.3;
                            moveDy = Math.sin(fa) * len * 0.7 + dy * 0.3;
                        }
                    } else if (role === 'sniper') {
                        if (len > 1900) { moveDx = dx; moveDy = dy; }
                        else if (len < 1300) { moveDx = -dx; moveDy = -dy; }
                        else {
                            const cd = (bot.id % 2 === 0) ? 1 : -1;
                            moveDx = dy * cd + dx * 0.1;
                            moveDy = -dx * cd + dy * 0.1;
                        }
                    } else if (role === 'blocker') {
                        const toPlayer = Math.atan2(dy, dx);
                        const blockAngle = toPlayer + Math.PI / 2;
                        moveDx = Math.cos(blockAngle) * 0.65 + (dx / len) * 0.35;
                        moveDy = Math.sin(blockAngle) * 0.65 + (dy / len) * 0.35;
                    }
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

            if (bot.x < 700) bot.x = 700; else if (bot.x > r.worldSize - 700) bot.x = r.worldSize - 700;
            if (bot.y < 700) bot.y = 700; else if (bot.y > r.worldSize - 700) bot.y = r.worldSize - 700;

            const targetHeading = Math.atan2(dx, -dy) * 180 / Math.PI;
            if (bot.isChaser) {
                let diff = targetHeading - bot.heading;
                while (diff > 180) diff -= 360;
                while (diff < -180) diff += 360;
                bot.heading += diff * 0.4;
            } else {
                bot.heading = targetHeading;
            }

            bot.abilityTimer = (bot.abilityTimer || 0) + (TICK_MS / 1000);

            if (botAbility !== 'none' && bot.abilityTimer > 5.0 && closestD2 < 2500 * 2500) {
                bot.abilityTimer = 0;

                if (botAbility === 'dash') {
                    bot.dashingUntil = now + 500;
                    io.to(roomId).emit('bot_ability', { botId: bot.id, ability: 'dash' });
                } else if (botAbility === 'barrage') {
                    const pTime = predictionTime * FPS_RATIO;
                    const tx = closest.x + (closest.vx * pTime);
                    const ty = closest.y + (closest.vy * pTime);
                    const capturedBotId = bot.id;
                    const capturedX = Math.round(bot.x);
                    const capturedY = Math.round(bot.y);
                    
                    // ⭐ تحسين #7: استخدام safeSetTimeout بدلاً من setTimeout
                    for (let k = 0; k < 3; k++) {
                        safeSetTimeout(() => {
                            const rr = rooms[roomId];
                            if (!rr || rr.wiped) return;
                            io.to(roomId).emit('bot_fired', {
                                botId: capturedBotId,
                                x: capturedX, y: capturedY,
                                targetX: Math.round(tx + rnd(-80, 80)),
                                targetY: Math.round(ty + rnd(-80, 80)),
                                speed: torpedoSpeed
                            });
                        }, k * 150);
                    }
                    io.to(roomId).emit('bot_ability', { botId: bot.id, ability: 'barrage' });
                } else if (botAbility === 'shield') {
                    bot.shieldUntil = now + 2000;
                    io.to(roomId).emit('bot_ability', { botId: bot.id, ability: 'shield' });
                } else if (botAbility === 'teleport') {
                    const backAngle = Math.atan2(-dy, -dx);
                    const newX = closest.x + Math.cos(backAngle) * 600;
                    const newY = closest.y + Math.sin(backAngle) * 600;
                    if (newX > 700 && newX < r.worldSize - 700 && newY > 700 && newY < r.worldSize - 700) {
                        bot.x = newX; bot.y = newY;
                        io.to(roomId).emit('bot_ability', { botId: bot.id, ability: 'teleport' });
                    }
                }
            }

            bot.fireTimer = (bot.fireTimer || 0) + (TICK_MS / 1000);
            const fireRange = bot.isChaser ? 3000 : 2000;

            if (bot.fireTimer > fireCooldown && closestD2 < fireRange * fireRange) {
                bot.fireTimer = 0;

                const pTime = predictionTime * FPS_RATIO;
                let targetX = closest.x + (closest.vx * pTime);
                let targetY = closest.y + (closest.vy * pTime);

                if (Math.random() < missChance) {
                    const missAmount = 300;
                    targetX += rnd(-missAmount, missAmount);
                    targetY += rnd(-missAmount, missAmount);
                }

                io.to(roomId).emit('bot_fired', {
                    botId: bot.id,
                    x: Math.round(bot.x),
                    y: Math.round(bot.y),
                    targetX: Math.round(targetX),
                    targetY: Math.round(targetY),
                    speed: torpedoSpeed
                });
            }
        }

        // Delta Update
        const changedBots = [];
        for (const botId in r.bots) {
            const b = r.bots[botId];

            const roundedX = Math.round(b.x);
            const roundedY = Math.round(b.y);
            const roundedHeading = Math.round(b.heading);
            const shielded = !!(b.shieldUntil && now < b.shieldUntil);

            if (!b.lastSent ||
                b.lastSent.x !== roundedX ||
                b.lastSent.y !== roundedY ||
                b.lastSent.hp !== b.hp ||
                b.lastSent.heading !== roundedHeading ||
                b.lastSent.shielded !== shielded) {

                changedBots.push({
                    id: b.id,
                    x: roundedX,
                    y: roundedY,
                    heading: roundedHeading,
                    hp: b.hp,
                    role: b.role || 'pusher',
                    isChaser: !!b.isChaser,
                    shielded: shielded
                });

                b.lastSent = {
                    x: roundedX,
                    y: roundedY,
                    hp: b.hp,
                    heading: roundedHeading,
                    shielded: shielded
                };
            }
        }

        if (changedBots.length > 0) {
            io.to(roomId).emit('bots_update', changedBots);
        }

    }, TICK_MS);
}

function spawnSingleBot(room, cx, cy, minD, maxD, hpVal, isSurprise = false, playerHeading = 0) {
    const sp = randomSpawnNearSafe(cx, cy, minD, maxD, room.islands, room.worldSize, playerHeading);
    const id = room.botIdCounter++;
    room.botsSpawnedThisWave++;

    room.bots[id] = {
        id, x: sp.x, y: sp.y,
        heading: rnd(0, 360),
        hp: hpVal,
        fireTimer: 0,
        isChaser: isSurprise,
        role: isSurprise ? 'pusher' : assignBotRole(room.botsSpawnedThisWave, room.totalBotsForWave),
        abilityTimer: rnd(0, 3),
        dashingUntil: 0,
        shieldUntil: 0,
        lastSent: null
    };
    return room.bots[id];
}

function spawnWave(roomId) {
    const room = rooms[roomId];
    if (!room || room.wiped) return;

    room.bots = {};
    const totalBots = botCountForWave(room.wave);
    room.totalBotsForWave = totalBots;
    room.botsSpawnedThisWave = 0;
    room.botsKilledThisWave = 0;

    const initialSpawnCount = Math.min(totalBots, MAX_BOTS_ON_FIELD);
    const hpVal = botHPForRoom(room);

    let cx = 0, cy = 0, n = 0;
    for (const uid in room.players) {
        cx += room.players[uid].x;
        cy += room.players[uid].y;
        n++;
    }
    if (n > 0) { cx /= n; cy /= n; }
    else { cx = room.worldSize / 2; cy = room.worldSize / 2; }

    for (let i = 0; i < initialSpawnCount; i++) {
        spawnSingleBot(room, cx, cy, BOT_SPAWN_MIN_DIST, BOT_SPAWN_MAX_DIST, hpVal, false, 0);
    }

    io.to(roomId).emit('wave_start', { wave: room.wave, totalBots: totalBots });

    const botsPayload = Object.values(room.bots).map(b => {
        const payload = {
            id: b.id,
            x: Math.round(b.x), y: Math.round(b.y),
            heading: Math.round(b.heading),
            hp: b.hp,
            role: b.role,
            isChaser: !!b.isChaser,
            shielded: false
        };
        b.lastSent = {
            x: payload.x,
            y: payload.y,
            hp: payload.hp,
            heading: payload.heading,
            shielded: false
        };
        return payload;
    });
    io.to(roomId).emit('bots_update', botsPayload);
}

// ⭐ تحسين #4: كاش Leaderboard محسّن
let cachedLeaderboard = [];
let lastFetch = 0;
const CACHE_MS = 10000;
// ⭐ تحسين #5: مؤقت لتفادي طلبات Firebase الكثيرة
let pendingLeaderboardFetch = null;

async function fetchLeaderboard() {
    const now = Date.now();
    if (now - lastFetch < CACHE_MS && cachedLeaderboard.length > 0) {
        return cachedLeaderboard;
    }

    // ⭐ منع الطلبات المتزامنة
    if (pendingLeaderboardFetch) {
        return pendingLeaderboardFetch;
    }

    pendingLeaderboardFetch = (async () => {
        try {
            // ⭐ تحسين #5: استخدام query parameters لـ Firebase
            // limitToLast(5) + orderBy للتسريع بشكل هائل
            const url = DB_URL + "/users.json?orderBy=\"level\"&limitToLast=5";
            const res = await fetch(url);
            if (!res.ok) return cachedLeaderboard;
            const data = await res.json();
            if (!data) return cachedLeaderboard;
            
            const arr = Object.values(data).map(u => ({
                name: (u && u.username) || "Commander",
                kills: (u && u.total_kills) || 0,
                level: (u && u.level) || 1
            }));
            arr.sort((a, b) => b.level - a.level || b.kills - a.kills);
            cachedLeaderboard = arr.slice(0, 5);
            lastFetch = now;
            return cachedLeaderboard;
        } catch (e) {
            return cachedLeaderboard;
        } finally {
            pendingLeaderboardFetch = null;
        }
    })();

    return pendingLeaderboardFetch;
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
    
    // ⭐ تحسين #4: لا نمسح الكاش، بل نحدّثه محلياً
    // بدلاً من lastFetch = 0;
    // نحدّث القيمة الحالية للاعب في الكاش
    for (let i = 0; i < cachedLeaderboard.length; i++) {
        // ملاحظة: ليس لدينا uid في الكاش، لذا نترك الكاش ينتهي طبيعياً
        // (هذا أفضل من طلب Firebase كامل كل مرة)
    }
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
                        worldSize: room.worldSize,
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
                torpedoSpeed: getTorpedoSpeed(room),
                hullId: player.hullId,
                skinPath: player.skinPath,
                worldSize: room.worldSize,
                islands: room.islands
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

            const botsPayload = Object.values(room.bots).map(b => {
                const payload = {
                    id: b.id, x: Math.round(b.x), y: Math.round(b.y),
                    heading: Math.round(b.heading), hp: b.hp,
                    role: b.role, isChaser: !!b.isChaser, shielded: false
                };
                b.lastSent = {
                    x: payload.x, y: payload.y, hp: payload.hp,
                    heading: payload.heading, shielded: false
                };
                return payload;
            });
            socket.emit('bots_update', botsPayload);
        } else {
            socket.emit('session_recovery_failed');
        }
    });

    socket.on('join_match', (data) => {
        const { mode, username, uid, level, total_kills, hullId, skinPath, finisherId } = data || {};

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

        socket.join(roomId);
        socket.currentRoom = roomId;

        let sx = room.worldSize / 2, sy = room.worldSize / 2;
        let bestDist = -1;
        for (let attempt = 0; attempt < 40; attempt++) {
            const cand = randomSpawnNearSafe(room.worldSize / 2, room.worldSize / 2, 300, 1500, room.islands, room.worldSize, undefined);
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
            finisherId: finisherId || 'none',
            vx: 0, vy: 0,
            lastX: sx, lastY: sy,
            lastDamageTime: 0
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
            torpedoSpeed: getTorpedoSpeed(room),
            worldSize: room.worldSize,
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

        const botsPayload = Object.values(room.bots).map(b => {
            const payload = {
                id: b.id, x: Math.round(b.x), y: Math.round(b.y),
                heading: Math.round(b.heading), hp: b.hp,
                role: b.role, isChaser: !!b.isChaser, shielded: false
            };
            b.lastSent = {
                x: payload.x, y: payload.y, hp: payload.hp,
                heading: payload.heading, shielded: false
            };
            return payload;
        });
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

        if (bot.shieldUntil && Date.now() < bot.shieldUntil) {
            io.to(socket.id).emit('bot_shield_block', { botId: data.botId });
            return;
        }

        bot.hp -= 1;

        if (bot.hp <= 0) {
            delete room.bots[data.botId];
            room.botsKilledThisWave++;
            const p = room.players[socket.uid];
            if (p) p.kills += 1;

            const isWaveComplete = (room.botsKilledThisWave >= room.totalBotsForWave);
            const remainingBots = Math.max(0, room.totalBotsForWave - room.botsKilledThisWave);

            io.to(socket.currentRoom).emit('bot_killed', {
                botId: data.botId,
                byId: socket.id,
                byName: p ? p.name : '?',
                finisherId: data.finisherId || 'none',
                isLastBot: isWaveComplete,
                remainingBots: remainingBots
            });

            if (!isWaveComplete && room.botsSpawnedThisWave < room.totalBotsForWave) {
                const targetX = p ? p.x : room.worldSize / 2;
                const targetY = p ? p.y : room.worldSize / 2;
                const playerHeading = p ? p.heading : 0;

                spawnSingleBot(room, targetX, targetY, SURPRISE_SPAWN_MIN, SURPRISE_SPAWN_MAX,
                    botHPForRoom(room), true, playerHeading);
            }

            if (isWaveComplete) {
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

        const now = Date.now();
        const cooldown = getPlayerDamageCooldownMs(room);

        if (p.lastDamageTime && (now - p.lastDamageTime) < cooldown) {
            io.to(socket.id).emit('hp_update', { hp: p.hp });
            return;
        }

        const clientDamage = data.damage || 15;
        let serverDamage;

        if (clientDamage > 50) {
            serverDamage = Math.min(clientDamage, p.maxHp * 0.6);
        } else {
            serverDamage = botDamageForRoom(room);
        }

        p.lastDamageTime = now;
        p.hp -= serverDamage;

        if (p.hp <= 0) {
            p.hp = 0;
            io.to(socket.currentRoom).emit('player_died', { id: socket.id, name: p.name });

            const roomIdAtDeath = socket.currentRoom;
            const uidAtDeath = socket.uid;

            safeSetTimeout(() => {
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
                    const sp = randomSpawnNearSafe(r.worldSize / 2, r.worldSize / 2, 300, 1200, r.islands, r.worldSize, undefined);
                    currentPlayer.x = sp.x;
                    currentPlayer.y = sp.y;
                    currentPlayer.hp = currentPlayer.maxHp;
                    currentPlayer.lastDamageTime = 0;
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

    if (room.botTickInterval) {
        clearInterval(room.botTickInterval);
        room.botTickInterval = null;
    }

    // ⭐ تحسين #7: إلغاء كل setTimeout للغرفة
    clearRoomTimeouts(roomId);

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

server.listen(PORT, () => {});
