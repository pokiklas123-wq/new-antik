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

// قائمة الانتظار للاعبين الذين يبحثون عن مباراة
let matchmakingQueue = [];

// غرف المباريات النشطة
let activeMatches = {};

app.get('/', (req, res) => {
    res.send('Grand3D TDM Game Server is Running smoothly!');
});

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // 1. عند طلب الدخول في مباراة (Matchmaking)
    socket.on('join_match', (data) => {
        // التحقق من عدم تكرار اللاعب في قائمة الانتظار
        if (matchmakingQueue.includes(socket.id)) return;

        matchmakingQueue.push(socket.id);
        console.log(`Player ${socket.id} joined queue. Queue size: ${matchmakingQueue.length}`);

        // إذا توفر لاعبان في قائمة الانتظار، يتم بدء المباراة فوراً
        if (matchmakingQueue.length >= 2) {
            const player1Id = matchmakingQueue.shift();
            const player2Id = matchmakingQueue.shift();

            const matchId = `match_${player1Id}_${player2Id}`;

            const player1Socket = io.sockets.sockets.get(player1Id);
            const player2Socket = io.sockets.sockets.get(player2Id);

            if (player1Socket && player2Socket) {
                // إدخال اللاعبين في غرفة خاصة بالمباراة
                player1Socket.join(matchId);
                player2Socket.join(matchId);

                // إنشاء بيانات المباراة الافتراضية
                activeMatches[matchId] = {
                    id: matchId,
                    players: {
                        [player1Id]: { x: 2000, y: 2000, heading: 0, hp: 100, score: 0, role: "Red" },
                        [player2Id]: { x: 4000, y: 4000, heading: 180, hp: 100, score: 0, role: "Blue" }
                    },
                    maxKills: 4
                };

                // إرسال حدث مطابقة الخصم وبدء اللعبة
                player1Socket.emit('match_found', {
                    matchId: matchId,
                    role: "Red",
                    spawnX: 2000,
                    spawnY: 2000,
                    spawnHeading: 0,
                    opponentId: player2Id
                });

                player2Socket.emit('match_found', {
                    matchId: matchId,
                    role: "Blue",
                    spawnX: 4000,
                    spawnY: 4000,
                    spawnHeading: 180,
                    opponentId: player1Id
                });

                console.log(`Match created: ${matchId}`);
            }
        }
    });

    // 2. مزامنة حركة اللاعب (الموقع، الاتجاه، السرعة)
    socket.on('update_movement', (data) => {
        const { matchId, x, y, heading, speed } = data;
        if (activeMatches[matchId]) {
            socket.to(matchId).emit('opponent_moved', {
                x: x,
                y: y,
                heading: heading,
                speed: speed
            });
        }
    });

    // 3. مزامنة إطلاق التوربيدو
    socket.on('fire_torpedo', (data) => {
        const { matchId, x, y, heading } = data;
        if (activeMatches[matchId]) {
            socket.to(matchId).emit('opponent_fired', {
                x: x,
                y: y,
                heading: heading
            });
        }
    });

    // 4. تسجيل الضرر والقتل (TDM Logic)
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
            // زيادة نقاط اللاعب الحالي (القاتل)
            match.players[socket.id].score += 1;

            io.to(matchId).emit('player_killed', {
                killedPlayerId: opponentId,
                killerId: socket.id,
                scores: {
                    [socket.id]: match.players[socket.id].score,
                    [opponentId]: match.players[opponentId].score
                }
            });

            // التحقق من الفوز (الوصول لـ 4 قتلات)
            if (match.players[socket.id].score >= match.maxKills) {
                io.to(matchId).emit('game_over', {
                    winnerId: socket.id,
                    loserId: opponentId
                });
                // تنظيف الغرفة بعد انتهاء المباراة
                delete activeMatches[matchId];
            } else {
                // إعادة تعيين الجولة (Round Reset) وإعادة توزيع اللاعبين لمواقع البداية
                setTimeout(() => {
                    match.players[socket.id].hp = 100;
                    match.players[opponentId].hp = 100;

                    const p1Id = Object.keys(match.players)[0];
                    const p2Id = Object.keys(match.players)[1];

                    io.sockets.sockets.get(p1Id)?.emit('round_start', {
                        spawnX: 2000, spawnY: 2000, spawnHeading: 0, hp: 100
                    });
                    io.sockets.sockets.get(p2Id)?.emit('round_start', {
                        spawnX: 4000, spawnY: 4000, spawnHeading: 180, hp: 100
                    });
                }, 3000); // انتظار 3 ثوانٍ قبل بدء الجولة التالية لعرض تأثير الانفجار
            }
        } else {
            // مزامنة شريط الصحة للخصم فقط
            io.to(matchId).emit('hp_sync', {
                playerId: opponentId,
                hp: opponent.hp
            });
        }
    });

    // 5. عند خروج اللاعب أو انقطاع الاتصال
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        
        // إزالة اللاعب من قائمة الانتظار إذا كان بها
        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);

        // البحث عن أي مباراة نشطة كان يشارك فيها اللاعب
        for (const matchId in activeMatches) {
            if (activeMatches[matchId].players[socket.id]) {
                // إعلام اللاعب الآخر بانسحاب الخصم وفوزه تلقائياً
                socket.to(matchId).emit('opponent_disconnected', {
                    message: "Opponent disconnected. You win!"
                });
                delete activeMatches[matchId];
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
