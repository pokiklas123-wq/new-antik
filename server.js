const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// أوعية البيانات لإدارة الأطوار المختلفة
let tdmQueue = [];
let activeMatches = {}; // غرف TDM المغلقة
let ffaRooms = {};     // غرف FFA المفتوحة (حتى 100 لاعب لكل غرفة)

app.get('/', (req, res) => {
    res.send('Grand3D Ultimate Game Server v5.0 is Live!');
});

io.on('connection', (socket) => {
    console.log(`Player Connected: ${socket.id}`);

    // 1. استقبال طلب الدخول من اللوبي (TDM أو FFA)
    socket.on('join_match', (data) => {
        const { mode, skin, username } = data;
        socket.username = username || "Commander";
        socket.skin = skin || "bt1";
        socket.gameMode = mode;

        if (mode === "FFA") {
            // منطق طور Endless FFA (حتى 100 لاعب)
            let roomToJoin = null;

            // البحث عن غرفة FFA نشطة بها مساحة (أقل من 100 لاعب)
            for (const roomId in ffaRooms) {
                if (Object.keys(ffaRooms[roomId].players).length < 100) {
                    roomToJoin = roomId;
                    break;
                }
            }

            // إذا لم تتوفر غرفة، ننشئ غرفة جديدة
            if (!roomToJoin) {
                roomToJoin = `ffa_room_${Date.now()}`;
                ffaRooms[roomToJoin] = {
                    id: roomToJoin,
                    players: {}
                };
                console.log(`New FFA Room Created: ${roomToJoin}`);
            }

            // إضافة اللاعب للغرفة
            socket.join(roomToJoin);
            socket.currentRoom = roomToJoin;

            ffaRooms[roomToJoin].players[socket.id] = {
                id: socket.id,
                name: socket.username,
                skin: socket.skin,
                x: 1000 + Math.random() * 4000,
                y: 1000 + Math.random() * 4000,
                heading: Math.random() * 360,
                hp: 100,
                kills: 0
            };

            // إرسال حدث الدخول الفوري للاعب دون انتظار
            socket.emit('match_found', {
                matchId: roomToJoin,
                role: "FFA",
                spawnX: ffaRooms[roomToJoin].players[socket.id].x,
                spawnY: ffaRooms[roomToJoin].players[socket.id].y,
                spawnHeading: ffaRooms[roomToJoin].players[socket.id].heading,
                opponentId: "FFA_MULTIPLAYER"
            });

            // إعلام بقية اللاعبين في الغرفة بدخول لاعب جديد
            socket.to(roomToJoin).emit('opponent_joined_ffa', {
                id: socket.id,
                name: socket.username,
                skin: socket.skin,
                x: ffaRooms[roomToJoin].players[socket.id].x,
                y: ffaRooms[roomToJoin].players[socket.id].y,
                heading: ffaRooms[roomToJoin].players[socket.id].heading
            });

            // تحديث قائمة المتصدرين للغرفة
            sendLeaderboardUpdate(roomToJoin);

        } else {
            // منطق طور TDM (المطابقة الثنائية السريعة)
            if (tdmQueue.includes(socket.id)) return;
            tdmQueue.push(socket.id);

            if (tdmQueue.length >= 2) {
                const p1 = tdmQueue.shift();
                const p2 = tdmQueue.shift();
                const matchId = `tdm_${p1}_${p2}`;

                const s1 = io.sockets.sockets.get(p1);
                const s2 = io.sockets.sockets.get(p2);

                if (s1 && s2) {
                    activeMatches[matchId] = {
                        id: matchId,
                        roundActive: true,
                        players: {
                            [p1]: { role: "Red", hp: 100, score: 0, skin: s1.skin, name: s1.username },
                            [p2]: { role: "Blue", hp: 100, score: 0, skin: s2.skin, name: s2.username }
                        },
                        maxKills: 4
                    };

                    s1.join(matchId);
                    s2.join(matchId);
                    s1.currentRoom = matchId;
                    s2.currentRoom = matchId;

                    s1.emit('match_found', {
                        matchId: matchId,
                        role: "Red",
                        spawnX: 2000,
                        spawnY: 2000,
                        spawnHeading: 0,
                        opponentId: p2
                    });

                    s2.emit('match_found', {
                        matchId: matchId,
                        role: "Blue",
                        spawnX: 4000,
                        spawnY: 4000,
                        spawnHeading: 180,
                        opponentId: p1
                    });
                }
            }
        }
    });

    // 2. مزامنة الحركة الفورية لجميع الأطوار
    socket.on('update_movement', (data) => {
        const { matchId, x, y, heading, speed } = data;
        
        // تحديث إحداثيات اللاعب في الذاكرة لغرف FFA
        if (ffaRooms[matchId] && ffaRooms[matchId].players[socket.id]) {
            let p = ffaRooms[matchId].players[socket.id];
            p.x = x; p.y = y; p.heading = heading;
        }

        // بث الحركة لبقية اللاعبين في الغرفة
        socket.to(matchId).emit('opponent_moved', {
            senderId: socket.id,
            senderRole: socket.gameMode === "FFA" ? "FFA" : data.role,
            skin: socket.skin,
            name: socket.username,
            x: x,
            y: y,
            heading: heading,
            speed: speed
        });
    });

    // 3. مزامنة إطلاق التوربيدو
    socket.on('fire_torpedo', (data) => {
        const { matchId, x, y, heading } = data;
        socket.to(matchId).emit('opponent_fired', {
            senderId: socket.id,
            senderRole: socket.gameMode === "FFA" ? "FFA" : data.role,
            x: x,
            y: y,
            heading: heading
        });
    });

    // 4. تسجيل الضرر والقتلات المشترك
    socket.on('register_hit', (data) => {
        const { matchId, damage } = data;
        
        if (socket.gameMode === "FFA") {
            // منطق الضرر في طور FFA Endless
            const targetId = data.targetId; // معرف اللاعب المتضرر
            const room = ffaRooms[matchId];
            if (!room) return;

            let target = room.players[targetId];
            if (!target || target.hp <= 0) return;

            target.hp -= damage;

            if (target.hp <= 0) {
                target.hp = 0;
                room.players[socket.id].kills += 1; // زيادة قتلات القاتل

                io.to(matchId).emit('player_killed_ffa', {
                    killedId: targetId,
                    killedName: target.name,
                    killerId: socket.id,
                    killerName: socket.username
                });

                // إعادة توليد اللاعب الميت فوراً بدم كامل وقتلات 0
                setTimeout(() => {
                    if (room.players[targetId]) {
                        room.players[targetId].hp = 100;
                        room.players[targetId].kills = 0; // تصفير قتلات الميت
                        room.players[targetId].x = 1000 + Math.random() * 4000;
                        room.players[targetId].y = 1000 + Math.random() * 4000;

                        io.to(targetId).emit('respawn_ffa', {
                            spawnX: room.players[targetId].x,
                            spawnY: room.players[targetId].y,
                            spawnHeading: Math.random() * 360
                        });
                    }
                }, 2000);

                sendLeaderboardUpdate(matchId);
            } else {
                io.to(matchId).emit('hp_sync_ffa', {
                    playerId: targetId,
                    hp: target.hp
                });
            }

        } else {
            // منطق الضرر في طور TDM
            const match = activeMatches[matchId];
            if (!match || !match.roundActive) return;

            const opponentId = Object.keys(match.players).find(id => id !== socket.id);
            if (!opponentId) return;

            let opponent = match.players[opponentId];
            opponent.hp -= damage;

            if (opponent.hp <= 0) {
                match.roundActive = false;
                opponent.hp = 100;
                match.players[socket.id].score += 1;

                io.to(matchId).emit('player_killed', {
                    killedRole: opponent.role,
                    killerRole: match.players[socket.id].role,
                    scores: {
                        "Red": match.players[socket.id].role === "Red" ? match.players[socket.id].score : opponent.score,
                        "Blue": match.players[socket.id].role === "Blue" ? match.players[socket.id].score : opponent.score
                    }
                });

                if (match.players[socket.id].score >= match.maxKills) {
                    io.to(matchId).emit('game_over', {
                        winnerRole: match.players[socket.id].role,
                        loserRole: opponent.role
                    });
                    delete activeMatches[matchId];
                } else {
                    setTimeout(() => {
                        if (activeMatches[matchId]) {
                            match.players[socket.id].hp = 100;
                            match.players[opponentId].hp = 100;
                            match.roundActive = true;

                            io.to(matchId).emit('round_start', {
                                "Red": { spawnX: 2000, spawnY: 2000, spawnHeading: 0 },
                                "Blue": { spawnX: 4000, spawnY: 4000, spawnHeading: 180 }
                            });
                        }
                    }, 3000);
                }
            } else {
                io.to(matchId).emit('hp_sync', {
                    role: opponent.role,
                    hp: opponent.hp
                });
            }
        }
    });

    // 5. مزامنة الضرر الذاتي (الاصطدام بالجبال)
    socket.on('sync_self_damage', (data) => {
        const { matchId, hp } = data;
        
        if (socket.gameMode === "FFA") {
            const room = ffaRooms[matchId];
            if (!room || !room.players[socket.id]) return;

            room.players[socket.id].hp = hp;

            if (hp <= 0) {
                room.players[socket.id].hp = 100;
                room.players[socket.id].kills = 0; // تصفير قتلاته لأنه انتحر بالاصطدام

                io.to(matchId).emit('player_killed_ffa', {
                    killedId: socket.id,
                    killedName: socket.username,
                    killerId: "ENVIRONMENT",
                    killerName: "MOUNTAIN"
                });

                setTimeout(() => {
                    if (room.players[socket.id]) {
                        room.players[socket.id].x = 1000 + Math.random() * 4000;
                        room.players[socket.id].y = 1000 + Math.random() * 4000;

                        io.to(socket.id).emit('respawn_ffa', {
                            spawnX: room.players[socket.id].x,
                            spawnY: room.players[socket.id].y,
                            spawnHeading: Math.random() * 360
                        });
                    }
                }, 2000);

                sendLeaderboardUpdate(matchId);
            } else {
                io.to(matchId).emit('hp_sync_ffa', {
                    playerId: socket.id,
                    hp: hp
                });
            }
        }
    });

    // 6. عند انقطاع الاتصال
    socket.on('disconnect', () => {
        console.log(`Disconnected: ${socket.id}`);
        tdmQueue = tdmQueue.filter(id => id !== socket.id);

        const room = socket.currentRoom;
        if (room) {
            if (ffaRooms[room]) {
                delete ffaRooms[room].players[socket.id];
                socket.to(room).emit('opponent_left_ffa', { id: socket.id });
                sendLeaderboardUpdate(room);

                // مسح الغرفة إذا أصبحت فارغة تماماً
                if (Object.keys(ffaRooms[room].players).length === 0) {
                    delete ffaRooms[room];
                }
            } else if (activeMatches[room]) {
                socket.to(room).emit('opponent_disconnected');
                delete activeMatches[room];
            }
        }
    });
});

// دالة حساب وإرسال قائمة المتصدرين (Leaderboard) لغرف FFA
function sendLeaderboardUpdate(roomId) {
    const room = ffaRooms[roomId];
    if (!room) return;

    // تحويل اللاعبين إلى مصفوفة وترتيبهم تنازلياً حسب عدد القتلات
    let sortedPlayers = Object.values(room.players)
        .sort((a, b) => b.kills - a.kills)
        .slice(0, 5) // جلب أعلى 5 لاعبين فقط
        .map(p => ({ name: p.name, kills: p.kills }));

    io.to(roomId).emit('leaderboard_update', sortedPlayers);
}

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
