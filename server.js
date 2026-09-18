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
const MAX_PLAYERS_4V = 4;
const RESPAWN_MS = 3000;
const BOT_SPEED_WAVE_CAP = 20;
const WORLD_SIZE = 10000;
const WORLD_MIN = 700;
const WORLD_MAX = WORLD_SIZE - 700;

let rooms = {};
let nextRoomId = 1;

app.get('/', (req, res) => {
    res.send('Grand3D Co-op Server v14.2 - Fully Optimized & Production Ready');
});

// دالة لتوليد أرقام عشوائية بين قيمتين
function rnd(a, b) { 
    return a + Math.random() * (b - a); 
}

// دالة لتحديد سرعة البوتات بناءً على رقم الموجة
function botSpeedForWave(wave) {
    let base = 12.0;
    if (wave <= BOT_SPEED_WAVE_CAP) base += wave * 0.6;
    else base += BOT_SPEED_WAVE_CAP * 0.4;
    return Math.min(base, 20.0); 
}

// دالة لتحديد نقاط حياة البوت (HP) بناءً على رقم الموجة
function botHPForWave(wave) {
    if (wave >= 70) return 3;
    if (wave >= 40) return 2;
    return 1;
}

// دالة لتحديد عدد البوتات في الموجة
function botCountForWave(wave) {
    return Math.min(3 + wave * 2, 40);
}

/**
 * دالة توليد موقع رسبنة آمن وبعيد
 * @param {number} cx - الإحداثي X لمركز الهدف (موقع اللاعبين)
 * @param {number} cy - الإحداثي Y لمركز الهدف (موقع اللاعبين)
 * @param {number} minD - المسافة الدنيا المطلوبة للابتعاد عن الهدف
 * @param {number} maxD - المسافة القصوى المطلوبة للابتعاد عن الهدف
 * @param {Array} islands - مصفوفة الجزر لتجنب الرسبنة فوقها
 */
function randomSpawnNearSafe(cx, cy, minD, maxD, islands) {
    for (let attempt = 0; attempt < 50; attempt++) {
        // توليد زاوية عشوائية بالراديان (من 0 إلى 360 درجة)
        const a = Math.random() * Math.PI * 2;
        // توليد مسافة عشوائية بين الحد الأدنى والأقصى
        const d = rnd(minD, maxD);
        
        // حساب الإحداثيات الجديدة بناءً على الزاوية والمسافة
        let x = cx + Math.cos(a) * d;
        let y = cy + Math.sin(a) * d;
        
        // حصر الإحداثيات داخل حدود الخريطة الآمنة لمنع الخروج عن العالم
        x = Math.max(WORLD_MIN, Math.min(WORLD_MAX, x));
        y = Math.max(WORLD_MIN, Math.min(WORLD_MAX, y));

        // التحقق من عدم الرسبنة داخل أي جزيرة
        let insideIsland = false;
        if (islands && islands.length) {
            for (const isl of islands) {
                if (Math.hypot(x - isl.x, y - isl.y) < isl.radius + 300) {
                    insideIsland = true; 
                    break;
                }
            }
        }
        
        // حساب المسافة الفعلية بعد الحصر للتأكد من أنها لا تزال كافية
        const actualDist = Math.hypot(x - cx, y - cy);
        
        // إذا كان الموقع خارج الجزر والمسافة كافية، يتم اعتماد الموقع
        if (!insideIsland && actualDist >= minD * 0.8) {
            return { x, y };
        }
    }
    // حل احتياطي في حال فشل جميع المحاولات (الرسبنة في أقصى زاوية بالخريطة)
    return { x: WORLD_MIN + 100, y: WORLD_MAX - 100 };
}

// البحث عن غرفة متاحة للاعبين
function findOpenRoom(mode) {
    for (const id in rooms) {
        const r = rooms[id];
        if (r.mode !== mode) continue;
        if (mode === '1VBOT' && Object.keys(r.players).length === 0) return id;
        if (mode === '4VBOT' && Object.keys(r.players).length < MAX_PLAYERS_4V) return id;
    }
    return null;
}

