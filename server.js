const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const BOT_COUNT = 100;
const bots = [];

for (let i = 0; i < BOT_COUNT; i++) {
    bots.push({
        id: i, // 🟢 الـ ID مهم جداً
        x: (Math.random() - 0.5) * 2000,
        z: (Math.random() - 0.5) * 2000,
        y: 0, 
        yaw: Math.random() * 360,
        speed: 2.0,
        timer: Math.random() * 3
    });
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    socket.playerX = 0;
    socket.playerZ = 0;

    socket.emit('initBots', bots);

    socket.on('updatePosition', (data) => {
        socket.playerX = data.x;
        socket.playerZ = data.z;
    });

    socket.on('disconnect', () => {});
});

setInterval(() => {
    for (let i = 0; i < BOT_COUNT; i++) {
        const bot = bots[i];
        bot.timer -= 0.1;
        if (bot.timer <= 0) {
            bot.yaw = Math.random() * 360;
            bot.timer = 2 + Math.random() * 3;
        }
        const rads = bot.yaw * (Math.PI / 180);
        bot.x += Math.sin(rads) * bot.speed * 0.1;
        bot.z += Math.cos(rads) * bot.speed * 0.1;
    }
    
    io.sockets.sockets.forEach((socket) => {
        const nearbyBots = bots.filter(bot => {
            const dx = bot.x - socket.playerX;
            const dz = bot.z - socket.playerZ;
            return (dx * dx + dz * dz) < (300 * 300); // 300 متر
        });
        socket.emit('botUpdates', nearbyBots);
    });
}, 100);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
