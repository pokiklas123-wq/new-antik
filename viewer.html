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

// ===== تخزين البيانات الحقيقية =====
const rooms = new Map();
const users = new Map();

// Middleware
app.use(express.static(__dirname));
app.use(express.json());

// صفحة الرئيسية
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>🚀 نظام البث المباشر</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                text-align: center;
                padding: 50px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
            }
            .container {
                max-width: 800px;
                margin: 0 auto;
                background: rgba(255,255,255,0.95);
                padding: 40px;
                border-radius: 20px;
                color: #333;
            }
            h1 { color: #4361ee; }
            .btn {
                display: inline-block;
                margin: 10px;
                padding: 15px 30px;
                background: #4361ee;
                color: white;
                text-decoration: none;
                border-radius: 10px;
                font-size: 18px;
            }
            .stats {
                margin: 30px 0;
                padding: 20px;
                background: #f8f9fa;
                border-radius: 10px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 نظام البث المباشر الحقيقي</h1>
            <p>يعمل على: <strong>https://new-antik-p2p-20.onrender.com</strong></p>
            
            <div class="stats">
                <h3>📊 الإحصائيات الحية:</h3>
                <p>الغرف النشطة: <span id="roomCount">0</span></p>
                <p>المستخدمين المتصلين: <span id="userCount">0</span></p>
                <p>البث المباشر: <span id="broadcastCount">0</span></p>
            </div>
            
            <div style="margin: 40px 0;">
                <a href="/broadcaster.html" class="btn">👨‍🏫 ابدأ البث (معلم)</a>
                <a href="/viewer.html" class="btn">👁️ مشاهدة البث</a>
                <a href="/admin" class="btn">📊 لوحة التحكم</a>
            </div>
            
            <div style="margin-top: 30px; padding: 20px; background: #e9f7ef; border-radius: 10px;">
                <h3>🔗 روابط مهمة:</h3>
                <p>رابط المعلم: <code>https://new-antik-p2p-20.onrender.com/broadcaster.html</code></p>
                <p>رابط المشاهد: <code>https://new-antik-p2p-20.onrender.com/viewer.html</code></p>
            </div>
        </div>
        
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            socket.on('stats-update', (stats) => {
                document.getElementById('roomCount').textContent = stats.totalRooms;
                document.getElementById('userCount').textContent = stats.totalUsers;
                document.getElementById('broadcastCount').textContent = stats.activeBroadcasts;
            });
        </script>
    </body>
    </html>
    `);
});

// API للإحصائيات الحقيقية
app.get('/api/stats', (req, res) => {
    const stats = {
        success: true,
        timestamp: new Date().toLocaleString('ar-SA'),
        server: 'https://new-antik-p2p-20.onrender.com',
        totalRooms: rooms.size,
        totalUsers: users.size,
        activeBroadcasts: Array.from(rooms.values()).filter(room => room.isLive).length,
        rooms: []
    };

    rooms.forEach((room, roomId) => {
        stats.rooms.push({
            roomId,
            broadcaster: room.broadcasterName,
            viewersCount: room.viewers ? room.viewers.size : 0,
            isLive: room.isLive,
            createdAt: room.createdAt,
            uptime: room.createdAt ? Math.floor((new Date() - new Date(room.createdAt)) / 1000) + ' ثانية' : '0'
        });
    });

    res.json(stats);
});

// صفحة التحكم
app.get('/admin', (req, res) => {
    res.sendFile(__dirname + '/admin.html');
});

// ===== Socket.io Events =====
io.on('connection', (socket) => {
    console.log(`✅ [${new Date().toLocaleTimeString('ar-SA')}] اتصال جديد: ${socket.id}`);
    
    // إرسال الإحصائيات عند الاتصال
    sendStatsUpdate();
    
    // إنشاء غرفة
    socket.on('create-room', (data) => {
        const { roomId, userName } = data;
        
        if (rooms.has(roomId)) {
            socket.emit('error', { message: '⚠️ الغرفة موجودة بالفعل' });
            return;
        }
        
        // إنشاء الغرفة
        rooms.set(roomId, {
            broadcaster: socket.id,
            broadcasterName: userName || 'المعلم',
            viewers: new Set(),
            isLive: true,
            createdAt: new Date().toISOString()
        });
        
        users.set(socket.id, {
            roomId,
            userName: userName || 'المعلم',
            type: 'broadcaster',
            joinedAt: new Date()
        });
        
        socket.join(roomId);
        
        socket.emit('room-created', {
            success: true,
            roomId,
            viewerLink: `https://new-antik-p2p-20.onrender.com/viewer.html?room=${roomId}`,
            adminLink: `https://new-antik-p2p-20.onrender.com/admin`
        });
        
        console.log(`🎥 إنشاء غرفة: ${roomId} بواسطة ${socket.id}`);
        sendStatsUpdate();
    });
    
    // انضمام مشاهد
    socket.on('join-room', (data) => {
        const { roomId, userName } = data;
        const room = rooms.get(roomId);
        
        if (!room) {
            socket.emit('error', { message: '🚫 الغرفة غير موجودة' });
            return;
        }
        
        if (!room.isLive) {
            socket.emit('error', { message: '⏸️ البث متوقف' });
            return;
        }
        
        // التحقق من عدد المشاهدين (20 كحد أقصى)
        if (room.viewers.size >= 20) {
            socket.emit('error', { message: '🚫 الغرفة ممتلئة (20/20)' });
            return;
        }
        
        // الانضمام
        room.viewers.add(socket.id);
        users.set(socket.id, {
            roomId,
            userName: userName || 'مشاهد',
            type: 'viewer',
            joinedAt: new Date()
        });
        
        socket.join(roomId);
        
        // إعلام المشاهد
        socket.emit('joined-room', {
            success: true,
            roomId,
            broadcasterName: room.broadcasterName,
            viewersCount: room.viewers.size
        });
        
        // إعلام المعلم
        socket.to(room.broadcaster).emit('viewer-joined', {
            viewerId: socket.id,
            viewerName: userName || 'مشاهد',
            viewersCount: room.viewers.size
        });
        
        console.log(`👁️ ${userName || 'مشاهد'} انضم إلى ${roomId}`);
        sendStatsUpdate();
    });
    
    // إشارات WebRTC
    socket.on('webrtc-signal', (data) => {
        const { to, signal, type } = data;
        socket.to(to).emit('webrtc-signal', {
            from: socket.id,
            signal,
            type
        });
    });
    
    // رسائل الدردشة
    socket.on('chat-message', (data) => {
        const user = users.get(socket.id);
        if (user) {
            const room = rooms.get(user.roomId);
            if (room) {
                io.to(user.roomId).emit('chat-message', {
                    from: socket.id,
                    userName: user.userName,
                    message: data.message,
                    type: user.type,
                    time: new Date().toLocaleTimeString('ar-SA')
                });
            }
        }
    });
    
    // إغلاق البث
    socket.on('end-broadcast', (roomId) => {
        const room = rooms.get(roomId);
        if (room && room.broadcaster === socket.id) {
            // إرسال إشعار للجميع
            io.to(roomId).emit('broadcast-ended');
            
            // حذف المستخدمين
            room.viewers.forEach(viewerId => {
                users.delete(viewerId);
            });
            users.delete(socket.id);
            
            // حذف الغرفة
            rooms.delete(roomId);
            
            console.log(`❌ تم إغلاق غرفة ${roomId}`);
            sendStatsUpdate();
        }
    });
    
    // انقطاع الاتصال
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            const room = rooms.get(user.roomId);
            if (room) {
                if (user.type === 'broadcaster') {
                    // إغلاق الغرفة إذا غادر المعلم
                    io.to(user.roomId).emit('broadcast-ended');
                    rooms.delete(user.roomId);
                    console.log(`❌ المعلم غادر، تم إغلاق ${user.roomId}`);
                } else {
                    // إزالة المشاهد
                    room.viewers.delete(socket.id);
                    // إعلام المعلم
                    socket.to(room.broadcaster).emit('viewer-left', {
                        viewerId: socket.id,
                        viewersCount: room.viewers.size
                    });
                }
                sendStatsUpdate();
            }
            users.delete(socket.id);
        }
        console.log(`❌ انقطع: ${socket.id}`);
    });
});

// دالة إرسال تحديث الإحصائيات
function sendStatsUpdate() {
    const stats = {
        totalRooms: rooms.size,
        totalUsers: users.size,
        activeBroadcasts: Array.from(rooms.values()).filter(r => r.isLive).length,
        timestamp: new Date().toLocaleString('ar-SA')
    };
    io.emit('stats-update', stats);
}

// تشغيل الخادم
server.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════════════════╗
    ║     🚀 خادم البث المباشر يعمل على Render.com     ║
    ║     رابط الخادم: https://new-antik-p2p-20.onrender.com ║
    ║     المنفذ: ${PORT}                              ║
    ║     الوقت: ${new Date().toLocaleString('ar-SA')} ║
    ╚═══════════════════════════════════════════════════╝
    
    📍 روابط الوصول:
    👨‍🏫 صفحة المعلم: https://new-antik-p2p-20.onrender.com/broadcaster.html
    👁️ صفحة المشاهد: https://new-antik-p2p-20.onrender.com/viewer.html
    📊 لوحة التحكم: https://new-antik-p2p-20.onrender.com/admin
    
    ✅ الخادم جاهز للبث الحقيقي!
    `);
});