// إنشاء غرفة جديدة
function createRoom(mode, startWave) {
    const id = `${mode === '1VBOT' ? 'solo' : 'coop'}_${nextRoomId++}`;
    rooms[id] = {
        id, 
        mode,
        players: {},
        wave: Math.max(1, startWave || 1),
        bots: {},
        botIdCounter: 1,
        botTickInterval: null,
        islands: []
    };
    startBotTick(id);
    console.log(`Room created: ${id} (${mode}) at Wave ${rooms[id].wave}`);
    return id;
}

// تشغيل حلقة تحديث حركة البوتات والذكاء الاصطناعي
function startBotTick(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    
    room.botTickInterval = setInterval(() => {
        const r = rooms[roomId];
        if (!r) return;
        if (Object.keys(r.players).length === 0) return;

        const playersList = Object.values(r.players).filter(p => p.hp > 0);
        if (playersList.length === 0) {
            io.to(roomId).emit('bots_update', []);
            return;
        }

        for (const botId in r.bots) {
            const bot = r.bots[botId];
            if (bot.hp <= 0) continue;

            // البحث عن أقرب لاعب حي للبوت
            let closest = null, closestD = Infinity;
            for (const p of playersList) {
                const d = Math.hypot(p.x - bot.x, p.y - bot.y);
                if (d < closestD) { 
                    closestD = d; 
                    closest = p; 
                }
            }
            if (!closest) continue;

            const speed = botSpeedForWave(r.wave);
            const dx = closest.x - bot.x;
            const dy = closest.y - bot.y;
            const len = Math.hypot(dx, dy) || 1;

            // حساب الخطوة القادمة للبوت نحو اللاعب
            let nx = bot.x + (dx / len) * speed;
            let ny = bot.y + (dy / len) * speed;

            // تجنب الاصطدام بالجزر
            let blocked = false;
            for (const isl of r.islands) {
                if (Math.hypot(nx - isl.x, ny - isl.y) < isl.radius + 100) {
                    blocked = true; 
                    break;
                }
            }
            
            if (!blocked) {
                bot.x = nx; 
                bot.y = ny;
            } else {
                // محاولة الالتفاف حول الجزيرة إذا كان الطريق مغلقاً
                const perp = Math.atan2(dy, dx) + Math.PI / 2;
                const tX = bot.x + Math.cos(perp) * speed;
                const tY = bot.y + Math.sin(perp) * speed;
                let b2 = false;
                for (const isl of r.islands) {
                    if (Math.hypot(tX - isl.x, tY - isl.y) < isl.radius + 100) { 
                        b2 = true; 
                        break; 
                    }
                }
                if (!b2) { 
                    bot.x = tX; 
                    bot.y = tY; 
                }
            }
            
            bot.x = Math.max(WORLD_MIN, Math.min(WORLD_MAX, bot.x));
            bot.y = Math.max(WORLD_MIN, Math.min(WORLD_MAX, bot.y));
            bot.heading = Math.atan2(dx, -dy) * 180 / Math.PI;

            // إطلاق النار من البوت إذا كان اللاعب قريباً بما يكفي
            bot.fireTimer = (bot.fireTimer || 0) + 0.1;
            if (bot.fireTimer > 2.0 && closestD < 1800) {
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

        const botsPayload = Object.values(r.bots).map(b => ({
            id: b.id, x: b.x, y: b.y, heading: b.heading, hp: b.hp
        }));
        io.to(roomId).emit('bots_update', botsPayload);
    }, 50);
}

// رسبنة موجة جديدة من البوتات بعيداً عن اللاعبين
function spawnWave(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.bots = {};
    const count = botCountForWave(room.wave);
    const hpVal = botHPForWave(room.wave);

    // حساب متوسط موقع اللاعبين الأحياء ليكون نقطة الارتكاز للابتعاد عنها
    const players = Object.values(room.players).filter(p => p.hp > 0);
    let cx = WORLD_SIZE / 2;
    let cy = WORLD_SIZE / 2;
    
    if (players.length > 0) {
        cx = players.reduce((sum, p) => sum + p.x, 0) / players.length;
        cy = players.reduce((sum, p) => sum + p.y, 0) / players.length;
    }

    // تحديد مسافة الرسبنة البعيدة ديناميكياً بناءً على رقم الموجة
    const dynamicMinDist = Math.min(3500 + (room.wave * 50), 5500); // تبدأ من 3500 وتزيد تدريجياً
    const dynamicMaxDist = Math.min(5000 + (room.wave * 100), 8500); // أقصى مسافة رسبنة تصل لـ 8500

    for (let i = 0; i < count; i++) {
        const sp = randomSpawnNearSafe(cx, cy, dynamicMinDist, dynamicMaxDist, room.islands);
        const id = room.botIdCounter++;
        room.bots[id] = {
            id, 
            x: sp.x, 
            y: sp.y,
            heading: rnd(0, 360),
            hp: hpVal,
            fireTimer: 0
        };
    }

    io.to(roomId).emit('wave_start', { wave: room.wave, count });
    io.to(roomId).emit('bots_update', Object.values(room.bots));
}

// نظام الكاش للوحة الصدارة لتقليل الضغط على Firebase
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
    } catch (e) { 
        return cachedLeaderboard; 
    }
}

