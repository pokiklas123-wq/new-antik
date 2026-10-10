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

// مهلة العودة القصوى للاعب الذي انقطع (120 ثانية)
const OFFLINE_DEATH_MS = 120000;
const OFFLINE_GRACE_SECONDS = 120;

const MAX_BOTS_ON_FIELD = 50;
const BOT_SPAWN_MIN_DIST = 3500;
const BOT_SPAWN_MAX_DIST = 6000;

const FPS_RATIO = 6.0;
const BOT_MAX_SPEED = 25.0;
const BOT_BASE_SPEED = 10.0;
const CHASER_SPEED_RATIO = 0.9;
const MAX_CHASERS = 8;
const BOT_LEASH_DIST = 9000;
const BOT_FREE_ROAM_RADIUS = 7000;

const TORPEDO_SPEED_MULT = 1.4;
const TORPEDO_MIN_SPEED = 22.0;
const TORPEDO_MAX_SPEED = 42.0;

const PLAYER_SAFE_FRONT_ANGLE = 90;
const SURPRISE_SPAWN_MIN = 4000;
const SURPRISE_SPAWN_MAX = 6000;

const HIT_BOT_MIN_INTERVAL_MS = 40;

const MAX_PLAYER_COORD = 1000000;
const MAX_DAMAGE_PER_HIT = 999999;

const SHIPS_CONFIG = {
    'bot':               { hp:  100, speed: 10.0, damage:  10 },
    'devilahorns':       { hp:  200, speed: 11.0, damage:  20 },
    'devilsfangs':       { hp:  300, speed: 12.0, damage:  30 },
    'finish':            { hp:  400, speed: 13.0, damage:  40 },
    'proskin':           { hp:  500, speed: 14.0, damage:  50 },
    'suphigh':           { hp:  600, speed: 15.0, damage:  60 },
    'suplis':            { hp:  700, speed: 15.5, damage:  70 },
    'suplis2':           { hp:  800, speed: 16.0, damage:  80 },
    'gemini':            { hp:  900, speed: 16.5, damage:  90 },
    'war':               { hp: 1000, speed: 17.0, damage: 100 },
    'geminiprosimple':   { hp: 1100, speed: 17.5, damage: 110 },
    'deepseek':          { hp: 1200, speed: 18.0, damage: 120 },
    'geminipro':         { hp: 1300, speed: 18.5, damage: 130 },
    'legendary':         { hp: 1400, speed: 19.0, damage: 140 },
    'sovereignabyss':    { hp: 1500, speed: 19.5, damage: 150 },
    'sovereignabysspro': { hp: 1600, speed: 20.0, damage: 160 },
    'sport':             { hp: 1700, speed: 20.5, damage: 170 },
    'sportpro':          { hp: 1800, speed: 21.0, damage: 180 },
    'dumpling':          { hp: 1900, speed: 21.5, damage: 190 },
    'splittingtheseas':  { hp: 2000, speed: 22.0, damage: 200 }
};

const SHIP_LEVELS = [
    { level: 1,   id: 'bot' },
    { level: 30,  id: 'devilahorns' },
    { level: 60,  id: 'devilsfangs' },
    { level: 90,  id: 'finish' },
    { level: 120, id: 'proskin' },
    { level: 150, id: 'suphigh' },
    { level: 180, id: 'suplis' },
    { level: 210, id: 'suplis2' },
    { level: 240, id: 'gemini' },
    { level: 270, id: 'war' },
    { level: 300, id: 'geminiprosimple' },
    { level: 330, id: 'deepseek' },
    { level: 360, id: 'geminipro' },
    { level: 390, id: 'legendary' },
    { level: 420, id: 'sovereignabyss' },
    { level: 450, id: 'sovereignabysspro' },
    { level: 480, id: 'sport' },
    { level: 510, id: 'sportpro' },
    { level: 540, id: 'dumpling' },
    { level: 570, id: 'splittingtheseas' }
];

const onlineUsers = new Map();
const activeParties = new Map();
const userPartyMap = new Map();
const partyRoomMap = new Map();
const partyRoomLocks = new Map();

let rooms = {};
let nextRoomId = 1;
const wipedRoomsLog = new Set();
const activeTimeouts = new Map();

// 🎯 إيجاد أول Slot فارغ (1-4)
function findFreeSlot(room) {
    const used = new Set();
    for (const uid in room.players) {
        const p = room.players[uid];
        if (p && p.slotNumber) used.add(p.slotNumber);
    }
    for (let i = 1; i <= 4; i++) {
        if (!used.has(i)) return i;
    }
    return 1;
}

// 🎯 حساب الثواني المتبقية
function computeRemaining(offlineAt) {
    if (!offlineAt) return 0;
    return Math.max(0, Math.ceil((offlineAt + OFFLINE_DEATH_MS - Date.now()) / 1000));
}

function getBotStatsForWave(wave) {
    const wv = Math.max(1, wave);
    const lastLevel = SHIP_LEVELS[SHIP_LEVELS.length - 1].level;
    if (wv >= lastLevel) return SHIPS_CONFIG[SHIP_LEVELS[SHIP_LEVELS.length - 1].id];

    let shipA = SHIP_LEVELS[0];
    let shipB = SHIP_LEVELS[1];
    for (let i = 0; i < SHIP_LEVELS.length - 1; i++) {
        if (wv >= SHIP_LEVELS[i].level && wv < SHIP_LEVELS[i + 1].level) {
            shipA = SHIP_LEVELS[i];
            shipB = SHIP_LEVELS[i + 1];
            break;
        }
    }
    const statsA = SHIPS_CONFIG[shipA.id];
    const statsB = SHIPS_CONFIG[shipB.id];
    const ratio = (wv - shipA.level) / (shipB.level - shipA.level);
    return {
        hp: Math.round(statsA.hp + ratio * (statsB.hp - statsA.hp)),
        speed: Math.round((statsA.speed + ratio * (statsB.speed - statsA.speed)) * 10) / 10,
        damage: Math.round(statsA.damage + ratio * (statsB.damage - statsA.damage))
    };
}

function getShipStats(hullId) {
    return SHIPS_CONFIG[(hullId || 'bot').toLowerCase()] || SHIPS_CONFIG['bot'];
}

function safeSetTimeout(roomId, fn, ms) {
    const id = setTimeout(() => {
        const set = activeTimeouts.get(roomId);
        if (set) {
            set.delete(id);
            if (set.size === 0) activeTimeouts.delete(roomId);
        }
        try { fn(); } catch (e) { }
    }, ms);
    if (!activeTimeouts.has(roomId)) activeTimeouts.set(roomId, new Set());
    activeTimeouts.get(roomId).add(id);
    return id;
}

function clearRoomTimeouts(roomId) {
    const set = activeTimeouts.get(roomId);
    if (!set) return;
    for (const id of set) clearTimeout(id);
    activeTimeouts.delete(roomId);
}

function rnd(a, b) { return a + Math.random() * (b - a); }
function dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
}

