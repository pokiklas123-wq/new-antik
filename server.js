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

let matchmakingQueue = [];
let activeMatches = {};

app.get('/', (req, res) => {
    res.send('Grand3D TDM Server v2.0 is Running!');
});

io.on('connection', (socket) => {
    console.log(`Connected: ${socket.id}`);

    // 1. البحث عن مباراة من صفحة الهوم
    socket.on('join_match', () => {
        if (matchmakingQueue.includes(socket.id)) return;
        matchmakingQueue.push(socket.id);
        console.log(`Queue size: ${matchmakingQueue.length}`);

        if (matchmakingQueue.length >= 2) {
            const p1 = matchmakingQueue.shift();
            const p2 = matchmakingQueue.shift();
            const matchId = `match_${p1}_${p2}`;

            const s1 = io.sockets.sockets.get(p1);
            const s2 = io.sockets.sockets.get(p2);

            if (s1 && s2) {
                activeMatches[matchId] = {
                    id: matchId,
                    players: {}, // سيتم ملؤها عند دخول MainActivity
                    scores: { [p1]: 0, [p2]: 0 },
                    maxKills: 4
                };

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
    });

    // 2. تسجيل الدخول الفعلي للعبة (MainActivity) لتحديث الـ Socket ID
    socket.on('join_game', (data) => {
        const { matchId, role } = data;
        socket.join(matchId);

        if (!activeMatches[matchId]) {
            activeMatches[matchId] = {
                id: matchId,
                players: {},
                scores: {},
                maxKills: 4
            };
        }

        // تسجيل اللاعب بالـ Socket ID الجديد والنشط داخل اللعبة
        activeMatches[matchId].players[socket.id] = {
            role: role,
            hp: 100,
            score: 0
        };

        console.log(`Player ${socket.id} joined room ${matchId} as ${role}`);
    });

    // 3. مزامنة الحركة الفورية
    socket.on('update_movement', (data) => {
        const { matchId, x, y, heading, speed } = data;
        socket.to(matchId).emit('opponent_moved', {
            x: x,
            y: y,
            heading: heading,
            speed: speed
        });
    });

    // 4. مزامنة إطلاق النار
    socket.on('fire_torpedo', (data) => {
        const { matchId, x, y, heading } = data;
        socket.to(matchId).emit('opponent_fired', {
            x: x,
            y: y,
            heading: heading
        });
    });

    // 5. تسجيل الضرر والقتلات
    socket.on('register_hit', (data) => {
        const { matchId, damage } = data;
        const match = activeMatches[matchId];
        if (!match) return;

        const opponentId = Object.keys(match.players).find(id => id !== socket.id);
        if (!opponentId) return;

        let opponent = match.players[opponentId];
        opponent.hp -= damage;

        if (opponent.hp <= 0) {
            opponent.hp = 0;
            match.players[socket.id].score += 1;

            io.to(matchId).emit('player_killed', {
                killedPlayerId: opponentId,
                killerId: socket.id,
                scores: {
                    [socket.id]: match.players[socket.id].score,
                    [opponentId]: match.players[opponentId].score
                }
            });

            if (match.players[socket.id].score >= match.maxKills) {
                io.to(matchId).emit('game_over', {
                    winnerId: socket.id,
                    loserId: opponentId
                });
                delete activeMatches[matchId];
            } else {
                // إعادة تعيين الجولة بعد 3 ثوانٍ
                setTimeout(() => {
                    if (activeMatches[matchId]) {
                        match.players[socket.id].hp = 100;
                        match.players[opponentId].hp = 100;

                        const p1Id = Object.keys(match.players)[0];
                        const p2Id = Object.keys(match.players)[1];

                        io.to(p1Id).emit('round_start', {
                            spawnX: 2000, spawnY: 2000, spawnHeading: 0, hp: 100
                        });
                        io.to(p2Id).emit('round_start', {
                            spawnX: 4000, spawnY: 4000, spawnHeading: 180, hp: 100
                        });
                    }
                }, 3000);
            }
        } else {
            io.to(matchId).emit('hp_sync', {
                playerId: opponentId,
                hp: opponent.hp
            });
        }
    });

    // 6. مزامنة الضرر الذاتي (مثل الاصطدام بالجبال)
    socket.on('sync_self_damage', (data) => {
        const { matchId, hp } = data;
        const match = activeMatches[matchId];
        if (!match) return;

        if (match.players[socket.id]) {
            match.players[socket.id].hp = hp;
            
            if (hp <= 0) {
                const opponentId = Object.keys(match.players).find(id => id !== socket.id);
                if (opponentId) {
                    match.players[opponentId].score += 1;
                    io.to(matchId).emit('player_killed', {
                        killedPlayerId: socket.id,
                        killerId: opponentId,
                        scores: {
                            [opponentId]: match.players[opponentId].score,
                            [socket.id]: match.players[socket.id].score
                        }
                    });

                    if (match.players[opponentId].score >= match.maxKills) {
                        io.to(matchId).emit('game_over', {
                            winnerId: opponentId,
                            loserId: socket.id
                        });
                        delete activeMatches[matchId];
                    } else {
                        setTimeout(() => {
                            if (activeMatches[matchId]) {
                                match.players[socket.id].hp = 100;
                                match.players[opponentId].hp = 100;
                                io.to(socket.id).emit('round_start', {
                                    spawnX: socket.id === Object.keys(match.players)[0] ? 2000 : 4000,
                                    spawnY: socket.id === Object.keys(match.players)[0] ? 2000 : 4000,
                                    spawnHeading: socket.id === Object.keys(match.players)[0] ? 0 : 180,
                                    hp: 100
                                });
                                io.to(opponentId).emit('round_start', {
                                    spawnX: opponentId === Object.keys(match.players)[0] ? 2000 : 4000,
                                    spawnY: opponentId === Object.keys(match.players)[0] ? 2000 : 4000,
                                    spawnHeading: opponentId === Object.keys(match.players)[0] ? 0 : 180,
                                    hp: 100
                                });
                            }
                        }, 3000);
                    }
                }
            } else {
                io.to(matchId).emit('hp_sync', {
                    playerId: socket.id,
                    hp: hp
                });
            }
        }
    });

    socket.on('disconnect', () => {
        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);
        for (const matchId in activeMatches) {
            if (activeMatches[matchId].players[socket.id]) {
                socket.to(matchId).emit('opponent_disconnected');
                delete activeMatches[matchId];
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
