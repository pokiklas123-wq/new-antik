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

// === تخزين البيانات الحقيقية ===
const rooms = new Map(); // roomId -> {broadcaster, viewers, streamData}
const users = new Map(); // socketId -> {roomId, type, userName}
const activeStreams = new Map(); // roomId -> streamStatus

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API للإحصائيات الحقيقية
app.get('/api/stats', (req, res) => {
    const stats = {
        timestamp: new Date().toLocaleString('ar-SA'),
        totalRooms: rooms.size,
        totalUsers: users.size,
        activeBroadcasts: Array.from(rooms.values()).filter(room => room.isLive).length,
        rooms: []
    };

    // تفاصيل كل غرفة
    rooms.forEach((room, roomId) => {
        stats.rooms.push({
            roomId,
            broadcaster: room.broadcasterName || 'غير معروف',
            viewersCount: room.viewers ? room.viewers.size : 0,
            viewersList: room.viewers ? Array.from(room.viewers).slice(0, 10) : [],
            isLive: room.isLive || false,
            createdAt: room.createdAt,
            uptime: room.createdAt ? 
                Math.floor((new Date() - new Date(room.createdAt)) / 1000) + ' ثانية' : 'غير معروف'
        });
    });

    res.json(stats);
});

// صفحة عرض الإحصائيات الحية
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Socket.io Handlers
io.on('connection', (socket) => {
    console.log(`🔗 [${new Date().toLocaleTimeString('ar-SA')}] اتصال جديد: ${socket.id}`);
    
    // 1. إنشاء غرفة جديدة (المعلم)
    socket.on('create-room', async (data) => {
        const { roomId, userName } = data;
        
        console.log(`🎬 محاولة إنشاء غرفة: ${roomId} بواسطة ${userName}`);
        
        // التحقق من وجود الغرفة
        if (rooms.has(roomId)) {
            socket.emit('room-error', { 
                message: '⚠️ اسم الغرفة مستخدم بالفعل، اختر اسم آخر' 
            });
            return;
        }
        
        try {
            // إنشاء الغرفة
            rooms.set(roomId, {
                broadcaster: socket.id,
                broadcasterName: userName,
                viewers: new Set(),
                isLive: true,
                createdAt: new Date().toISOString(),
                lastActivity: new Date()
            });
            
            // تسجيل المستخدم
            users.set(socket.id, {
                roomId,
                userName,
                type: 'broadcaster',
                joinedAt: new Date(),
                socketId: socket.id
            });
            
            socket.join(roomId);
            
            // إرسال تأكيد للمعلم
            socket.emit('room-created', {
                success: true,
                roomId,
                message: '✅ تم إنشاء الغرفة بنجاح',
                viewerLink: `http://${req.headers.host}/viewer.html?room=${roomId}`,
                adminLink: `http://${req.headers.host}/admin`
            });
            
            console.log(`✅ تم إنشاء غرفة ${roomId} بواسطة ${userName}`);
            
            // بث حدث تحديث الإحصائيات لجميع المتصلين
            broadcastStats();
            
        } catch (error) {
            console.error('❌ خطأ في إنشاء الغرفة:', error);
            socket.emit('room-error', { message: 'خطأ في إنشاء الغرفة' });
        }
    });
    
    // 2. انضمام مشاهد
    socket.on('join-room', (data) => {
        const { roomId, userName } = data;
        
        console.log(`👁️ محاولة انضمام ${userName} إلى ${roomId}`);
        
        const room = rooms.get(roomId);
        
        if (!room) {
            socket.emit('room-error', { 
                message: '🚫 الغرفة غير موجودة أو انتهى البث' 
            });
            return;
        }
        
        if (!room.isLive) {
            socket.emit('room-error', { 
                message: '⏸️ البث متوقف حالياً' 
            });
            return;
        }
        
        // التحقق من عدد المشاهدين (20 كحد أقصى)
        if (room.viewers.size >= 20) {
            socket.emit('room-error', { 
                message: '🚫 الغرفة ممتلئة (20/20 مشاهد)' 
            });
            return;
        }
        
        // الانضمام للغرفة
        room.viewers.add(socket.id);
        room.lastActivity = new Date();
        
        users.set(socket.id, {
            roomId,
            userName,
            type: 'viewer',
            joinedAt: new Date(),
            socketId: socket.id
        });
        
        socket.join(roomId);
        
        // إعلام المشاهد
        socket.emit('joined-room', {
            success: true,
            roomId,
            broadcasterName: room.broadcasterName,
            viewersCount: room.viewers.size,
            message: `✅ انضممت إلى بث ${room.broadcasterName}`
        });
        
        // إعلام المعلم بمشاهد جديد
        socket.to(room.broadcaster).emit('viewer-joined', {
            viewerId: socket.id,
            viewerName: userName,
            viewersCount: room.viewers.size,
            timestamp: new Date()
        });
        
        console.log(`✅ ${userName} انضم إلى ${roomId} (المشاهدين: ${room.viewers.size})`);
        
        // تحديث الإحصائيات
        broadcastStats();
    });
    
    // 3. إرسال إشارات WebRTC
    socket.on('webrtc-signal', (data) => {
        const { to, signal, type, roomId } = data;
        
        // التحقق من صلاحية الإشارة
        const sender = users.get(socket.id);
        const receiver = users.get(to);
        
        if (sender && receiver && sender.roomId === receiver.roomId) {
            socket.to(to).emit('webrtc-signal', {
                from: socket.id,
                signal: signal,
                type: type,
                roomId: roomId
            });
        }
    });
    
    // 4. رسائل الدردشة
    socket.on('chat-message', (data) => {
        const user = users.get(socket.id);
        if (user && rooms.has(user.roomId)) {
            const room = rooms.get(user.roomId);
            
            const messageData = {
                from: socket.id,
                userName: user.userName,
                message: data.message,
                type: user.type,
                timestamp: new Date().toLocaleTimeString('ar-SA'),
                roomId: user.roomId
            };
            
            // إرسال الرسالة لجميع أعضاء الغرفة
            io.to(user.roomId).emit('chat-message', messageData);
        }
    });
    
    // 5. إغلاق البث
    socket.on('end-broadcast', (roomId) => {
        const room = rooms.get(roomId);
        
        if (room && room.broadcaster === socket.id) {
            // إعلام جميع المشاهدين
            io.to(roomId).emit('broadcast-ended', {
                message: '📢 انتهى البث من قبل المعلم',
                broadcaster: room.broadcasterName
            });
            
            // حذف الغرفة
            rooms.delete(roomId);
            
            // حذف المستخدمين المرتبطين
            users.forEach((user, userId) => {
                if (user.roomId === roomId) {
                    users.delete(userId);
                }
            });
            
            console.log(`❌ تم إغلاق غرفة ${roomId}`);
            
            // تحديث الإحصائيات
            broadcastStats();
        }
    });
    
    // 6. عند انفصال مستخدم
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        
        if (user) {
            const room = rooms.get(user.roomId);
            
            if (room) {
                if (user.type === 'broadcaster') {
                    // إذا كان المعلم يغادر
                    io.to(user.roomId).emit('broadcast-ended', {
                        message: '📢 انقطع اتصال المعلم',
                        broadcaster: user.userName
                    });
                    
                    // حذف الغرفة
                    rooms.delete(user.roomId);
                    
                    console.log(`❌ المعلم ${user.userName} غادر، تم إغلاق ${user.roomId}`);
                    
                } else {
                    // إذا كان مشاهد يغادر
                    room.viewers.delete(socket.id);
                    
                    // إعلام المعلم
                    socket.to(room.broadcaster).emit('viewer-left', {
                        viewerId: socket.id,
                        viewerName: user.userName,
                        viewersCount: room.viewers.size
                    });
                    
                    console.log(`👋 ${user.userName} غادر ${user.roomId}`);
                }
                
                // تحديث الإحصائيات
                broadcastStats();
            }
            
            // حذف المستخدم
            users.delete(socket.id);
        }
        
        console.log(`❌ انقطع اتصال: ${socket.id}`);
    });
});

// دالة بث الإحصائيات
function broadcastStats() {
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
    ╔══════════════════════════════════════╗
    ║     🚀 خادم البث المباشر الحقيقي     ║
    ║     الإصدار: 3.0 (كامل)             ║
    ║     المنفذ: ${PORT}                 ║
    ║     الوقت: ${new Date().toLocaleString('ar-SA')} ║
    ╚══════════════════════════════════════╝
    
    📊 روابط الوصول:
    👨‍🏫 صفحة المعلم: http://localhost:${PORT}/broadcaster.html
    👁️ صفحة المشاهد: http://localhost:${PORT}/viewer.html
    📈 لوحة التحكم: http://localhost:${PORT}/admin
    
    ✅ جاهز للبث الحقيقي!
    `);
});
