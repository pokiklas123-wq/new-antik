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
const MAX_FFA_PLAYERS = 100;
const WORLD_MIN = 400, WORLD_MAX = 5600;

let tdmQueue = [];
let activeMatches = {}; // غرف TDM
let ffaRooms = {};      // غرف FFA المفتوحة (حتى 100 لاعب)

app.get('/', (req, res) => {
    res.send('Grand3D Ultimate Game Server v6.0 is Live!');
});

function randomSpawn() {
    return {
        x: WORLD_MIN + Math.random() * (WORLD_MAX - WORLD_MIN),
        y: WORLD_MIN + Math.random() * (WORLD_MAX - WORLD_MIN),
        heading: Math.random() * 360
    };
}

io.on('connection', (socket) => {
    console.log(`Player Connected: ${socket.id}`);

    // 1. طلب الدخول من اللوبي
    socket.on('join_match', (data) => {
        const { mode, skin, username } = data;
        socket.username = username || "Commander";
        socket.skin = skin || "bt1";
        socket.gameMode = mode;

        if (mode === "FFA") {
            let roomToJoin = null;
            for (const roomId in ffaRooms) {
                if (Object.keys(ffaRooms[roomId].players).length < MAX_FFA_PLAYERS) {
                    roomToJoin = roomId;
                    break;
                }
            }
            if (!roomToJoin) {
                roomToJoin = `ffa_room_${Date.now()}`;
                ffaRooms[roomToJoin] = { id: roomToJoin, players: {} };
                console.log(`New FFA Room Created: ${roomToJoin}`);
            }

            // تنظيف اللاعب من أي غرفة سابقة (أمان ضد الانضمام المزدوج)
            leaveCurrentRoom(socket);

            socket.join(roomToJoin);
            socket.currentRoom = roomToJoin;

            const sp = randomSpawn();
            ffaRooms[roomToJoin].players[socket.id] = {
                id: socket.id,
                name: socket.username,
                skin: socket.skin,
                x: sp.x, y: sp.y, heading: sp.heading,
                hp: 100,
                kills: 0
            };

            // اللاعب الجديد يدخل فوراً
            socket.emit('match_found', {
                matchId: roomToJoin,
                role: "FFA",
                spawnX: sp.x,
                spawnY: sp.y,
                spawnHeading: sp.heading,
                opponentId: "FFA_MULTIPLAYER"
            });

            // إرسال قائمة كل اللاعبين الموجودين مسبقاً للاعب الجديد
            const existing = Object.values(ffaRooms[roomToJoin].players)
                .filter(p => p.id !== socket.id)
                .map(p => ({ id: p.id, name: p.name, skin: p.skin, x: p.x, y: p.y, heading: p.heading, hp: p.hp }));
            socket.emit('ffa_state', { yourId: socket.id, players: existing });

            // إعلام البقية بدخول لاعب جديد
            socket.to(roomToJoin).emit('opponent_joined_ffa', {
                id: socket.id,
                name: socket.username,
                skin: socket.skin,
                x: sp.x, y: sp.y, heading: sp.heading
            });

            sendLeaderboardUpdate(roomToJoin);

        } else {
            // TDM 1v1
            if (tdmQueue.includes(socket.id)) return;
            leaveCurrentRoom(socket);
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

                    s1.emit('match_found', { matchId, role: "Red", spawnX: 2000, spawnY: 2000, spawnHeading: 0, opponentId: p2 });
                    s2.emit('match_found', { matchId, role: "Blue", spawnX: 4000, spawnY: 4000, spawnHeading: 180, opponentId: p1 });
                }
            }
        }
    });

    // 2. مزامنة الحركة (مع تقييد معدل خفيف لمنع السبام)
    socket.on('update_movement', (data) => {
        const { matchId, x, y, heading, speed } = data;
        if (!matchId || matchId !== socket.currentRoom) return;

        if (ffaRooms[matchId] && ffaRooms[matchId].players[socket.id]) {
            let p = ffaRooms[matchId].players[socket.id];
            p.x = x; p.y = y; p.heading = heading;
        }

        socket.to(matchId).emit('opponent_moved', {
            senderId: socket.id,
            senderRole: socket.gameMode === "FFA" ? "FFA" : data.role,
            skin: socket.skin,
            name: socket.username,
            x, y, heading, speed
        });
    });

    // 3. إطلاق التوربيدو
    socket.on('fire_torpedo', (data) => {
        const { matchId, x, y, heading } = data;
        if (!matchId || matchId !== socket.currentRoom) return;
        socket.to(matchId).emit('opponent_fired', {
            senderId: socket.id,
            senderRole: socket.gameMode === "FFA" ? "FFA" : data.role,
            x, y, heading
        });
    });

    // 4. تسجيل الضرر والقتلات
    socket.on('register_hit', (data) => {
        const { matchId, damage } = data;
        if (!matchId || matchId !== socket.currentRoom) return;

        if (socket.gameMode === "FFA") {
            const targetId = data.targetId;
            const room = ffaRooms[matchId];
            if (!room) return;

            let target = room.players[targetId];
            if (!target || target.hp <= 0) return;

            target.hp -= damage;

            if (target.hp <= 0) {
                target.hp = 0;
                if (room.players[socket.id]) room.players[socket.id].kills += 1;

                io.to(matchId).emit('player_killed_ffa', {
                    killedId: targetId,
                    killedName: target.name,
                    killerId: socket.id,
                    killerName: socket.username
                });

                setTimeout(() => {
                    if (room.players[targetId]) {
                        const sp = randomSpawn();
                        room.players[targetId].hp = 100;
                        room.players[targetId].kills = 0; // تصفير قتلات الجولة عند الموت
                        room.players[targetId].x = sp.x;
                        room.players[targetId].y = sp.y;

                        io.to(targetId).emit('respawn_ffa', {
                            spawnX: sp.x, spawnY: sp.y, spawnHeading: sp.heading
                        });
                        // إعلام البقية بموقع اللاعب الجديد
                        socket.to(matchId).emit('opponent_joined_ffa', {
                            id: targetId,
                            name: target.name,
                            skin: target.skin,
                            x: sp.x, y: sp.y, heading: sp.heading
                        });
                    }
                }, 2000);

                sendLeaderboardUpdate(matchId);
            } else {
                io.to(matchId).emit('hp_sync_ffa', { playerId: targetId, hp: target.hp });
            }

        } else {
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

                const killerScore = match.players[socket.id].score;
                const oppScore = opponent.score;

                io.to(matchId).emit('player_killed', {
                    killedRole: opponent.role,
                    killerRole: match.players[socket.id].role,
                    scores: {
                        "Red": match.players[socket.id].role === "Red" ? killerScore : oppScore,
                        "Blue": match.players[socket.id].role === "Blue" ? killerScore : oppScore
                    }
                });

                if (killerScore >= match.maxKills) {
                    io.to(matchId).emit('game_over', {
                        winnerRole: match.players[socket.id].role,
                        loserRole: opponent.role
                    });
                    cleanupMatch(matchId);
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
                io.to(matchId).emit('hp_sync', { role: opponent.role, hp: opponent.hp });
            }
        }
    });

    // 5. الضرر الذاتي (الجبال الحمراء)
    socket.on('sync_self_damage', (data) => {
        const { matchId, hp } = data;
        if (!matchId || matchId !== socket.currentRoom) return;

        if (socket.gameMode === "FFA") {
            const room = ffaRooms[matchId];
            if (!room || !room.players[socket.id]) return;

            room.players[socket.id].hp = hp;

            if (hp <= 0) {
                room.players[socket.id].hp = 100;
                room.players[socket.id].kills = 0;

                io.to(matchId).emit('player_killed_ffa', {
                    killedId: socket.id,
                    killedName: socket.username,
                    killerId: "ENVIRONMENT",
                    killerName: "MOUNTAIN"
                });

                setTimeout(() => {
                    if (room.players[socket.id]) {
                        const sp = randomSpawn();
                        room.players[socket.id].x = sp.x;
                        room.players[socket.id].y = sp.y;
                        io.to(socket.id).emit('respawn_ffa', {
                            spawnX: sp.x, spawnY: sp.y, spawnHeading: sp.heading
                        });
                    }
                }, 2000);

                sendLeaderboardUpdate(matchId);
            } else {
                io.to(matchId).emit('hp_sync_ffa', { playerId: socket.id, hp: hp });
            }
        }
    });

    // 6. الخروج الطوعي من المباراة (بدون قطع السوكيت)
    socket.on('leave_game', () => {
        leaveCurrentRoom(socket);
    });

    // 7. انقطاع الاتصال
    socket.on('disconnect', () => {
        console.log(`Disconnected: ${socket.id}`);
        tdmQueue = tdmQueue.filter(id => id !== socket.id);
        leaveCurrentRoom(socket);
    });
});

