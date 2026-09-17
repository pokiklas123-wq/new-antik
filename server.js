const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const DB_URL = "https://game-worboat-default-rtdb.europe-west1.firebasedatabase.app";
const MAX_ROOM_PLAYERS = 4;
const RESPAWN_MS = 3000;
const TEAM_WIPE_WINDOW_MS = 5000;
const BOT_SPEED_WAVE_CAP = 20;
const WORLD_SIZE = 6000;
const WORLD_MIN = 500;
const WORLD_MAX = WORLD_SIZE - 500;

let rooms = {};           // { roomId: { players, wave, bots, botIdCounter, startTime } }
let nextRoomId = 1;

app.get('/', (req, res) => {
    res.send('Grand3D Co-op Server v10.0 — Server-Authoritative Waves');
});

// ============ Utils ============
function rnd(a, b) { return a + Math.random() * (b - a); }

function botSpeedForWave(wave) {
    if (wave <= BOT_SPEED_WAVE_CAP) return 1.5 + wave * 0.4;
    return 1.5 + BOT_SPEED_WAVE_CAP * 0.4; // يقفل عند 20
}

function botDamageForWave(wave) {
    // كم طلقة يحتاج البوت ليموت — نخليه hp رقمياً
    if (wave >= 70) return 3;
    if (wave >= 40) return 2;
    return 1;
}

function botCountForWave(wave) {
    return Math.min(3 + wave * 2, 40);
}

function randomSpawnNear(cx, cy, minD, maxD) {
    const a = Math.random() * Math.PI * 2;
    const d = rnd(minD, maxD);
    let x = cx + Math.cos(a) * d;
    let y = cy + Math.sin(a) * d;
    x = Math.max(WORLD_MIN, Math.min(WORLD_MAX, x));
    y = Math.max(WORLD_MIN, Math.min(WORLD_MAX, y));
    return { x, y };
}

function findOpenRoom() {
    for (const id in rooms) {
        if (Object.keys(rooms[id].players).length < MAX_ROOM_PLAYERS) return id;
    }
    return null;
}

function createRoom() {
    const id = `room_${nextRoomId++}`;
    rooms[id] = {
        id,
        players: {},
        wave: 1,
        bots: {},
        botIdCounter: 1,
        botTickInterval: null
    };
    startBotTick(id);
    return id;
}

function startBotTick(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.botTickInterval = setInterval(() => {
        const r = rooms[roomId];
        if (!r) return;
        if (Object.keys(r.players).length === 0) return;

        // تحريك كل بوت نحو أقرب لاعب
        const playersList = Object.values(r.players).filter(p => p.hp > 0);
        if (playersList.length === 0) return;

        for (const botId in r.bots) {
            const bot = r.bots[botId];
            if (bot.hp <= 0) continue;

            // أقرب لاعب
            let closest = null, closestD = Infinity;
            for (const p of playersList) {
                const d = Math.hypot(p.x - bot.x, p.y - bot.y);
                if (d < closestD) { closestD = d; closest = p; }
            }
            if (!closest) continue;

            const speed = botSpeedForWave(r.wave);
            const dx = closest.x - bot.x;
            const dy = closest.y - bot.y;
            const len = Math.hypot(dx, dy) || 1;
            bot.x += (dx / len) * speed * 2.5;
            bot.y += (dy / len) * speed * 2.5;
            bot.heading = Math.atan2(dy, dx) * 180 / Math.PI;

            // إطلاق نار على اللاعب (كل 2 ثانية)
            bot.fireTimer = (bot.fireTimer || 0) + 0.05;
            if (bot.fireTimer > 2.0 && closestD < 1200) {
                bot.fireTimer = 0;
                io.to(roomId).emit('bot_fired', {
                    botId: bot.id,
                    x: bot.x,
                    y: bot.y,
                    targetX: closest.x,
                    targetY: closest.y
                });
            }
        }

        // بث حالة البوتات كل 100ms
        const botsPayload = Object.values(r.bots).map(b => ({
            id: b.id, x: b.x, y: b.y, heading: b.heading, hp: b.hp
        }));
        io.to(roomId).emit('bots_update', botsPayload);
    }, 100);
}

