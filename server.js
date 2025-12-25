// ####################################################
//           إعدادات الخادم الأساسية
// ####################################################
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);

// إعداد CORS للسماح بالاتصال من GitHub Pages
const io = new Server(server, {
  cors: {
    origin: "*", // للسماح بالتجربة، يفضل تغييره لرابط موقعك لاحقاً
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// ####################################################
//           منطق Mediasoup
// ####################################################
let worker;
let router;
let producer; // سنحتفظ بمنتج واحد للبث المباشر
let producerTransport;

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
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000
    }
  }
];

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
  });

  worker.on('died', () => {
    console.error('mediasoup worker has died');
    setTimeout(() => process.exit(1), 2000);
  });

  router = await worker.createRouter({ mediaCodecs });
  console.log('Mediasoup Router created');
};

createWorker();

// ####################################################
//           إدارة الاتصالات (Socket.io)
// ####################################################
io.on('connection', (socket) => {
  console.log('مستخدم جديد متصل:', socket.id);

  socket.on('getRouterRtpCapabilities', (callback) => {
    callback(router.rtpCapabilities);
  });

  // --- للمعلم (Broadcaster) ---
  socket.on('createProducerTransport', async (callback) => {
    try {
      producerTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: null }], // Render سيحتاج announcedIp أحياناً، لكن جرب هذا أولاً
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      producerTransport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
          producerTransport.close();
        }
      });

      callback({
        id: producerTransport.id,
        iceParameters: producerTransport.iceParameters,
        iceCandidates: producerTransport.iceCandidates,
        dtlsParameters: producerTransport.dtlsParameters,
      });
    } catch (error) {
      console.error(error);
      callback({ error: error.message });
    }
  });

  socket.on('connectProducerTransport', async ({ dtlsParameters }, callback) => {
    await producerTransport.connect({ dtlsParameters });
    callback();
  });

  socket.on('produce', async ({ kind, rtpParameters }, callback) => {
    producer = await producerTransport.produce({ kind, rtpParameters });
    
    console.log(`New producer created: ${producer.id}`);
    
    // إعلام جميع المشاهدين بوجود بث جديد
    socket.broadcast.emit('new-producer', producer.id);

    producer.on('transportclose', () => {
      producer.close();
    });

    callback({ id: producer.id });
  });

  // --- للمشاهد (Viewer) ---
  socket.on('createConsumerTransport', async (callback) => {
    try {
      const consumerTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      // حفظ النقل في مصفوفة النقل الخاصة بالراوتر تلقائياً

      callback({
        id: consumerTransport.id,
        iceParameters: consumerTransport.iceParameters,
        iceCandidates: consumerTransport.iceCandidates,
        dtlsParameters: consumerTransport.dtlsParameters,
      });
    } catch (error) {
      console.error(error);
      callback({ error: error.message });
    }
  });

  socket.on('connectConsumerTransport', async ({ transportId, dtlsParameters }, callback) => {
    // البحث عن النقل الصحيح
    // ملاحظة: في التطبيقات الكبيرة يجب تخزين النقل في Map مرتبط بـ socket.id
    // هنا سنبحث عنه في قائمة transport الخاصة بالراوتر
    const transport = Array.from(router.transports.values()).find(t => t.id === transportId);
    if (transport) {
      await transport.connect({ dtlsParameters });
      callback();
    }
  });

  socket.on('consume', async ({ transportId, rtpCapabilities }, callback) => {
    try {
      if (!producer) {
        return callback({ error: 'لا يوجد بث حالياً' });
      }

      if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
        return callback({ error: 'لا يمكن استهلاك هذا البث' });
      }

      const transport = Array.from(router.transports.values()).find(t => t.id === transportId);
      
      if (!transport) {
        return callback({ error: 'Transport not found' });
      }

      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: true, // نبدأ متوقفاً ثم نشغله
      });

      callback({
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (error) {
      console.error('Consume error:', error);
      callback({ error: error.message });
    }
  });

  socket.on('resume', async ({ consumerId }, callback) => {
    // البحث عن المستهلك في جميع وسائل النقل
    for (const transport of router.transports.values()) {
        const consumer = transport.consumers.get(consumerId);
        if (consumer) {
            await consumer.resume();
            callback();
            return;
        }
    }
  });
});

server.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
});