function getMapStats(level) {
    const progress = Math.min(level / 250.0, 1.0);
    return { size: 10000 + (10000 * progress), count: 20 + Math.floor(100 * progress) };
}

function generateIslands(count, worldSize) {
    const islands = [];
    const rng = Math.random;
    let placed = 0, attempts = 0;
    const MIN_MARGIN = 1450;

    while (placed < count && attempts < 8000) {
        attempts++;
        const ix = MIN_MARGIN + rng() * (worldSize - (MIN_MARGIN * 2));
        const iy = MIN_MARGIN + rng() * (worldSize - (MIN_MARGIN * 2));
        if (Math.hypot(ix - (worldSize / 2), iy - (worldSize / 2)) < 50) continue;

        let clash = false;
        for (const o of islands) {
            const dx = ix - o.x, dy = iy - o.y;
            if (Math.hypot(dx, dy) < o.radius + 900) { clash = true; break; }
        }
        if (clash) continue;

        islands.push({
            x: ix, y: iy,
            radius: 160 + rng() * 220,
            height: 140 + rng() * 180,
            seed: Math.floor(rng() * 9999)
        });
        placed++;
    }
    return islands;
}

function computeRoomStats(room) {
    const wave = room.wave || 1;
    const botStats = getBotStatsForWave(wave);
    const waveSpeed = botStats.speed;
    return {
        avgLevel: wave,
        maxSpeed: 15.0,
        normalSpeed: waveSpeed,
        chaserSpeed: Math.min(waveSpeed * 1.2, BOT_MAX_SPEED),
        predictionTime: 0.3 + Math.min(1.0, wave / 100) * 0.3,
        missChance: Math.max(0, 0.4 - wave / 200),
        torpedoSpeed: 22.0,
        botAbility: wave >= 100 ? 'shield' : (wave >= 50 ? 'barrage' : 'none'),
        fireCooldown: Math.max(1.0, 2.5 - (wave * 0.015))
    };
}

function getTorpedoSpeed(room) {
    return Math.min(22.0 + Math.floor((room.wave || 1) / 20), TORPEDO_MAX_SPEED);
}

function botHPForRoom(room) { return getBotStatsForWave(room.wave || 1).hp; }
function botDamageForRoom(room) { return getBotStatsForWave(room.wave || 1).damage; }

function getPlayerDamageCooldownMs(room) {
    const wv = room.wave || 1;
    if (wv > 400) return 250;
    if (wv > 200) return 200;
    if (wv > 100) return 150;
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
    return Math.floor(5 + (95 * Math.min((wave - 1) / 249.0, 1.0)));
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
            let diff = Math.abs(dirToBot - playerHeadingRad) % (Math.PI * 2);
            if (diff > Math.PI) diff = Math.PI * 2 - diff;
            if (diff * 180 / Math.PI < PLAYER_SAFE_FRONT_ANGLE) continue;
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

function findOpenRoom(mode, partyId) {
    for (const id in rooms) {
        const r = rooms[id];
        if (r.mode !== mode) continue;
        if (r.wiped) continue;
        if (r.partyId) {
            if (!partyId || r.partyId !== partyId) continue;
        }
        if (partyId && !r.partyId) continue;
        if (mode === '1VBOT' && Object.keys(r.players).length === 0) return id;
        if (mode === '4VBOT' && Object.keys(r.players).length < MAX_PLAYERS_4V) return id;
    }
    return null;
}

function createRoom(mode, startWave, partyId = null) {
    const id = `${mode === '1VBOT' ? 'solo' : 'coop'}_${nextRoomId++}`;
    const mapStats = getMapStats(startWave);
    const islands = generateIslands(mapStats.count, mapStats.size);
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
        islands, islData,
        wiped: false,
        totalBotsForWave: 0,
        botsSpawnedThisWave: 0,
        botsKilledThisWave: 0,
        partyId,
        createdAt: Date.now()
    };
    startBotTick(id);
    return id;
}

function isInsideIsland(x, y, islData) {
    for (let i = 0; i < islData.length; i++) {
        if (dist2(x, y, islData[i].x, islData[i].y) < islData[i].r100sq) return true;
    }
    return false;
}

function tryUnstuck(bot, step, islData) {
    let trappingIsland = null;
    let minD2 = Infinity;
    for (let i = 0; i < islData.length; i++) {
        const d2 = dist2(bot.x, bot.y, islData[i].x, islData[i].y);
        if (d2 < islData[i].r100sq * 1.5 && d2 < minD2) {
            minD2 = d2;
            trappingIsland = islData[i];
        }
    }

    if (trappingIsland) {
        const escapeAngle = Math.atan2(bot.y - trappingIsland.y, bot.x - trappingIsland.x);
        for (let r = 2; r <= 8; r++) {
            const tx = bot.x + Math.cos(escapeAngle) * step * r;
            const ty = bot.y + Math.sin(escapeAngle) * step * r;
            if (!isInsideIsland(tx, ty, islData)) {
                bot.x = tx; bot.y = ty;
                return true;
            }
        }
    }

    const dirs = [0, Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI / 4, -Math.PI / 4];
    for (const offset of dirs) {
        const tx = bot.x + Math.cos(offset) * step * 5;
        const ty = bot.y + Math.sin(offset) * step * 5;
        if (tx >= 700 && ty >= 700 && !isInsideIsland(tx, ty, islData)) {
            bot.x = tx; bot.y = ty;
            return true;
        }
    }
    return false;
}