function spawnWave(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.bots = {};
    const count = botCountForWave(room.wave);

    // مركز قريب من أول لاعب
    const first = Object.values(room.players)[0];
    const cx = first ? first.x : WORLD_SIZE / 2;
    const cy = first ? first.y : WORLD_SIZE / 2;

    for (let i = 0; i < count; i++) {
        const sp = randomSpawnNear(cx, cy, 1200, 2700);
        const id = room.botIdCounter++;
        room.bots[id] = {
            id,
            x: sp.x,
            y: sp.y,
            heading: rnd(0, 360),
            hp: botDamageForWave(room.wave),
            fireTimer: 0
        };
    }

    io.to(roomId).emit('wave_start', { wave: room.wave, count });
    io.to(roomId).emit('bots_update', Object.values(room.bots));
}

// ============ Firebase ============
let cachedLeaderboard = [];
let lastFetch = 0;
const CACHE_MS = 5000;

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
    } catch (e) {
        return cachedLeaderboard;
    }
}

async function sendLeaderboard(roomId) {
    const top = await fetchLeaderboard();
    io.to(roomId).emit('leaderboard_update', top);
}

async function fetchUserKills(uid) {
    if (!uid) return 0;
    try {
        const res = await fetch(DB_URL + "/users/" + uid + "/total_kills.json");
        if (!res.ok) return 0;
        const v = await res.json();
        return (typeof v === 'number') ? v : 0;
    } catch (e) { return 0; }
}

async function fetchUserLevel(uid) {
    if (!uid) return 1;
    try {
        const res = await fetch(DB_URL + "/users/" + uid + "/level.json");
        if (!res.ok) return 1;
        const v = await res.json();
        return (typeof v === 'number' && v > 0) ? v : 1;
    } catch (e) { return 1; }
}

async function pushUserStats(uid, kills, level) {
    if (!uid) return;
    try {
        if (kills != null) {
            await fetch(DB_URL + "/users/" + uid + "/total_kills.json", {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kills)
            });
        }
        if (level != null) {
            await fetch(DB_URL + "/users/" + uid + "/level.json", {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(level)
            });
        }
        lastFetch = 0;
    } catch (e) { }
}

