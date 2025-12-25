const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const app = express();
const server = http.createServer(app);

// أحدث إصدار من Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    credentials: true
  },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// تخزين الغرف والمستخدمين
const rooms = new Map();
const users = new Map();

// مسارات API
app.get('/api/rooms/:id/status', (req, res) => {
  const room = rooms.get(req.params.id);
  res.json({ 
    exists: !!room,
    participants: room ? room.participants.size : 0
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'active', 
    rooms: rooms.size,
    users: users.size 
  });
});

// Socket.io Events
io.on('connection', (socket) => {
  console.log('🔗 مستخدم جديد:', socket.id);
  
  socket.on('join-room', async (data) => {
    const { roomId, userType, userName = 'مستخدم' } = data;
    
    // إنشاء غرفة جديدة إذا لم تكن موجودة
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        broadcaster: null,
        participants: new Map(),
        createdAt: new Date()
      });
    }
    
    const room = rooms.get(roomId);
    
    if (userType === 'broadcaster') {
      // المعلم/الباث
      room.broadcaster = socket.id;
      socket.join(roomId);
      
      socket.emit('room-created', { 
        roomId, 
        success: true,
        message: '✅ تم إنشاء الغرفة بنجاح'
      });
      
      console.log(`🎥 باث جديد في غرفة ${roomId}: ${socket.id}`);
      
    } else {
      // المشاهد
      if (!room.broadcaster) {
        socket.emit('error', { message: '⚠️ لا يوجد بث نشط في هذه الغرفة' });
        return;
      }
      
      // التحقق من عدد المشاهدين (20 كحد أقصى)
      if (room.participants.size >= 20) {
        socket.emit('error', { message: '🚫 الغرفة ممتلئة (20/20)' });
        return;
      }
      
      socket.join(roomId);
      room.participants.set(socket.id, { userName, joinedAt: new Date() });
      
      // إعلام الجميع بمشاهد جديد
      io.to(roomId).emit('user-joined', {
        userId: socket.id,
        userName,
        totalViewers: room.participants.size
      });
      
      console.log(`👁️ مشاهد جديد في ${roomId}: ${userName}`);
    }
    
    // تخزين بيانات المستخدم
    users.set(socket.id, { roomId, userType, userName });
  });
  
  // نقل إشارات WebRTC
  socket.on('signal', (data) => {
    const { to, signal, type } = data;
    socket.to(to).emit('signal', {
      from: socket.id,
      signal,
      type
    });
  });
  
  // رسائل الدردشة
  socket.on('send-message', (data) => {
    const user = users.get(socket.id);
    if (user) {
      socket.to(user.roomId).emit('new-message', {
        from: socket.id,
        userName: user.userName,
        message: data.message,
        timestamp: new Date()
      });
    }
  });
  
  // إغلاق البث
  socket.on('end-broadcast', (roomId) => {
    const room = rooms.get(roomId);
    if (room && room.broadcaster === socket.id) {
      io.to(roomId).emit('broadcast-ended');
      rooms.delete(roomId);
      console.log(`❌ البث انتهى في غرفة ${roomId}`);
    }
  });
  
  // عند انفصال مستخدم
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const room = rooms.get(user.roomId);
      
      if (room) {
        if (user.userType === 'broadcaster') {
          // إذا كان باث يغادر، ننهي البث للجميع
          io.to(user.roomId).emit('broadcast-ended');
          rooms.delete(user.roomId);
          console.log(`❌ الباث غادر، تم إغلاق غرفة ${user.roomId}`);
        } else {
          // إذا كان مشاهد
          room.participants.delete(socket.id);
          io.to(user.roomId).emit('user-left', {
            userId: socket.id,
            totalViewers: room.participants.size
          });
        }
      }
      
      users.delete(socket.id);
    }
    
    console.log('❌ انقطع:', socket.id);
  });
});

// صفحة الاختبار
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>خادم البث المباشر</title></head>
    <body style="text-align:center;padding:50px;font-family:Arial">
      <h1>🚀 خادم البث المباشر يعمل!</h1>
      <p>الإصدار: 2.0.0 | التاريخ: ${new Date().toLocaleString('ar-SA')}</p>
      <div style="margin-top:30px">
        <a href="/api/health" style="margin:10px;padding:10px;background:#4CAF50;color:white;text-decoration:none">الحالة</a>
        <a href="/test" style="margin:10px;padding:10px;background:#2196F3;color:white;text-decoration:none">صفحة الاختبار</a>
      </div>
    </body>
    </html>
  `);
});

// صفحة اختبار WebSocket
app.get('/test', (req, res) => {
  res.sendFile(__dirname + '/test.html');
});

server.listen(PORT, () => {
  console.log(`
  ===========================================
  🚀 خادم البث المباشر يعمل!
  📍 المنفذ: ${PORT}
  ⏰ الوقت: ${new Date().toLocaleString('ar-SA')}
  📊 الإصدار: 2.0.0
  ===========================================
  `);
});