function startBotTick(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    let offlineTimerCounter = 0;

    room.botTickInterval = setInterval(() => {
        try {
            const r = rooms[roomId];
            if (!r || r.wiped) {
                if (room.botTickInterval) {
                    clearInterval(room.botTickInterval);
                    room.botTickInterval = null;
                }
                return;
            }

            const now = Date.now();

            // 🎯 إرسال offline_timers كل 10 ticks (= ثانية واحدة)
            offlineTimerCounter++;
            if (offlineTimerCounter >= 10) {
                offlineTimerCounter = 0;
                const offlineList = [];
                for (const uid in r.players) {
                    const p = r.players[uid];
                    if (p.offlineAt && p.offlineAt > 0) {
                        const rem = computeRemaining(p.offlineAt);
                        if (rem > 0) {
                            offlineList.push({ uid: uid, remaining: rem });
                        }
                    }
                }
                if (offlineList.length > 0) {
                    io.to(roomId).emit('offline_timers', offlineList);
                }
            }

            for (const uid in r.players) {
                const p = r.players[uid];

                if (!p.online) continue;

                if (!p.isGhost && (now - (p.lastMoveTime || now) > 20000)) {
                    p.isGhost = true;

                    // 🎯 تعليم وقت الانقطاع + إرسال الحدث
                    if (!p.offlineAt) {
                        p.offlineAt = Date.now();
                        p.offlineReason = "ghost";
                        io.to(roomId).emit('player_offline', {
                            id: p.id,
                            uid: p.uid,
                            name: p.name,
                            slotNumber: p.slotNumber,
                            offlineAt: p.offlineAt,
                            remaining: OFFLINE_GRACE_SECONDS
                        });
                    }

                    if (p.deathTimer) clearTimeout(p.deathTimer);
                    p.deathTimer = setTimeout(() => {
                        const r2 = rooms[roomId];
                        if (!r2 || r2.wiped || !r2.players[uid]) return;

                        // 🎯 إرسال player_removed قبل الحذف
                        const removedUid = r2.players[uid].uid;
                        const removedSlot = r2.players[uid].slotNumber;
                        io.to(roomId).emit('player_removed', {
                            uid: removedUid,
                            slotNumber: removedSlot
                        });

                        delete r2.players[uid];

                        const remaining = Object.values(r2.players);
                        if (remaining.length === 0) { endRoom(roomId); return; }

                        const allDead = remaining.every(pl => {
                            const isActuallyDead = pl.hp <= 0;
                            const offlineExpired = !pl.offlineAt || (Date.now() - pl.offlineAt) >= OFFLINE_DEATH_MS;
                            return isActuallyDead && offlineExpired && !pl.isGhost;
                        });
                        if (allDead) {
                            flushWaveStats(roomId);
                            io.to(roomId).emit('team_wipe');
                            endRoom(roomId);
                        }
                    }, OFFLINE_DEATH_MS);
                }
            }

            const allPlayers = Object.values(r.players);
            const playersList = allPlayers.filter(p => p.hp > 0 && p.online && !p.isGhost);

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

            const islData = r.islData || [];
            const stats = computeRoomStats(r);
            const chaserSpeed = stats.chaserSpeed;
            const normalSpeed = stats.normalSpeed;
            const predictionTime = stats.predictionTime;
            const missChance = stats.missChance;
            const botAbility = stats.botAbility;
            const torpedoSpeed = stats.torpedoSpeed;
            const fireCooldown = stats.fireCooldown;
            const currentBotDamage = botDamageForRoom(r);

            for (const botId in r.bots) {
                const bot = r.bots[botId];
                if (!bot || bot.hp <= 0) continue;

                let closest = null, closestD2 = Infinity;
                for (let i = 0; i < playersList.length; i++) {
                    const p = playersList[i];
                    const d2 = dist2(p.x, p.y, bot.x, bot.y);
                    if (d2 < closestD2) { closestD2 = d2; closest = p; }
                }
                if (!closest) continue;

                let dx = closest.x - bot.x;
                let dy = closest.y - bot.y;
                const len = Math.sqrt(closestD2) || 1;

                let speed = bot.isChaser ? chaserSpeed : normalSpeed;
                const step = speed * FPS_RATIO;

                let moveDx = 0, moveDy = 0;
                const role = bot.role || 'pusher';

                if (bot.isChaser) {
                    moveDx = dx; moveDy = dy;
                    speed = chaserSpeed;
                } else {
                    if (len > BOT_LEASH_DIST) {
                        moveDx = dx; moveDy = dy;
                        speed *= 1.8;
                    } else if (len > BOT_FREE_ROAM_RADIUS) {
                        moveDx = dx; moveDy = dy;
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
                const nx = bot.x + (moveDx / moveLen) * step;
                const ny = bot.y + (moveDy / moveLen) * step;

                if (!bot.stuckCheck) {
                    bot.stuckCheck = { lastX: bot.x, lastY: bot.y, timer: 0, stuckCount: 0 };
                    bot.anchorX = closest.x;
                    bot.anchorY = closest.y;
                }
                bot.stuckCheck.timer += TICK_MS / 1000;

                if (bot.stuckCheck.timer >= 2.0) {
                    const movedDist = Math.hypot(bot.x - bot.stuckCheck.lastX, bot.y - bot.stuckCheck.lastY);
                    if (movedDist < 60) bot.stuckCheck.stuckCount++;
                    else bot.stuckCheck.stuckCount = 0;
                    bot.stuckCheck.lastX = bot.x;
                    bot.stuckCheck.lastY = bot.y;
                    bot.stuckCheck.timer = 0;
                }

                if (bot.stuckCheck.stuckCount >= 2) {
                    bot.anchorX = closest.x;
                    bot.anchorY = closest.y;
                    tryUnstuck(bot, step, islData);
                    bot.stuckCheck.stuckCount = 0;
                    bot.stuckCheck.lastX = bot.x;
                    bot.stuckCheck.lastY = bot.y;
                    const targetHeading = Math.atan2(closest.x - bot.x, -(closest.y - bot.y)) * 180 / Math.PI;
                    if (bot.isChaser) {
                        let diff = targetHeading - bot.heading;
                        while (diff > 180) diff -= 360;
                        while (diff < -180) diff += 360;
                        bot.heading += diff * 0.4;
                    } else bot.heading = targetHeading;
                    continue;
                }

                let blocked = false;
                for (let i = 0; i < islData.length; i++) {
                    if (dist2(nx, ny, islData[i].x, islData[i].y) < islData[i].r100sq) {
                        blocked = true; break;
                    }
                }

                if (!blocked) {
                    bot.x = nx; bot.y = ny;
                } else {
                    const perp1 = Math.atan2(moveDy, moveDx) + Math.PI / 2;
                    const tX1 = bot.x + Math.cos(perp1) * step;
                    const tY1 = bot.y + Math.sin(perp1) * step;
                    let b1 = false;
                    for (let i = 0; i < islData.length; i++) {
                        if (dist2(tX1, tY1, islData[i].x, islData[i].y) < islData[i].r100sq) { b1 = true; break; }
                    }
                    if (!b1) {
                        bot.x = tX1; bot.y = tY1;
                    } else {
                        const perp2 = Math.atan2(moveDy, moveDx) - Math.PI / 2;
                        const tX2 = bot.x + Math.cos(perp2) * step;
                        const tY2 = bot.y + Math.sin(perp2) * step;
                        let b2 = false;
                        for (let i = 0; i < islData.length; i++) {
                            if (dist2(tX2, tY2, islData[i].x, islData[i].y) < islData[i].r100sq) { b2 = true; break; }
                        }
                        if (!b2) { bot.x = tX2; bot.y = tY2; }
                    }
                }

                if (bot.x < 700) bot.x = 700; else if (bot.x > r.worldSize - 700) bot.x = r.worldSize - 700;
                if (bot.y < 700) bot.y = 700; else if (bot.y > r.worldSize - 700) bot.y = r.worldSize - 700;

                const targetHeading = Math.atan2(dx, -dy) * 180 / Math.PI;
                if (bot.isChaser) {
                    let diff = targetHeading - bot.heading;
                    while (diff > 180) diff -= 360;
                    while (diff < -180) diff += 360;
                    bot.heading += diff * 0.4;
                } else bot.heading = targetHeading;

                bot.abilityTimer = (bot.abilityTimer || 0) + (TICK_MS / 1000);

                if (botAbility !== 'none' && bot.abilityTimer > 5.0 && closestD2 < 2500 * 2500) {
                    bot.abilityTimer = 0;
                    if (botAbility === 'barrage') {
                        const pTime = predictionTime * FPS_RATIO;
                        const tx = closest.x + (closest.vx * pTime);
                        const ty = closest.y + (closest.vy * pTime);
                        const capturedBotId = bot.id;
                        const capturedX = Math.round(bot.x);
                        const capturedY = Math.round(bot.y);
                        for (let k = 0; k < 3; k++) {
                            safeSetTimeout(roomId, () => {
                                const rr = rooms[roomId];
                                if (!rr || rr.wiped) return;
                                io.to(roomId).emit('bot_fired', {
                                    botId: capturedBotId,
                                    x: capturedX, y: capturedY,
                                    targetX: Math.round(tx + rnd(-80, 80)),
                                    targetY: Math.round(ty + rnd(-80, 80)),
                                    speed: torpedoSpeed,
                                    damage: currentBotDamage
                                });
                            }, k * 150);
                        }
                        io.to(roomId).emit('bot_ability', { botId: bot.id, ability: 'barrage' });
                    } else if (botAbility === 'shield') {
                        bot.shieldUntil = now + 2000;
                        io.to(roomId).emit('bot_ability', { botId: bot.id, ability: 'shield' });
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
                        speed: torpedoSpeed,
                        damage: currentBotDamage
                    });
                }
            }

            const changedBots = [];
            for (const botId in r.bots) {
                const b = r.bots[botId];
                if (!b) continue;
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
                        id: b.id, x: roundedX, y: roundedY,
                        heading: roundedHeading, hp: b.hp,
                        role: b.role || 'pusher',
                        isChaser: !!b.isChaser,
                        shielded
                    });
                    b.lastSent = { x: roundedX, y: roundedY, hp: b.hp, heading: roundedHeading, shielded };
                }
            }

            if (changedBots.length > 0) {
                io.to(roomId).emit('bots_update', changedBots);
            }
        } catch (err) { }
    }, TICK_MS);
}