function leaveCurrentRoom(socket) {
    const room = socket.currentRoom;
    if (!room) return;
    socket.currentRoom = null;

    if (ffaRooms[room]) {
        delete ffaRooms[room].players[socket.id];
        socket.to(room).emit('opponent_left_ffa', { id: socket.id });
        socket.leave(room);
        sendLeaderboardUpdate(room);

        if (Object.keys(ffaRooms[room].players).length === 0) {
            delete ffaRooms[room];
        }
    } else if (activeMatches[room]) {
        socket.to(room).emit('opponent_disconnected');
        socket.leave(room);
        cleanupMatch(room);
    }
}

function cleanupMatch(matchId) {
    const match = activeMatches[matchId];
    if (!match) return;
    for (const pid of Object.keys(match.players)) {
        const s = io.sockets.sockets.get(pid);
        if (s) {
            s.currentRoom = null;
            s.leave(matchId);
        }
    }
    delete activeMatches[matchId];
}

function sendLeaderboardUpdate(roomId) {
    const room = ffaRooms[roomId];
    if (!room) return;

    let sortedPlayers = Object.values(room.players)
        .sort((a, b) => b.kills - a.kills)
        .slice(0, 5)
        .map(p => ({ name: p.name, kills: p.kills }));

    io.to(roomId).emit('leaderboard_update', sortedPlayers);
}

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
