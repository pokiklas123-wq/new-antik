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
    res.send('Grand3D TDM Server v3.0 - Smooth Lerp & Role Sync is Active!');
});

io.on('connection', (socket) => {
    console.log(`Connected: ${socket.id}`);

    socket.on('join_match', () => {
        if (matchmakingQueue.includes(socket.id)) return;
        matchmakingQueue.push(socket.id);

        if (matchmakingQueue.length >= 2) {
            const p1 = matchmakingQueue.shift();
            const p2 = matchmakingQueue.shift();
            const matchId = `match_${p1}_${p2}`;

            const s1 = io.sockets.sockets.get(p1);
            const s2 = io.sockets.sockets.get(p2);

            if (s1 && s2) {
                activeMatches[matchId] = {
                    id: matchId,
                    players: {
                        "Red": { socketId: p1, hp: 100, score: 0 },
                        "Blue": { socketId: p2, hp: 100, score: 0 }
                    },
                    maxKills: 4
                };

                s1.emit('match_found', {
                    matchId: matchId,
                    role: "Red",
                    spawnX: 2000,
                    spawnY: 2000,
                    spawnHeading: 0
                });

                s2.emit('match_found', {
                    matchId: matchId,
                    role: "Blue",
                    spawnX: 4000,
                    spawnY: 4000,
                    spawnHeading: 180
                });
            }
        }
    });

    socket.on('join_game', (data) => {
        const { matchId, role } = data;
        socket.join(matchId);

        if (activeMatches[matchId] && activeMatches[matchId].players[role]) {
            // تحديث الـ socketId الجديد للاعب بعد انتقاله لصفحة اللعبة
            activeMatches[matchId].players[role].socketId = socket.id;
            console.log(`Player registered in-game: Room ${matchId} as Role ${role}`);
        }
    });

    socket.on('update_movement', (data) => {
        const { matchId, role, x, y, heading, speed } = data;
        // إرسال الحركة للخصم مع تحديد دور المرسل لكي يعرف المستقبل من يتحرك
        socket.to(matchId).emit('opponent_moved', {
            senderRole: role,
            x: x,
            y: y,
            heading: heading,
            speed: speed
        });
    });

    socket.on('fire_torpedo', (data) => {
        const { matchId, role, x, y, heading } = data;
        socket.to(matchId).emit('opponent_fired', {
            senderRole: role,
            x: x,
            y: y,
            heading: heading
        });
    });

    socket.on('sync_self_damage', (data) => {
        const { matchId, role, hp } = data;
        const match = activeMatches[matchId];
        if (!match) return;

        const player = match.players[role];
        if (!player) return;

        player.hp = hp;

        if (hp <= 0) {
            player.hp = 100; // إعادة تعيين الصحة للجولة القادمة
            const opponentRole = role === "Red" ? "Blue" : "Red";
            match.players[opponentRole].score += 1;

            const currentScores = {
                "Red": match.players["Red"].score,
                "Blue": match.players["Blue"].score
            };

            io.to(matchId).emit('player_killed', {
                killedRole: role,
                killerRole: opponentRole,
                scores: currentScores
            });

            if (match.players[opponentRole].score >= match.maxKills) {
                io.to(matchId).emit('game_over', {
                    winnerRole: opponentRole,
                    loserRole: role
                });
                delete activeMatches[matchId];
            } else {
                setTimeout(() => {
                    if (activeMatches[matchId]) {
                        match.players["Red"].hp = 100;
                        match.players["Blue"].hp = 100;

                        io.to(matchId).emit('round_start', {
                            "Red": { spawnX: 2000, spawnY: 2000, spawnHeading: 0 },
                            "Blue": { spawnX: 4000, spawnY: 4000, spawnHeading: 180 }
                        });
                    }
                }, 3000);
            }
        } else {
            io.to(matchId).emit('hp_sync', {
                role: role,
                hp: hp
            });
        }
    });

    socket.on('disconnect', () => {
        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);
        for (const matchId in activeMatches) {
            const match = activeMatches[matchId];
            if (match.players["Red"].socketId === socket.id || match.players["Blue"].socketId === socket.id) {
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