function spawnSingleBot(room, cx, cy, minD, maxD, hpVal, isSurprise = false, playerHeading = 0) {
    const sp = randomSpawnNearSafe(cx, cy, minD, maxD, room.islands, room.worldSize, playerHeading);
    const id = room.botIdCounter++;
    const spawnIndex = room.botsSpawnedThisWave;
    room.botsSpawnedThisWave++;

    room.bots[id] = {
        id, x: sp.x, y: sp.y,
        heading: rnd(0, 360),
        hp: hpVal,
        fireTimer: 0,
        isChaser: isSurprise,
        role: isSurprise ? 'pusher' : assignBotRole(spawnIndex, room.totalBotsForWave),
        abilityTimer: rnd(0, 3),
        dashingUntil: 0,
        shieldUntil: 0,
        lastSent: null,
        stuckCheck: null,
        anchorX: cx,
        anchorY: cy
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

    io.to(roomId).emit('wave_start', { wave: room.wave, totalBots });

    const botsPayload = Object.values(room.bots).map(b => {
        const payload = {
            id: b.id, x: Math.round(b.x), y: Math.round(b.y),
            heading: Math.round(b.heading), hp: b.hp,
            role: b.role, isChaser: !!b.isChaser, shielded: false
        };
        b.lastSent = { x: payload.x, y: payload.y, hp: payload.hp, heading: payload.heading, shielded: false };
        return payload;
    });
    io.to(roomId).emit('bots_update', botsPayload);
}

let cachedLeaderboard = [];
let lastFetch = 0;
const CACHE_MS = 10000;
let pendingLeaderboardFetch = null;

async function fetchWithTimeout(url, options = {}, ms = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally { clearTimeout(timer); }
}

async function fetchLeaderboard() {
    const now = Date.now();
    if (now - lastFetch < CACHE_MS && cachedLeaderboard.length > 0) return cachedLeaderboard;
    if (pendingLeaderboardFetch) return pendingLeaderboardFetch;

    pendingLeaderboardFetch = (async () => {
        try {
            const url = DB_URL + "/players.json?orderBy=\"level\"&limitToLast=5";
            const res = await fetchWithTimeout(url);
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
    fetchLeaderboard().then(top => io.to(roomId).emit('leaderboard_update', top)).catch(() => {});
}

function fetchUserKills(uid, callback) {
    if (!uid) return callback(0);
    fetchWithTimeout(DB_URL + "/players/" + uid + "/total_kills.json")
        .then(res => res.json())
        .then(v => callback((typeof v === 'number') ? v : 0))
        .catch(() => callback(0));
}

function pushUserStatsAsync(uid, kills, level) {
    if (!uid) return;
    if (kills != null) {
        fetchWithTimeout(DB_URL + "/players/" + uid + "/total_kills.json", {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kills)
        }).catch(() => {});
    }
    if (level != null && level > 0) {
        fetchWithTimeout(DB_URL + "/players/" + uid + "/level.json", {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(level)
        }).catch(() => {});
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

function handleUserLeavingParty(socket, uid, partyId) {
    const party = activeParties.get(partyId);
    if (!party) return;

    party.members = party.members.filter(m => m.uid !== uid);
    userPartyMap.delete(uid);

    if (socket) {
        try { socket.leave(partyId); } catch (e) {}
        socket.emit("party_update", { partyId: "", members: [] });
    }

    if (party.members.length === 0) {
        activeParties.delete(partyId);
        const roomId = partyRoomMap.get(partyId);
        if (roomId) {
            const r = rooms[roomId];
            if (r) {
                const strangers = Object.values(r.players).filter(p => !p.uid);
                if (strangers.length === 0 && Object.keys(r.players).length === 0) endRoom(roomId);
                else r.partyId = null;
            }
            partyRoomMap.delete(partyId);
        }
    } else {
        if (party.leaderUid === uid) {
            party.members.sort((a, b) => b.level - a.level);
            const newLeader = party.members[0];
            party.leaderUid = newLeader.uid;
            newLeader.isLeader = true;
        }
        io.to(partyId).emit("party_update", party);
    }
}

function endRoom(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.wiped = true;

    clearRoomTimeouts(roomId);

    if (room.botTickInterval) {
        clearInterval(room.botTickInterval);
        room.botTickInterval = null;
    }

    if (room.partyId) {
        if (partyRoomMap.get(room.partyId) === roomId) partyRoomMap.delete(room.partyId);
        partyRoomLocks.delete(room.partyId);
    }

    for (const uid in room.players) {
        const p = room.players[uid];
        if (p.deathTimer) { clearTimeout(p.deathTimer); p.deathTimer = null; }
        if (!p.id) continue;
        const s = io.sockets.sockets.get(p.id);
        if (s) { s.leave(roomId); cleanSocket(s); }
    }
    delete rooms[roomId];
}

io.on('connection', (socket) => {

    socket.on('disconnect', () => {
        if (!socket.uid) return;
        onlineUsers.delete(socket.uid);

        const partyId = userPartyMap.get(socket.uid);
        if (partyId) {
            const party = activeParties.get(partyId);
            if (party) {
                const member = party.members.find(m => m.uid === socket.uid);
                if (member) {
                    member.online = false;
                    io.to(partyId).emit("party_update", party);
                }
            }
        }

        const roomId = socket.currentRoom;
        const uid = socket.uid;
        if (roomId && rooms[roomId] && rooms[roomId].players[uid]) {
            const r = rooms[roomId];
            const p = r.players[uid];
            p.online = false;

            // 🎯 تعليم وقت الانقطاع + إرسال الحدث
            if (!p.offlineAt) {
                p.offlineAt = Date.now();
                p.offlineReason = "disconnect";
                io.to(roomId).emit('player_offline', {
                    id: socket.id,
                    uid: p.uid,
                    name: p.name,
                    slotNumber: p.slotNumber,
                    offlineAt: p.offlineAt,
                    remaining: OFFLINE_GRACE_SECONDS
                });
            }

            io.to(roomId).emit('player_left', { id: socket.id });

            if (p.deathTimer) clearTimeout(p.deathTimer);
            p.deathTimer = setTimeout(() => {
                const r2 = rooms[roomId];
                if (!r2 || r2.wiped) return;
                if (!r2.players[uid]) return;

                // 🎯 إرسال player_removed قبل الحذف
                io.to(roomId).emit('player_removed', {
                    uid: r2.players[uid].uid,
                    slotNumber: r2.players[uid].slotNumber
                });

                delete r2.players[uid];

                const remaining = Object.values(r2.players);
                if (remaining.length === 0) { endRoom(roomId); return; }
                const anyOnlineAlive = remaining.some(pl => pl.online && pl.hp > 0);
                if (!anyOnlineAlive) {
                    flushWaveStats(roomId);
                    io.to(roomId).emit('team_wipe');
                    endRoom(roomId);
                }
            }, OFFLINE_DEATH_MS);
        }
    });

    socket.on("register_user", (data) => {
        if (!data || !data.uid) return;
        onlineUsers.set(data.uid, socket.id);
        socket.uid = data.uid;

        const partyId = userPartyMap.get(data.uid);
        if (partyId) {
            const party = activeParties.get(partyId);
            if (!party) {
                userPartyMap.delete(data.uid);
                socket.emit("party_update", { partyId: "", members: [] });
            } else {
                const member = party.members.find(m => m.uid === data.uid);
                if (!member) {
                    userPartyMap.delete(data.uid);
                    socket.emit("party_update", { partyId: "", members: [] });
                } else {
                    member.online = true;
                    socket.join(partyId);
                    socket.emit("party_update", party);
                }
            }
        } else {
            socket.emit("party_update", { partyId: "", members: [] });
        }
    });

    socket.on("invite_to_party", (data) => {
        if (!data) return;
        const { senderUid, senderName, targetUid } = data;
        const senderLevel = data.senderLevel || 1;
        const senderHullId = data.senderHullId || "bot";
        const senderSkinPath = data.senderSkinPath || "bt/bt.png";

        let targetSocketId = onlineUsers.get(targetUid);
        if (targetSocketId && !io.sockets.sockets.has(targetSocketId)) {
            onlineUsers.delete(targetUid);
            targetSocketId = null;
        }
        if (!targetSocketId) {
            for (const roomId in rooms) {
                const room = rooms[roomId];
                if (room.players[targetUid] && room.players[targetUid].id) {
                    const sid = room.players[targetUid].id;
                    if (io.sockets.sockets.has(sid)) {
                        targetSocketId = sid;
                        onlineUsers.set(targetUid, sid);
                        break;
                    }
                }
            }
        }
        if (!targetSocketId) {
            for (const [sid, s] of io.sockets.sockets) {
                if (s.uid === targetUid) {
                    targetSocketId = sid;
                    onlineUsers.set(targetUid, sid);
                    break;
                }
            }
        }
        if (!targetSocketId) {
            socket.emit("party_error", { message: "Player is offline" });
            return;
        }

        let partyId = userPartyMap.get(senderUid);
        let party = partyId ? activeParties.get(partyId) : null;

        if (!party || !party.members.some(m => m.uid === senderUid)) {
            if (partyId) {
                userPartyMap.delete(senderUid);
                if (party && party.members.length === 0) {
                    activeParties.delete(partyId);
                    partyRoomMap.delete(partyId);
                }
            }

            partyId = "party_" + Math.random().toString(36).substring(2, 9);
            party = {
                partyId,
                leaderUid: senderUid,
                members: [{
                    uid: senderUid,
                    username: senderName || "Commander",
                    level: senderLevel,
                    hullId: senderHullId,
                    skinPath: senderSkinPath,
                    isLeader: true,
                    online: true
                }]
            };
            activeParties.set(partyId, party);
            userPartyMap.set(senderUid, partyId);
            socket.join(partyId);
            socket.emit("party_update", party);
        }

        io.to(targetSocketId).emit("party_invite_received", {
            senderUid, senderName, partyId
        });
    });

    socket.on("join_party", (data) => {
        if (!data) return;
        const { uid, username, level, hullId, skinPath, partyId } = data;
        socket.join(partyId);

        let party = activeParties.get(partyId);
        if (!party) {
            party = { partyId, leaderUid: uid, members: [] };
            activeParties.set(partyId, party);
        }

        const existingIdx = party.members.findIndex(m => m.uid === uid);
        if (existingIdx === -1) {
            party.members.push({
                uid, username,
                level: parseInt(level) || 1,
                hullId: hullId || "bot",
                skinPath: skinPath || "bt/bt.png",
                isLeader: (party.leaderUid === uid),
                online: true
            });
        } else {
            party.members[existingIdx].username = username;
            party.members[existingIdx].level = parseInt(level) || 1;
            party.members[existingIdx].hullId = hullId || "bot";
            party.members[existingIdx].skinPath = skinPath || "bt/bt.png";
            party.members[existingIdx].online = true;
        }

        userPartyMap.set(uid, partyId);
        io.to(partyId).emit("party_update", party);
    });

    socket.on("leave_party", (data) => {
        if (!data) return;
        handleUserLeavingParty(socket, data.uid, data.partyId);
    });

    socket.on("user_offline", (data) => {
        if (!data || !data.uid) return;
        const partyId = userPartyMap.get(data.uid);
        if (!partyId) return;
        const party = activeParties.get(partyId);
        if (!party) return;
        const member = party.members.find(m => m.uid === data.uid);
        if (member) {
            member.online = false;
            io.to(partyId).emit("party_update", party);
        }
    });

    socket.on("user_online", (data) => {
        if (!data || !data.uid) return;
        const partyId = userPartyMap.get(data.uid);
        if (!partyId) return;
        const party = activeParties.get(partyId);
        if (!party) { userPartyMap.delete(data.uid); return; }
        const member = party.members.find(m => m.uid === data.uid);
        if (member) {
            member.online = true;
            io.to(partyId).emit("party_update", party);
        }
    });

    socket.on("request_party_refresh", (data) => {
        if (!data || !data.uid) return;
        const partyId = userPartyMap.get(data.uid);
        if (!partyId) {
            socket.emit("party_update", { partyId: "", members: [] });
            return;
        }
        const party = activeParties.get(partyId);
        if (!party) {
            userPartyMap.delete(data.uid);
            socket.emit("party_update", { partyId: "", members: [] });
            return;
        }
        socket.join(partyId);
        socket.emit("party_update", party);
    });

    socket.on("party_start_matchmaking", (data) => {
        if (!data) return;
        const { partyId, mode } = data;
        const party = activeParties.get(partyId);
        if (!party) return;
        if (party.leaderUid !== socket.uid) return;

        if (partyRoomLocks.get(partyId)) {
            io.to(partyId).emit("party_matchmaking_started", { mode });
            return;
        }
        partyRoomLocks.set(partyId, true);

        try {
            let existingRoomId = partyRoomMap.get(partyId);
            if (existingRoomId) {
                const existingRoom = rooms[existingRoomId];
                if (!existingRoom || existingRoom.wiped) {
                    partyRoomMap.delete(partyId);
                    existingRoomId = null;
                } else if (existingRoom.mode !== mode) {
                    const strangers = Object.values(existingRoom.players).filter(p => !p.uid);
                    if (strangers.length === 0 && Object.keys(existingRoom.players).length === 0) endRoom(existingRoomId);
                    else existingRoom.partyId = null;
                    partyRoomMap.delete(partyId);
                    existingRoomId = null;
                }
            }

            if (existingRoomId) {
                io.to(partyId).emit("party_matchmaking_started", { mode, roomId: existingRoomId });
                return;
            }

            const leaderPlayer = party.members.find(m => m.uid === party.leaderUid);
            const startLevel = leaderPlayer ? leaderPlayer.level : 1;
            const newRoomId = createRoom(mode, startLevel + 1, partyId);
            partyRoomMap.set(partyId, newRoomId);

            io.to(partyId).emit("party_matchmaking_started", { mode, roomId: newRoomId });
        } finally {
            partyRoomLocks.delete(partyId);
        }
    });

    socket.on("party_cancel_matchmaking", (data) => {
        if (!data) return;
        const party = activeParties.get(data.partyId);
        if (!party) return;
        if (party.leaderUid !== socket.uid) return;
        io.to(data.partyId).emit("party_matchmaking_canceled");
    });

    socket.on('check_active_session', (data) => {
        const uid = data && data.uid;
        if (!uid || typeof uid !== 'string') { socket.emit('no_active_session'); return; }

        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.wiped) continue;
            const player = room.players[uid];
            if (player) {
                const anyAlive = Object.values(room.players).some(p => p.hp > 0);
                if (anyAlive) {
                    socket.emit('active_session_found', {
                        roomId, wave: room.wave,
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
        if (!data) { socket.emit('session_recovery_failed'); return; }
        const { uid, roomId, hullId, skinPath, finisherId } = data;
        if (!uid || !roomId) { socket.emit('session_recovery_failed'); return; }

        const room = rooms[roomId];
        if (!room || room.wiped) { socket.emit('session_recovery_failed'); return; }

        const player = room.players[uid];
        if (!player) { socket.emit('session_recovery_failed'); return; }

        if (player.hp <= 0) {
            const otherAlivePlayers = Object.values(room.players).filter(p => p.uid !== uid && p.hp > 0 && p.online && !p.isGhost);
            if (otherAlivePlayers.length > 0) {
                const sp = randomSpawnNearSafe(room.worldSize / 2, room.worldSize / 2, 300, 1200, room.islands, room.worldSize, undefined);
                player.x = sp.x;
                player.y = sp.y;
                player.hp = player.maxHp;
                player.lastDamageTime = 0;

                setTimeout(() => {
                    socket.emit('player_respawned', {
                        id: socket.id,
                        x: Math.round(player.x),
                        y: Math.round(player.y)
                    });
                }, 500);
            } else {
                socket.emit('session_recovery_failed');
                return;
            }
        }

        if (player.deathTimer) { clearTimeout(player.deathTimer); player.deathTimer = null; }

        // 🎯 مسح وقت الانقطاع
        player.offlineAt = 0;
        player.offlineReason = null;
        player.online = true;
        player.isGhost = false;
        player.id = socket.id;
        player.lastMoveTime = Date.now();

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
            islands: room.islands,
            slotNumber: player.slotNumber || 1
        });

        // 🎯 إرسال player_online للجميع
        io.to(roomId).emit('player_online', {
            id: socket.id,
            uid: uid,
            slotNumber: player.slotNumber
        });

        socket.to(roomId).emit('player_joined', {
            id: socket.id, name: player.name,
            x: Math.round(player.x), y: Math.round(player.y),
            heading: Math.round(player.heading),
            hullId: player.hullId, skinPath: player.skinPath, finisherId: player.finisherId,
            slotNumber: player.slotNumber
        });

        const existing = Object.values(room.players)
            .filter(p => p.uid !== uid)
            .map(p => ({
                id: p.id, name: p.name,
                x: Math.round(p.x), y: Math.round(p.y),
                heading: Math.round(p.heading),
                hullId: p.hullId, skinPath: p.skinPath, finisherId: p.finisherId,
                slotNumber: p.slotNumber || 0,
                remaining: p.offlineAt ? computeRemaining(p.offlineAt) : 0
            }));
        socket.emit('room_state', { players: existing, wave: room.wave });

        const botsPayload = Object.values(room.bots).map(b => {
            const payload = {
                id: b.id, x: Math.round(b.x), y: Math.round(b.y),
                heading: Math.round(b.heading), hp: b.hp,
                role: b.role, isChaser: !!b.isChaser, shielded: false
            };
            b.lastSent = { x: payload.x, y: payload.y, hp: payload.hp, heading: payload.heading, shielded: false };
            return payload;
        });
        socket.emit('bots_update', botsPayload);
    });

    socket.on('join_match', (data) => {
        if (!data) return;
        const { mode, username, uid, level, total_kills, hullId, skinPath, finisherId, partyId } = data;
        if (!uid || typeof uid !== 'string') { socket.emit('mode_rejected'); return; }

        if (socket.currentRoom) {
            const oldRoom = rooms[socket.currentRoom];
            if (oldRoom && socket.uid && oldRoom.players[socket.uid]) {
                if (oldRoom.players[socket.uid].deathTimer) {
                    clearTimeout(oldRoom.players[socket.uid].deathTimer);
                    oldRoom.players[socket.uid].deathTimer = null;
                }
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
                if (r.players[uid].deathTimer) {
                    clearTimeout(r.players[uid].deathTimer);
                    r.players[uid].deathTimer = null;
                }
                delete r.players[uid];
                io.to(rId).emit('player_left', { id: socket.id });
                if (Object.keys(r.players).length === 0) endRoom(rId);
            }
        }

        socket.username = username || 'Commander';
        socket.uid = uid;
        socket.mode = mode || '4VBOT';
        socket.startLevel = Math.max(1, level || 1);

        if (socket.mode !== '1VBOT' && socket.mode !== '4VBOT') {
            socket.emit('mode_rejected');
            return;
        }

        let roomId = null;
        if (partyId) {
            roomId = partyRoomMap.get(partyId);
            if (roomId) {
                const r = rooms[roomId];
                if (!r || r.wiped || r.mode !== socket.mode) {
                    partyRoomMap.delete(partyId);
                    roomId = null;
                }
            }
            if (!roomId) {
                if (!partyRoomLocks.get(partyId)) {
                    partyRoomLocks.set(partyId, true);
                    try {
                        roomId = createRoom(socket.mode, socket.startLevel + 1, partyId);
                        partyRoomMap.set(partyId, roomId);
                    } finally {
                        partyRoomLocks.delete(partyId);
                    }
                } else {
                    roomId = partyRoomMap.get(partyId);
                    if (!roomId) {
                        roomId = createRoom(socket.mode, socket.startLevel + 1, partyId);
                        partyRoomMap.set(partyId, roomId);
                    }
                }
            }
        } else {
            roomId = findOpenRoom(socket.mode, null);
            if (!roomId) roomId = createRoom(socket.mode, socket.startLevel + 1);
        }

        const room = rooms[roomId];
        if (!room) { socket.emit('mode_rejected'); return; }

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

        // 🎯 تعيين Slot
        const assignedSlot = findFreeSlot(room);

        room.players[socket.uid] = {
            id: socket.id, uid: socket.uid, name: socket.username,
            x: sx, y: sy, heading: 0,
            maxHp: stats.hp, hp: stats.hp, maxSpeed: stats.speed,
            kills: 0, level: socket.startLevel,
            online: true, isGhost: false, deathTimer: null,
            hullId: validHullId,
            skinPath: skinPath || 'bt/bot/bot.png',
            finisherId: finisherId || 'none',
            slotNumber: assignedSlot,
            offlineAt: 0,
            offlineReason: null,
            vx: 0, vy: 0, lastX: sx, lastY: sy,
            lastDamageTime: 0, lastHitBotTime: 0,
            lastMoveTime: Date.now()
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
            skinPath: room.players[socket.uid].skinPath,
            slotNumber: assignedSlot
        });

        const existing = Object.values(room.players)
            .filter(p => p.uid !== socket.uid)
            .map(p => ({
                id: p.id, name: p.name,
                x: Math.round(p.x), y: Math.round(p.y),
                heading: Math.round(p.heading),
                hullId: p.hullId, skinPath: p.skinPath, finisherId: p.finisherId,
                slotNumber: p.slotNumber || 0,
                remaining: p.offlineAt ? computeRemaining(p.offlineAt) : 0
            }));
        socket.emit('room_state', { players: existing, wave: room.wave });

        socket.to(roomId).emit('player_joined', {
            id: socket.id, name: socket.username,
            x: Math.round(sx), y: Math.round(sy),
            heading: 0, hullId: room.players[socket.uid].hullId,
            skinPath: room.players[socket.uid].skinPath,
            finisherId: room.players[socket.uid].finisherId,
            slotNumber: assignedSlot
        });

        const botsPayload = Object.values(room.bots).map(b => {
            const payload = {
                id: b.id, x: Math.round(b.x), y: Math.round(b.y),
                heading: Math.round(b.heading), hp: b.hp,
                role: b.role, isChaser: !!b.isChaser, shielded: false
            };
            b.lastSent = { x: payload.x, y: payload.y, hp: payload.hp, heading: payload.heading, shielded: false };
            return payload;
        });
        socket.emit('bots_update', botsPayload);

        if (Object.keys(room.bots).length === 0) spawnWave(roomId);
        sendLeaderboard(roomId);
    });

    socket.on('player_fired', (data) => {
        if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
        const room = rooms[socket.currentRoom];
        if (!room || room.wiped) return;
        const p = room.players[socket.uid];
        if (!p) return;
        socket.to(socket.currentRoom).emit('player_fired', {
            id: socket.id,
            x: data.x, y: data.y,
            heading: data.heading,
            hullId: data.hullId || p.hullId
        });
    });

    socket.on('player_moved', (data) => {
        if (!data) return;
        if (typeof data.x !== 'number' || typeof data.y !== 'number') return;
        if (!isFinite(data.x) || !isFinite(data.y)) return;
        if (Math.abs(data.x) > MAX_PLAYER_COORD || Math.abs(data.y) > MAX_PLAYER_COORD) return;

        const room = rooms[socket.currentRoom];
        if (!room || !room.players[socket.uid]) return;
        const p = room.players[socket.uid];

        p.x = data.x;
        p.y = data.y;
        p.heading = typeof data.heading === 'number' && isFinite(data.heading) ? data.heading : p.heading;
        if (data.hullId && data.hullId !== p.hullId) p.hullId = data.hullId;
        if (data.skinPath) p.skinPath = data.skinPath;
        if (data.finisherId) p.finisherId = data.finisherId;

        p.lastMoveTime = Date.now();

        if (p.isGhost) {
            p.isGhost = false;
            if (p.deathTimer) {
                clearTimeout(p.deathTimer);
                p.deathTimer = null;
            }
            // 🎯 مسح offlineAt
            p.offlineAt = 0;
            p.offlineReason = null;
            io.to(socket.currentRoom).emit('player_online', {
                id: socket.id,
                uid: p.uid,
                slotNumber: p.slotNumber
            });
            io.to(socket.currentRoom).emit('player_respawned', { id: socket.id, x: Math.round(p.x), y: Math.round(p.y) });
        }

        socket.to(socket.currentRoom).emit('player_moved', {
            id: socket.id,
            x: Math.round(p.x), y: Math.round(p.y),
            heading: Math.round(p.heading),
            hullId: p.hullId, skinPath: p.skinPath, finisherId: p.finisherId,
            slotNumber: p.slotNumber || 0,
            remaining: p.offlineAt ? computeRemaining(p.offlineAt) : 0
        });
    });

    socket.on('hit_bot', (data) => {
        if (!data || data.botId === undefined || data.botId === null) return;
        const room = rooms[socket.currentRoom];
        if (!room || room.wiped) return;
        const bot = room.bots[data.botId];
        if (!bot || bot.hp <= 0) return;

        const p = room.players[socket.uid];
        if (!p) return;

        const now = Date.now();
        if (p.lastHitBotTime && (now - p.lastHitBotTime) < HIT_BOT_MIN_INTERVAL_MS) return;
        p.lastHitBotTime = now;

        if (bot.shieldUntil && now < bot.shieldUntil) {
            io.to(socket.id).emit('bot_shield_block', { botId: data.botId });
            return;
        }

        const shipStats = getShipStats(p.hullId);
        const playerDamage = shipStats.damage || 10;
        const hitPower = playerDamage * 2;

        bot.hp -= hitPower;

        if (bot.hp <= 0.001) {
            delete room.bots[data.botId];
            room.botsKilledThisWave++;
            p.kills += 1;

            const isWaveComplete = (room.botsKilledThisWave >= room.totalBotsForWave);
            const remainingBots = Math.max(0, room.totalBotsForWave - room.botsKilledThisWave);

            io.to(socket.currentRoom).emit('bot_killed', {
                botId: data.botId,
                byId: socket.id,
                byName: p.name,
                finisherId: data.finisherId || 'none',
                isLastBot: isWaveComplete,
                remainingBots
            });

            if (!isWaveComplete && room.botsSpawnedThisWave < room.totalBotsForWave) {
                if (Object.keys(room.bots).length < MAX_BOTS_ON_FIELD) {
                    spawnSingleBot(room, room.worldSize / 2, room.worldSize / 2,
                        SURPRISE_SPAWN_MIN, SURPRISE_SPAWN_MAX,
                        botHPForRoom(room), true, p.heading);
                }
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
                    if (pl.online && pl.id && !pl.isGhost) {
                        io.to(pl.id).emit('level_up', { wave: room.wave, level: pl.level });
                        io.to(pl.id).emit('hp_update', { hp: pl.hp });
                    }
                }

                const rid = socket.currentRoom;
                safeSetTimeout(rid, () => spawnWave(rid), 2500);
            }
        } else {
            io.to(socket.currentRoom).emit('bot_hp', { botId: data.botId, hp: bot.hp });
        }
    });

    socket.on('bot_hit_player', (data) => {
        if (!data) return;
        const room = rooms[socket.currentRoom];
        if (!room || room.wiped) return;
        const p = room.players[socket.uid];
        if (!p || p.hp <= 0) return;

        const now = Date.now();
        const isCrash = data.source === 'crash';
        const isLethal = data.isLethal === true;

        if (!isCrash && !isLethal) {
            const cooldown = getPlayerDamageCooldownMs(room);
            if (p.lastDamageTime && (now - p.lastDamageTime) < cooldown) {
                io.to(socket.id).emit('hp_update', { hp: p.hp });
                return;
            }
        }

        let serverDamage;
        if (isLethal) {
            serverDamage = p.hp;
        } else if (isCrash) {
            serverDamage = Math.max(botDamageForRoom(room), p.maxHp * 0.5);
        } else {
            serverDamage = botDamageForRoom(room);
        }
        serverDamage = Math.min(serverDamage, MAX_DAMAGE_PER_HIT);

        p.lastDamageTime = now;
        p.hp -= serverDamage;
        if (!isFinite(p.hp) || p.hp < 0) p.hp = 0;

        if (p.hp <= 0) {
            p.hp = 0;
            io.to(socket.currentRoom).emit('player_died', { id: socket.id, name: p.name });

            const roomIdAtDeath = socket.currentRoom;
            const uidAtDeath = socket.uid;

            safeSetTimeout(roomIdAtDeath, () => {
                const r = rooms[roomIdAtDeath];
                if (!r || r.wiped) return;

                const remaining = Object.values(r.players);
                if (remaining.length === 0) { endRoom(roomIdAtDeath); return; }

                const allDeadAndNoGhosts = remaining.every(pl => pl.hp <= 0 && !pl.isGhost);

                if (allDeadAndNoGhosts) {
                    for (const uid in r.players) {
                        const pl = r.players[uid];
                        pl.level = Math.max(1, pl.level - 1);
                    }

                    flushWaveStats(roomIdAtDeath);
                    io.to(roomIdAtDeath).emit('team_wipe');

                    for (const uid in r.players) {
                        wipedRoomsLog.add(uid);
                        setTimeout(() => wipedRoomsLog.delete(uid), 5 * 60 * 1000);
                    }
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
    socket.on('temp_leave_match', () => leaveRoom(socket, false));
});

function leaveRoom(socket, immediate) {
    const roomId = socket.currentRoom;
    const room = roomId ? rooms[roomId] : null;
    if (!room) { cleanSocket(socket); return; }

    const playerUid = socket.uid;
    const socketId = socket.id;
    const player = room.players[playerUid];
    if (!player) { cleanSocket(socket); return; }

    if (immediate) {
        if (player.deathTimer) { clearTimeout(player.deathTimer); player.deathTimer = null; }

        const finalize = () => {
            const r = rooms[roomId];
            if (!r || !r.players[playerUid]) return;

            // 🎯 إرسال player_removed قبل الحذف
            io.to(roomId).emit('player_removed', {
                uid: playerUid,
                slotNumber: player.slotNumber
            });

            delete r.players[playerUid];
            io.to(roomId).emit('player_left', { id: socketId });

            const s = io.sockets.sockets.get(socketId);
            if (s) { s.leave(roomId); cleanSocket(s); }

            const remaining = Object.values(r.players);
            if (remaining.length === 0) { endRoom(roomId); return; }

            const anyOnlineAlive = remaining.some(pl => pl.online && pl.hp > 0 && !pl.isGhost);
            if (!anyOnlineAlive) {
                flushWaveStats(roomId);
                io.to(roomId).emit('team_wipe');
                endRoom(roomId);
            }
        };

        if (player.uid) {
            fetchUserKills(player.uid, (oldKills) => {
                pushUserStatsAsync(player.uid, oldKills + (player.kills || 0), player.level);
                finalize();
            });
        } else finalize();

    } else {
        player.online = false;

        // 🎯 تعليم وقت الانقطاع + إرسال الحدث
        if (!player.offlineAt) {
            player.offlineAt = Date.now();
            player.offlineReason = "temp_leave";
            io.to(roomId).emit('player_offline', {
                id: socketId,
                uid: playerUid,
                name: player.name,
                slotNumber: player.slotNumber,
                offlineAt: player.offlineAt,
                remaining: OFFLINE_GRACE_SECONDS
            });
        }

        io.to(roomId).emit('player_left', { id: socketId });
        if (player.deathTimer) clearTimeout(player.deathTimer);

        player.deathTimer = setTimeout(() => {
            const r = rooms[roomId];
            if (!r || r.wiped) return;
            if (!r.players[playerUid]) return;

            // 🎯 إرسال player_removed قبل الحذف
            io.to(roomId).emit('player_removed', {
                uid: playerUid,
                slotNumber: player.slotNumber
            });

            delete r.players[playerUid];

            const remaining = Object.values(r.players);
            if (remaining.length === 0) { endRoom(roomId); return; }
            const anyOnlineAlive = remaining.some(pl => pl.online && pl.hp > 0 && !pl.isGhost);
            if (!anyOnlineAlive) {
                flushWaveStats(roomId);
                io.to(roomId).emit('team_wipe');
                endRoom(roomId);
            }
        }, OFFLINE_DEATH_MS);
    }
}

app.get('/', (req, res) => res.send('Grand3D Co-op Server - Optimized'));

setInterval(() => {
    const now = Date.now();
    for (const id in rooms) {
        const r = rooms[id];
        if (Object.keys(r.players).length === 0 && (now - r.createdAt) > 30000) endRoom(id);
    }
}, 60000);

setInterval(() => {
    for (const [partyId, party] of activeParties.entries()) {
        if (party.members.length === 0) {
            activeParties.delete(partyId);
            partyRoomMap.delete(partyId);
            partyRoomLocks.delete(partyId);
        }
    }
}, 30000);

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
