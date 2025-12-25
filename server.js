const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);

// إعداد CORS للسماح بالاتصال من GitHub Pages
const io = new Server(server, {
  cors: {
    origin: "https://pokiklas123-wq.github.io",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;

// ####################################################
//           متغيرات النظام
// ####################################################
let worker;
let router;
const rooms = new Map(); // تخزين جميع الغرف
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000
  }
];

// ####################################################
//           تهيئة Mediasoup Worker
// ####################################################
const createWorker = async () => {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });

  worker.on('died', () => {
    console.error('❌ Mediasoup Worker توقف!');
    setTimeout(() => process.exit(1), 2000);
  });

  console.log('✅ Mediasoup Worker جاهز');
};

createWorker();

// ####################################################
//           دوال مساعدة للغرف
// ####################################################
const createRoom = async (roomId) => {
  // إنشاء Router جديد لهذه الغرفة
  const roomRouter = await worker.createRouter({ mediaCodecs });
  
  const room = {
    id: roomId,
    router: roomRouter,
    broadcaster: null, // Socket.id للمعلم
    producer: null,    // Producer الخاص بالمعلم
    consumers: new Map(), // جميع المشاهدين
    transports: new Map() // جميع الـ Transports
  };
  
  rooms.set(roomId, room);
  console.log(`✅ غرفة جديدة تم إنشاؤها: ${roomId}`);
  return room;
};

const getOrCreateRoom = async (roomId) => {
  let room = rooms.get(roomId);
  if (!room) {
    room = await createRoom(roomId);
  }
  return room;
};