function sendLeaderboard(roomId) {
    fetchLeaderboard().then(top => {
        io.to(roomId).emit('leaderboard_update', top);
    }).catch(() => {});
}

/**
 * دالة مزامنة بيانات اللاعب وحفظها في Firebase دفعة واحدة
 * @param {Object} player - كائن اللاعب المراد حفظ بياناته
 * @param {number} currentWave - رقم الموجة الحالية لحفظ المستوى
 */
async function syncPlayerStatsToFirebase(player, currentWave) {
    if (!player.uid || player.killsInWave === 0) return; // لا داعي للكتابة إذا لم يحقق قتلات جديدة
    try {
        // جلب البيانات الحالية للاعب من Firebase أولاً لضمان عدم تداخل البيانات
        const res = await fetch(`${DB_URL}/users/${player.uid}.json`);
        let currentKills = 0;
        let currentLevel = 1;
        
        if (res.ok) {
            const data = await res.json();
            if (data) {
                currentKills = data.total_kills || 0;
                currentLevel = data.level || 1;
            }
        }

        // دمج القتلات الجديدة مع القديمة وتحديث المستوى
        const updatedKills = currentKills + player.killsInWave;
        const updatedLevel = Math.max(currentLevel, currentWave);

        // إرسال البيانات المحدثة بعملية PATCH واحدة فقط
        await fetch(`${DB_URL}/users/${player.uid}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                total_kills: updatedKills,
                level: updatedLevel
            })
        });

        console.log(`Successfully synced stats for ${player.name}. Added Kills: ${player.killsInWave}`);
        
        // تصفير العداد المؤقت بعد نجاح عملية الحفظ في الداتابيز
        player.killsInWave = 0;
        lastFetch = 0; // تصفير كاش الليدربورد لتحديث الترتيب فوراً
    } catch (e) {
        console.error(`Failed to sync stats for ${player.name}:`, e);
    }
}

// معالجة اتصالات اللاعبين عبر الـ Socket
io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    socket.on('join_match', (data) => {
        const { mode, username, uid, level, islands } = data || {};
        socket.username = username || 'Commander';
        socket.uid = uid || '';
        socket.mode = mode || '4VBOT';
        socket.startLevel = Math.max(1, level || 1);

        if (socket.mode !== '1VBOT' && socket.mode !== '4VBOT') {
            socket.emit('mode_rejected');
            return;
        }

        let roomId = findOpenRoom(socket.mode);
        if (!roomId) {
            roomId = createRoom(socket.mode, socket.startLevel);
            if (islands && Array.isArray(islands)) {
                rooms[roomId].islands = islands;
            }
        }

        const room = rooms[roomId];
        socket.join(roomId);
        socket.currentRoom = roomId;

        if (socket.startLevel > room.wave) {
            room.wave = socket.startLevel;
        }

        // رسبنة اللاعب الجديد في مكان بعيد عن المركز لضمان الأمان عند الدخول
        const sp = randomSpawnNearSafe(WORLD_SIZE / 2, WORLD_SIZE / 2, 2500, 5000, room.islands);
        room.players[socket.id] = {
            id: socket.id,
            name: socket.username,
            uid: socket.uid,
            x: sp.x, 
            y: sp.y, 
            heading: 0,
            hp: 100,
            killsInWave: 0, // عداد القتلات المؤقت داخل الموجة الحالية
            level: socket.startLevel
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
            mode: socket.mode,
            islands: room.islands
        });

        const existing = Object.values(room.players)
            .filter(p => p.id !== socket.id)
            .map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, heading: p.heading }));
        socket.emit('room_state', { players: existing, wave: room.wave });

        socket.to(roomId).emit('player_joined', {
            id: socket.id, name: socket.username, x: sp.x, y: sp.y, heading: 0
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
        p.x = data.x; 
        p.y = data.y; 
        p.heading = data.heading;
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
            if (p) {
                p.killsInWave += 1; // زيادة العداد المؤقت في الذاكرة فقط
            }

            io.to(socket.currentRoom).emit('bot_killed', {
                botId: data.botId,
                byId: socket.id,
                byName: p ? p.name : '?'
            });

            // التحقق من انتهاء الموجة بالكامل
            if (Object.keys(room.bots).length === 0) {
                const currentWave = room.wave;

                // 1. حفظ قتلات جميع اللاعبين في الغرفة دفعة واحدة إلى Firebase
                Object.values(room.players).forEach(pl => {
                    if (pl.killsInWave > 0) {
                        syncPlayerStatsToFirebase(pl, currentWave);
                    }
                });

                // 2. الانتقال للموجة التالية
                room.wave += 1;

                sendLeaderboard(socket.currentRoom);
                io.to(socket.currentRoom).emit('level_up', { wave: room.wave });
                
                // 3. رسبنة الموجة الجديدة في مكان أبعد
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

            setTimeout(() => {
                const r = rooms[socket.currentRoom];
                if (!r) return;
                
                const allDead = Object.values(r.players).every(pl => pl.hp <= 0);
                if (allDead && Object.keys(r.players).length > 0) {
                    io.to(socket.currentRoom).emit('team_wipe');
                    endRoom(socket.currentRoom);
                    return;
                }
                
                if (r.players[socket.id]) {
                    // رسبنة اللاعب بعد الموت في مكان بعيد وآمن
                    const sp = randomSpawnNearSafe(WORLD_SIZE / 2, WORLD_SIZE / 2, 3000, 5500, r.islands);
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

    socket.on('leave_match', () => leaveRoom(socket));
    socket.on('disconnect', () => {
        console.log('Disconnected:', socket.id);
        leaveRoom(socket);
    });
});

// دالة مغادرة الغرفة مع حفظ البيانات المتبقية للاعب قبل خروجه
function leaveRoom(socket) {
    const roomId = socket.currentRoom;
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;

    const p = room.players[socket.id];
    if (p && p.killsInWave > 0) {
        // حفظ القتلات التي حققها اللاعب في هذه الموجة قبل خروجه مباشرة لكي لا تضيع عليه
        syncPlayerStatsToFirebase(p, room.wave);
    }

    delete room.players[socket.id];
    io.to(roomId).emit('player_left', { id: socket.id });
    socket.leave(roomId);
    socket.currentRoom = null;

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

// تنظيف الغرف الفارغة بشكل دوري
setInterval(() => {
    for (const id in rooms) {
        if (Object.keys(rooms[id].players).length === 0) endRoom(id);
    }
}, 30000);

server.listen(PORT, () => {
    console.log(`Co-op server v14.2 running on port ${PORT}`);
});