// ============ Socket ============
io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    socket.on('join_match', async (data) => {
        const { mode, username, uid, level, total_kills } = data || {};
        socket.username = username || 'Commander';
        socket.uid = uid || '';
        socket.mode = mode || '4VBOT';
        socket.startLevel = Math.max(1, level || 1);
        socket.startKills = Math.max(0, total_kills || 0);

        if (socket.mode !== '4VBOT') return; // النظام الجديد يقبل 4VBOT فقط

        // ابحث عن غرفة أو أنشئ
        let roomId = findOpenRoom();
        if (!roomId) roomId = createRoom();

        const room = rooms[roomId];
        socket.join(roomId);
        socket.currentRoom = roomId;

        const sp = randomSpawnNear(WORLD_SIZE / 2, WORLD_SIZE / 2, 300, 1200);
        room.players[socket.id] = {
            id: socket.id,
            name: socket.username,
            uid: socket.uid,
            x: sp.x,
            y: sp.y,
            heading: 0,
            hp: 100,
            kills: 0,
            level: socket.startLevel,
            isDying: false,
            respawnAt: 0
        };

        socket.emit('match_found', {
            matchId: roomId,
            role: 'Player',
            spawnX: sp.x,
            spawnY: sp.y,
            spawnHeading: 0,
            opponentId: '',
            serverId: socket.id,
            wave: room.wave,
            mode: '4VBOT'
        });

        // أرسل قائمة اللاعبين الحاليين للجديد
        const existing = Object.values(room.players)
            .filter(p => p.id !== socket.id)
            .map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, heading: p.heading }));
        socket.emit('room_state', { players: existing, wave: room.wave });

        // أبلغ الآخرين
        socket.to(roomId).emit('player_joined', {
            id: socket.id, name: socket.username, x: sp.x, y: sp.y, heading: 0
        });

        // أرسل البوتات الحالية للجديد
        socket.emit('bots_update', Object.values(room.bots));

        // إذا كانت الغرفة جديدة (لا بوتات) → ابدأ الموجة
        if (Object.keys(room.bots).length === 0) {
            spawnWave(roomId);
        }

        sendLeaderboard(roomId);
        console.log(`${socket.username} joined ${roomId}`);
    });

    // حركة اللاعب
    socket.on('player_moved', (data) => {
        const room = rooms[socket.currentRoom];
        if (!room || !room.players[socket.id]) return;
        const p = room.players[socket.id];
        p.x = data.x; p.y = data.y; p.heading = data.heading;

        socket.to(socket.currentRoom).emit('player_moved', {
            id: socket.id, x: p.x, y: p.y, heading: p.heading
        });
    });

    // ضربة على بوت
    socket.on('hit_bot', async (data) => {
        const room = rooms[socket.currentRoom];
        if (!room) return;
        const bot = room.bots[data.botId];
        if (!bot || bot.hp <= 0) return;

        bot.hp -= 1;

        if (bot.hp <= 0) {
            // احذف البوت
            delete room.bots[data.botId];

            // احفظ القتلة للاعب
            const p = room.players[socket.id];
            if (p) p.kills += 1;

            // أبلغ الجميع
            io.to(socket.currentRoom).emit('bot_killed', {
                botId: data.botId,
                byId: socket.id,
                byName: room.players[socket.id] ? room.players[socket.id].name : '?'
            });

            // بث حالة جديدة
            io.to(socket.currentRoom).emit('bots_update', Object.values(room.bots));

            // إذا انتهت الموجة → ابدأ الجديدة
            if (Object.keys(room.bots).length === 0) {
                room.wave += 1;
                // تحديث level للجميع في Firebase
                for (const pid in room.players) {
                    const pl = room.players[pid];
                    if (pl.level < room.wave) {
                        pl.level = room.wave;
                        const totalKills = await fetchUserKills(pl.uid);
                        await pushUserStats(pl.uid, totalKills + pl.kills, pl.level);
                    }
                }
                // بث الموجة الجديدة
                spawnWave(socket.currentRoom);
                // بث المتصدرين
                sendLeaderboard(socket.currentRoom);
            }
        } else {
            // حدّث hp البوت فقط
            io.to(socket.currentRoom).emit('bot_hp', { botId: data.botId, hp: bot.hp });
        }
    });

    // إصابة لاعب من بوت
    socket.on('bot_hit_player', (data) => {
        const room = rooms[socket.currentRoom];
        if (!room) return;
        const p = room.players[socket.id];
        if (!p || p.hp <= 0) return;

        p.hp -= data.damage || 15;

        if (p.hp <= 0) {
            p.hp = 0;
            p.isDying = true;
            p.respawnAt = Date.now() + RESPAWN_MS;

            io.to(socket.currentRoom).emit('player_died', { id: socket.id, name: p.name });

            // فحص wipe
            setTimeout(() => {
                const r = rooms[socket.currentRoom];
                if (!r) return;
                const allDead = Object.values(r.players).every(pl => pl.hp <= 0);
                if (allDead && Object.keys(r.players).length > 0) {
                    io.to(socket.currentRoom).emit('team_wipe');
                    endRoom(socket.currentRoom);
                    return;
                }
                // respawn اللاعب
                if (r.players[socket.id]) {
                    const sp = randomSpawnNear(WORLD_SIZE / 2, WORLD_SIZE / 2, 300, 1200);
                    r.players[socket.id].x = sp.x;
                    r.players[socket.id].y = sp.y;
                    r.players[socket.id].hp = 100;
                    r.players[socket.id].isDying = false;
                    io.to(socket.id).emit('player_respawned', {
                        x: sp.x, y: sp.y
                    });
                }
            }, RESPAWN_MS);
        } else {
            io.to(socket.id).emit('hp_update', { hp: p.hp });
        }
    });

    // عند الخروج
    socket.on('leave_match', () => {
        leaveRoom(socket);
    });

    socket.on('disconnect', () => {
        leaveRoom(socket);
    });
});

function leaveRoom(socket) {
    const roomId = socket.currentRoom;
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;

    delete room.players[socket.id];
    socket.to(roomId).emit('player_left', { id: socket.id });
    socket.leave(roomId);
    socket.currentRoom = null;

    // إذا الغرفة فاضية → احذفها
    if (Object.keys(room.players).length === 0) {
        endRoom(roomId);
    }
}

function endRoom(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (room.botTickInterval) clearInterval(room.botTickInterval);
    delete rooms[roomId];
    console.log('Room ended:', roomId);
}

// تنظيف الغرف الفارغة كل 30 ثانية
setInterval(() => {
    for (const id in rooms) {
        if (Object.keys(rooms[id].players).length === 0) endRoom(id);
    }
}, 30000);

server.listen(PORT, () => {
    console.log(`Co-op server running on port ${PORT}`);
});
