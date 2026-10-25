const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } // للسماح بالاتصال من أي مكان
});

const BOT_COUNT = 2000;
const bots = [];

// توليد البوتات عند بدء السيرفر
for (let i = 0; i < BOT_COUNT; i++) {
    bots.push({
        id: i,
        x: (Math.random() - 0.5) * 2000, // توزيع على مساحة 2000 متر
        z: (Math.random() - 0.5) * 2000,
        yaw: Math.random() * 360,
        speed: 2.0,
        timer: Math.random() * 3
    });
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // إرسال البيانات الأولية للبوتات فور الاتصال
    socket.emit('initBots', bots);

    // الاستماع لموقع اللاعب لتحديث البوتات القريبة فقط (اختياري ولكن للأداء الأفضل)
    // لكننا هنا سنبقيها بسيطة كما طلبت: إرسال كل البوتات.
    
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
    });
});

// تحديث حركة البوتات وإرسالها كل 100 مللي ثانية
setInterval(() => {
    for (let i = 0; i < BOT_COUNT; i++) {
        const bot = bots[i];
        bot.timer -= 0.1; // تقليل المؤقت
        if (bot.timer <= 0) {
            bot.yaw = Math.random() * 360;
            bot.timer = 2 + Math.random() * 3;
        }
        // تحريك البوت
        const rads = bot.yaw * (Math.PI / 180);
        bot.x += Math.sin(rads) * bot.speed * 0.1;
        bot.z += Math.cos(rads) * bot.speed * 0.1;
    }
    
    // بث البيانات المحدثة لجميع اللاعبين المتصلين
    io.emit('botUpdates', bots);
}, 100);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
