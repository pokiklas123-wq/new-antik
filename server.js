const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// تخزين بيانات الغرف والمستخدمين
const rooms = new Map();
const users = new Map();

app.use(express.static(__dirname));
app.use(express.json());

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.send('<h1>🚀 خادم البث يعمل بنجاح</h1>');
});

io.on('connection', (socket) => {
    console.log(`➕ اتصال جديد: ${socket.id}`);

    // إنشاء غرفة (للمعلم)
    socket.on('create-room', ({ roomId, userName }) => {
        if (rooms.has(roomId)) {
            socket.emit('error', { message: '⚠️ الغرفة موجودة مسبقاً' });
            return;
        }

        rooms.set(roomId, {
            broadcaster: socket.id,
            broadcasterName: userName,
            viewers: new Set()
        });

        users.set(socket.id, { roomId, type: 'broadcaster' });
        socket.join(roomId);
        
        console.log(`🎥 تم إنشاء الغرفة ${roomId} بواسطة ${userName}`);
        socket.emit('room-created', { success: true, roomId });
    });

    // انضمام مشاهد
    socket.on('join-room', ({ roomId, userName }) => {
        const room = rooms.get(roomId);

        if (!room) {
            socket.emit('error', { message: '🚫 الغرفة غير موجودة أو البث لم يبدأ' });
            return;
        }

        if (room.viewers.size >= 20) {
            socket.emit('error', { message: '⚠️ الغرفة ممتلئة (الحد الأقصى 20)' });
            return;
        }

        room.viewers.add(socket.id);
        users.set(socket.id, { roomId, type: 'viewer' });
        socket.join(roomId);

        // إشعار المشاهد بنجاح الانضمام
        socket.emit('joined-room', { 
            success: true, 
            roomId, 
            broadcasterName: room.broadcasterName 
        });

        // إشعار المعلم بوجود مشاهد جديد ليبدأ الاتصال معه
        io.to(room.broadcaster).emit('viewer-joined', { 
            viewerId: socket.id, 
            viewerName: userName 
        });

        console.log(`👁️ انضم ${userName} للغرفة ${roomId}`);
    });

    // تمرير إشارات WebRTC (Offer, Answer, Candidate)
    socket.on('webrtc-signal', (data) => {
        // إرسال الإشارة للطرف الآخر مباشرة
        io.to(data.to).emit('webrtc-signal', {
            from: socket.id,
            type: data.type,
            signal: data.signal
        });
    });

    // عند قطع الاتصال
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            const room = rooms.get(user.roomId);
            if (room) {
                if (user.type === 'broadcaster') {
                    // إذا خرج المعلم، نغلق الغرفة ونطرد الجميع
                    io.to(user.roomId).emit('broadcast-ended');
                    rooms.delete(user.roomId);
                } else {
                    // إذا خرج مشاهد
                    room.viewers.delete(socket.id);
                    io.to(room.broadcaster).emit('viewer-left', { viewerId: socket.id });
                }
            }
            users.delete(socket.id);
        }
        console.log(`➖ انقطع الاتصال: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