// ####################################################
//           إدارة اتصالات Socket.io
// ####################################################
io.on('connection', (socket) => {
  console.log(`👤 مستخدم متصل: ${socket.id}`);

  // --- حدث لإنشاء Producer Transport (للمعلم) ---
  socket.on('createProducerTransport', async ({ roomId }, callback) => {
    try {
      console.log(`🚀 طلب إنشاء Producer Transport للغرفة: ${roomId}`);
      
      const room = await getOrCreateRoom(roomId);
      
      // تحقق إذا كان هناك معلم بالفعل في الغرفة
      if (room.broadcaster && room.broadcaster !== socket.id) {
        return callback({ error: 'هناك معلم آخر يبث في هذه الغرفة بالفعل' });
      }
      
      room.broadcaster = socket.id;
      
      // إنشاء WebRtcTransport للمعلم
      const transport = await room.router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });
      
      // حفظ الـ Transport في الغرفة
      room.transports.set(transport.id, transport);
      
      // إرسال بيانات الـ Transport للمعلم
      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
      
    } catch (error) {
      console.error('❌ خطأ في createProducerTransport:', error);
      callback({ error: error.message });
    }
  });

  // --- حدث لربط Producer Transport ---
  socket.on('connectProducerTransport', async ({ transportId, dtlsParameters }, callback) => {
    try {
      // البحث عن الغرفة التي تحتوي على هذا الـ Transport
      for (const [roomId, room] of rooms) {
        const transport = room.transports.get(transportId);
        if (transport) {
          await transport.connect({ dtlsParameters });
          console.log(`✅ Producer Transport متصل: ${transportId}`);
          callback({ success: true });
          return;
        }
      }
      callback({ error: 'Transport غير موجود' });
    } catch (error) {
      console.error('❌ خطأ في connectProducerTransport:', error);
      callback({ error: error.message });
    }
  });

  // --- حدث لإنتاج الفيديو (Producer) ---
  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    try {
      // البحث عن الغرفة والـ Transport
      for (const [roomId, room] of rooms) {
        const transport = room.transports.get(transportId);
        if (transport && room.broadcaster === socket.id) {
          // إنشاء Producer
          const producer = await transport.produce({ kind, rtpParameters });
          room.producer = producer;
          
          console.log(`🎥 تم إنشاء Producer: ${producer.id} للغرفة: ${roomId}`);
          
          // إعلام جميع المشاهدين بوجود بث جديد
          io.emit('newBroadcast', { roomId });
          
          callback({ id: producer.id });
          return;
        }
      }
      callback({ error: 'لم يتم العثور على Transport أو ليس لديك صلاحية' });
    } catch (error) {
      console.error('❌ خطأ في produce:', error);
      callback({ error: error.message });
    }
  });

  // --- حدث للحصول على قدرات الـ Router (للمشاهدين) ---
  socket.on('getRouterRtpCapabilities', async ({ roomId }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) {
        return callback({ error: 'الغرفة غير موجودة' });
      }
      
      callback(room.router.rtpCapabilities);
    } catch (error) {
      console.error('❌ خطأ في getRouterRtpCapabilities:', error);
      callback({ error: error.message });
    }
  });

  // --- حدث لإنشاء Consumer Transport (للمشاهدين) ---
  socket.on('createConsumerTransport', async ({ roomId }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room || !room.producer) {
        return callback({ error: 'لا يوجد بث نشط في هذه الغرفة' });
      }
      
      // إنشاء WebRtcTransport للمشاهد
      const transport = await room.router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });
      
      // حفظ الـ Transport في الغرفة
      room.transports.set(transport.id, transport);
      
      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
      
    } catch (error) {
      console.error('❌ خطأ في createConsumerTransport:', error);
      callback({ error: error.message });
    }
  });

  // --- حدث لربط Consumer Transport ---
  socket.on('connectConsumerTransport', async ({ transportId, dtlsParameters }, callback) => {
    try {
      for (const [roomId, room] of rooms) {
        const transport = room.transports.get(transportId);
        if (transport) {
          await transport.connect({ dtlsParameters });
          console.log(`✅ Consumer Transport متصل: ${transportId}`);
          callback({ success: true });
          return;
        }
      }
      callback({ error: 'Transport غير موجود' });
    } catch (error) {
      console.error('❌ خطأ في connectConsumerTransport:', error);
      callback({ error: error.message });
    }
  });

  // --- حدث لاستهلاك الفيديو (Consumer) ---
  socket.on('consume', async ({ transportId, rtpCapabilities }, callback) => {
    try {
      for (const [roomId, room] of rooms) {
        const transport = room.transports.get(transportId);
        if (transport && room.producer) {
          // التحقق من إمكانية الاستهلاك
          if (!room.router.canConsume({ 
            producerId: room.producer.id, 
            rtpCapabilities 
          })) {
            return callback({ error: 'لا يمكن استهلاك هذا البث' });
          }
          
          // إنشاء Consumer
          const consumer = await transport.consume({
            producerId: room.producer.id,
            rtpCapabilities,
            paused: true,
          });
          
          // حفظ Consumer
          room.consumers.set(consumer.id, consumer);
          
          callback({
            id: consumer.id,
            producerId: consumer.producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          });
          
          // استئناف التشغيل
          await consumer.resume();
          console.log(`👁️ تم إنشاء Consumer جديد: ${consumer.id}`);
          return;
        }
      }
      callback({ error: 'لم يتم العثور على Transport أو Producer' });
    } catch (error) {
      console.error('❌ خطأ في consume:', error);
      callback({ error: error.message });
    }
  });

  // --- حدث للتحقق من وجود بث ---
  socket.on('checkBroadcast', ({ roomId }, callback) => {
    const room = rooms.get(roomId);
    callback({ 
      isBroadcasting: !!(room && room.producer),
      roomExists: !!room
    });
  });

  // --- حدث قطع الاتصال ---
  socket.on('disconnect', () => {
    console.log(`❌ مستخدم قطع الاتصال: ${socket.id}`);
    
    // تنظيف الغرف عند قطع اتصال المعلم
    for (const [roomId, room] of rooms) {
      if (room.broadcaster === socket.id) {
        console.log(`🗑️ تنظيف الغرفة: ${roomId} بعد قطع اتصال المعلم`);
        rooms.delete(roomId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
  console.log(`🌐 عنوان الخادم: https://new-antik-p2p-20.onrender.com`);
});
