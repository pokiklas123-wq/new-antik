// =====================================================
// Grand3D Co-op Server v17.0 - Sleeping Players Solution
// =====================================================

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
const BOT_SPEED_WAVE_CAP = 20;
const WORLD_SIZE = 10000;
const WORLD_MIN = 700;
const WORLD_MAX = WORLD_SIZE - 700;

const TICK_MS = 50;
const BOT_SPAWN_MIN_DIST = 3500;
const BOT_SPAWN_MAX_DIST = 6000;

// ✅ مهلة إعادة الاتصال — 2 دقيقة
const RECONNECT_GRACE_MS = 120000;

let rooms = {};
let nextRoomId = 1;

app.get('/', (req, res) => {
    res.send('Grand3D Co-op Server v17.0');
});

function rnd(a, b) { return a + Math.random() * (b - a); }

function dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
}

function botSpeedForWave(wave) {
    let base = 12.0;
    if (wave <= BOT_SPEED_WAVE_CAP) base += wave * 0.6;
    else base += BOT_SPEED_WAVE_CAP * 0.4;
    return Math.min(base, 20.0);
}

function botHPForWave(wave) {
    if (wave >= 70) return 3;
    if (wave >= 40) return 2;
    return 1;
}

function botCountForWave(wave) {
    return Math.min(3 + wave * 2, 40);
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

// ✅ احسب اللاعبين النشطين (غير مقطوعين)
function getActivePlayers(room) {
    return Object.values(room.players).filter(p => !p.disconnected);
}

function findOpenRoom(mode) {
    for (const id in rooms) {
        const r = rooms[id];
        if (r.mode !== mode) continue;

        const activeCount = getActivePlayers(r).length;
        if (activeCount === 0) continue;
        if (activeCount >= MAX_PLAYERS_4V) continue;

        return id;
    }
    return null;
}

function createRoom(mode, startWave) {
    const id = `${mode === '1VBOT' ? 'solo' : 'coop'}_${nextRoomId++}`;
    rooms[id] = {
        id, mode,
        players: {},
        wave: Math.max(1, startWave || 1),
        bots: {},
        botIdCounter: 1,
        botTickInterval: null,
        islands: []
    };
    startBotTick(id);
    console.log(`✅ Room created: ${id} (${mode}) Wave ${rooms[id].wave}`);
    return id;
}

function startBotTick(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.botTickInterval = setInterval(() => {
        const r = rooms[roomId];
        if (!r) return;

        // ✅ اللاعبون النشطون فقط (غير مقطوعين + hp > 0)
        const activePlayers = getActivePlayers(r).filter(p => p.hp > 0);

        if (activePlayers.length === 0) {
            // ✅ لا يوجد لاعبون نشطون → البوتات ثابتة في مكانها (لا تحذف، لا تحرك)
            // لا ترسل شيئاً — البوتات متوقفة عند العميل
            return;
        }

        const islands = r.islands || [];
        const islData = islands.map(i => ({
            x: i.x, y: i.y,
            r100sq: (i.radius + 100) * (i.radius + 100)
        }));

        for (const botId in r.bots) {
            const bot = r.bots[botId];
            if (bot.hp <= 0) continue;

            let closest = null, closestD2 = Infinity;
            for (let i = 0; i < activePlayers.length; i++) {
                const p = activePlayers[i];
                const d2 = dist2(p.x, p.y, bot.x, bot.y);
                if (d2 < closestD2) { closestD2 = d2; closest = p; }
            }
            if (!closest) continue;

            const speed = botSpeedForWave(r.wave);
            const dx = closest.x - bot.x;
            const dy = closest.y - bot.y;
            const len = Math.sqrt(closestD2) || 1;
            const step = speed;

            let nx = bot.x + (dx / len) * step;
            let ny = bot.y + (dy / len) * step;

            let blocked = false;
            for (let i = 0; i < islData.length; i++) {
                if (dist2(nx, ny, islData[i].x, islData[i].y) < islData[i].r100sq) {
                    blocked = true; break;
                }
            }

            if (!blocked) {
                bot.x = nx; bot.y = ny;
            } else {
                const perp = Math.atan2(dy, dx) + Math.PI / 2;
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

            if (bot.x < WORLD_MIN) bot.x = WORLD_MIN;
            else if (bot.x > WORLD_MAX) bot.x = WORLD_MAX;
            if (bot.y < WORLD_MIN) bot.y = WORLD_MIN;
            else if (bot.y > WORLD_MAX) bot.y = WORLD_MAX;

            bot.heading = Math.atan2(dx, -dy) * 180 / Math.PI;

            bot.fireTimer = (bot.fireTimer || 0) + 0.1;
            if (bot.fireTimer > 2.0 && closestD2 < 1800 * 1800) {
                bot.fireTimer = 0;
                io.to(roomId).emit('bot_fired', {
                    botId: bot.id,
                    x: bot.x, y: bot.y,
                    targetX: closest.x, targetY: closest.y
                });
            }
        }

        const botsPayload = Object.values(r.bots).map(b => ({
            id: b.id, x: b.x, y: b.y, heading: b.heading, hp: b.hp
        }));
        io.to(roomId).emit('bots_update', botsPayload);
    }, TICK_MS);
}

function spawnWave(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const activePlayers = getActivePlayers(room);
    if (activePlayers.length === 0) {
        console.log(`⚠️ [${roomId}] spawnWave skipped: no active players`);
        room.bots = {};
        return;
    }

    room.bots = {};
    const count = botCountForWave(room.wave);
    const hpVal = botHPForWave(room.wave);

    let cx = 0, cy = 0;
    for (const p of activePlayers) { cx += p.x; cy += p.y; }
    cx /= activePlayers.length;
    cy /= activePlayers.length;

    for (let i = 0; i < count; i++) {
        const sp = randomSpawnNearSafe(cx, cy, BOT_SPAWN_MIN_DIST, BOT_SPAWN_MAX_DIST, room.islands || []);
        const id = room.botIdCounter++;
        room.bots[id] = {
            id, x: sp.x, y: sp.y,
            heading: rnd(0, 360),
            hp: hpVal,
            fireTimer: 0
        };
    }

    console.log(`🌊 [${roomId}] Wave ${room.wave} - ${count} bots`);
    io.to(roomId).emit('wave_start', { wave: room.wave, count });
    io.to(roomId).emit('bots_update', Object.values(room.bots));
}

// ============= Firebase =============
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

    for (const pid in room.players) {
        const pl = room.players[pid];
        if (!pl.uid) continue;

        fetchUserKills(pl.uid, (oldKills) => {
            const newTotal = oldKills + (pl.kills || 0);
            pushUserStatsAsync(pl.uid, newTotal, pl.level);
            pl.kills = 0;
        });
    }

    sendLeaderboard(roomId);
}

// ✅ دالة موحدة لإعادة الاتصال
function tryReconnect(socket, mode, username, uid, islands) {
    if (!uid) return false;

    for (const id in rooms) {
        const r = rooms[id];
        if (r.mode !== mode) continue;

        // ✅ 1) نفس socket.id موجود ومقطوع
        const sameSocket = r.players[socket.id];
        if (sameSocket && sameSocket.disconnected) {
            sameSocket.disconnected = false;
            delete sameSocket.disconnectedAt;

            socket.join(id);
            socket.currentRoom = id;

            console.log(`♻️ SAME-SOCKET reconnect: ${sameSocket.name} → ${id}`);

            socket.emit('match_found', {
                matchId: id,
                role: 'Player',
                spawnX: sameSocket.x, spawnY: sameSocket.y, spawnHeading: sameSocket.heading,
                opponentId: '',
                serverId: socket.id,
                wave: r.wave,
                mode: mode,
                islands: r.islands || [],
                reconnected: true
            });

            const others = Object.values(r.players)
                .filter(p => p.id !== socket.id && !p.disconnected)
                .map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, heading: p.heading }));
            socket.emit('room_state', { players: others, wave: r.wave });

            socket.emit('bots_update', Object.values(r.bots).map(b => ({
                id: b.id, x: b.x, y: b.y, heading: b.heading, hp: b.hp
            })));

            socket.emit('hp_update', { hp: sameSocket.hp });

            socket.to(id).emit('player_joined', {
                id: socket.id, name: sameSocket.name, x: sameSocket.x, y: sameSocket.y, heading: sameSocket.heading
            });

            sendLeaderboard(id);
            return true;
        }

        // ✅ 2) نفس uid موجود لكن socket مختلف
        for (const pid in r.players) {
            const p = r.players[pid];
            if (p.uid === uid && p.disconnected) {
                const oldX = p.x, oldY = p.y, oldH = p.heading;
                const oldKills = p.kills || 0;
                const oldHp = p.hp > 0 ? p.hp : 100;
                const oldLevel = p.level;
                const oldName = p.name;

                delete r.players[pid];

                r.players[socket.id] = {
                    id: socket.id,
                    name: oldName,
                    uid: uid,
                    x: oldX, y: oldY, heading: oldH,
                    hp: oldHp,
                    kills: oldKills,
                    level: oldLevel,
                    disconnected: false
                };

                socket.join(id);
                socket.currentRoom = id;

                console.log(`♻️ NEW-SOCKET reconnect: ${oldName} → ${id}`);

                socket.emit('match_found', {
                    matchId: id,
                    role: 'Player',
                    spawnX: oldX, spawnY: oldY, spawnHeading: oldH,
                    opponentId: '',
                    serverId: socket.id,
                    wave: r.wave,
                    mode: mode,
                    islands: r.islands || [],
                    reconnected: true
                });

                const others = Object.values(r.players)
                    .filter(pl => pl.id !== socket.id && !pl.disconnected)
                    .map(pl => ({ id: pl.id, name: pl.name, x: pl.x, y: pl.y, heading: pl.heading }));
                socket.emit('room_state', { players: others, wave: r.wave });

                socket.emit('bots_update', Object.values(r.bots).map(b => ({
                    id: b.id, x: b.x, y: b.y, heading: b.heading, hp: b.hp
                })));

                socket.emit('hp_update', { hp: oldHp });

                socket.to(id).emit('player_joined', {
                    id: socket.id, name: oldName, x: oldX, y: oldY, heading: oldH
                });

                sendLeaderboard(id);
                return true;
            }
        }
    }
    return false;
}

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    socket.on('join_match', (data) => {
        const { mode, username, uid, level, total_kills, islands } = data || {};
        socket.username = username || 'Commander';
        socket.uid = uid || '';
        socket.mode = mode || '4VBOT';
        socket.startLevel = Math.max(1, level || 1);

        if (socket.mode !== '1VBOT' && socket.mode !== '4VBOT') {
            socket.emit('mode_rejected');
            return;
        }

        // ✅ 1) حاول إعادة الاتصال أولاً
        if (tryReconnect(socket, socket.mode, socket.username, socket.uid, islands)) {
            return;
        }

        // ✅ 2) الطريقة العادية
        let roomId = findOpenRoom(socket.mode);
        if (!roomId) {
            roomId = createRoom(socket.mode, socket.startLevel);
        }

        const room = rooms[roomId];

        if (islands && Array.isArray(islands) && islands.length > 0) {
            room.islands = islands;
        }

        socket.join(roomId);
        socket.currentRoom = roomId;

        if (socket.startLevel > room.wave) {
            room.wave = socket.startLevel;
        }

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

        room.players[socket.id] = {
            id: socket.id,
            name: socket.username,
            uid: socket.uid,
            x: sx, y: sy, heading: 0,
            hp: 100,
            kills: 0,
            level: socket.startLevel,
            disconnected: false
        };

        socket.emit('match_found', {
            matchId: roomId,
            role: 'Player',
            spawnX: sx, spawnY: sy, spawnHeading: 0,
            opponentId: '',
            serverId: socket.id,
            wave: room.wave,
            mode: socket.mode,
            islands: room.islands || [],
            reconnected: false
        });

        const existing = Object.values(room.players)
            .filter(p => p.id !== socket.id && !p.disconnected)
            .map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, heading: p.heading }));
        socket.emit('room_state', { players: existing, wave: room.wave });

        socket.to(roomId).emit('player_joined', {
            id: socket.id, name: socket.username, x: sx, y: sy, heading: 0
        });

        socket.emit('bots_update', Object.values(room.bots));

        if (Object.keys(room.bots).length === 0) {
            spawnWave(roomId);
        }

        sendLeaderboard(roomId);
    });

    socket.on('player_moved', (data) => {
        const room = rooms[socket.currentRoom];
        if (!room || !room.players[socket.id]) return;
        const p = room.players[socket.id];
        if (p.disconnected) return;
        p.x = data.x; p.y = data.y; p.heading = data.heading;
        socket.to(socket.currentRoom).emit('player_moved', {
            id: socket.id, x: p.x, y: p.y, heading: p.heading
        });
    });

    socket.on('hit_bot', (data) => {
        const room = rooms[socket.currentRoom];
        if (!room) return;
        const bot = room.bots[data.botId];
        if (!bot || bot.hp <= 0) return;

        bot.hp -= 1;

        if (bot.hp <= 0) {
            delete room.bots[data.botId];
            const p = room.players[socket.id];
            if (p) p.kills += 1;

            io.to(socket.currentRoom).emit('bot_killed', {
                botId: data.botId,
                byId: socket.id,
                byName: p ? p.name : '?'
            });

            if (Object.keys(room.bots).length === 0) {
                room.wave += 1;

                for (const pid in room.players) {
                    const pl = room.players[pid];
                    if (pl.level < room.wave) pl.level = room.wave;
                    pl.hp = 100;
                }

                flushWaveStats(socket.currentRoom);
                io.to(socket.currentRoom).emit('level_up', { wave: room.wave });

                for (const pid in room.players) {
                    io.to(pid).emit('hp_update', { hp: 100 });
                }

                spawnWave(socket.currentRoom);
            }
        } else {
            io.to(socket.currentRoom).emit('bot_hp', { botId: data.botId, hp: bot.hp });
        }
    });

    socket.on('bot_hit_player', (data) => {
        const room = rooms[socket.currentRoom];
        if (!room) return;
        const p = room.players[socket.id];
        if (!p || p.hp <= 0) return;

        p.hp -= data.damage || 15;
        if (p.hp <= 0) {
            p.hp = 0;
            io.to(socket.currentRoom).emit('player_died', { id: socket.id, name: p.name });

            const roomIdAtDeath = socket.currentRoom;
            setTimeout(() => {
                const r = rooms[roomIdAtDeath];
                if (!r) return;
                const activePs = getActivePlayers(r);
                const allDead = activePs.every(pl => pl.hp <= 0);
                if (allDead && activePs.length > 0) {
                    flushWaveStats(roomIdAtDeath);
                    io.to(roomIdAtDeath).emit('team_wipe');
                    endRoom(roomIdAtDeath);
                    return;
                }
                if (r.players[socket.id]) {
                    const sp = randomSpawnNearSafe(WORLD_SIZE / 2, WORLD_SIZE / 2, 300, 1200, r.islands || []);
                    r.players[socket.id].x = sp.x;
                    r.players[socket.id].y = sp.y;
                    r.players[socket.id].hp = 100;
                    io.to(socket.id).emit('player_respawned', { x: sp.x, y: sp.y });
                }
            }, RESPAWN_MS);
        } else {
            io.to(socket.id).emit('hp_update', { hp: p.hp });
        }
    });

    socket.on('player_paused', () => {
        console.log('⏸️ Paused:', socket.id);
    });

    socket.on('player_resumed', () => {
        console.log('▶️ Resumed:', socket.id);
    });

    // ✅ الأهم: عند disconnect — فقط علّم اللاعب كمقطوع
    socket.on('disconnect', () => {
        console.log('🔌 Disconnected:', socket.id);
        const roomId = socket.currentRoom;
        if (!roomId) return;
        const room = rooms[roomId];
        if (!room) return;

        const player = room.players[socket.id];
        if (player) {
            player.disconnected = true;
            player.disconnectedAt = Date.now();
            console.log(`💤 ${player.name} sleeping in ${roomId}`);
        }
        // ✅ لا تحذفه، فقط علّم
    });
});

function endRoom(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (room.botTickInterval) clearInterval(room.botTickInterval);
    delete rooms[roomId];
    console.log('🛑 Room ended:', roomId);
}

// ✅ تنظيف دوري: احذف المنقطعين المنتهية مدتهم + الغرف الفارغة
setInterval(() => {
    const now = Date.now();
    for (const id in rooms) {
        const r = rooms[id];

        // احذف المنقطعين المنتهية مدتهم
        for (const pid in r.players) {
            const p = r.players[pid];
            if (p.disconnected && now - p.disconnectedAt > RECONNECT_GRACE_MS) {
                console.log(`⏰ Expired: ${p.name} from ${id}`);
                delete r.players[pid];
            }
        }

        // احذف الغرفة إذا فارغة تماماً
        if (Object.keys(r.players).length === 0) {
            endRoom(id);
        }
    }
}, 15000);

server.listen(PORT, () => {
    console.log(`🚀 Co-op server v17.0 running on port ${PORT}`);
    console.log(`💤 Reconnect grace: ${RECONNECT_GRACE_MS / 1000}s`);
    console.log(`✅ Sleeping players solution enabled`);
});
