const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);

// إعدادات CORS للسماح بالاتصال من أي مكان
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// متغيرات Mediasoup
let worker;
let router;
let producer; // سنحتفظ بمنتج واحد للبث المباشر (للبساطة)
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

// تشغيل Worker الخاص بـ Mediasoup
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

// إدارة الاتصالات
io.on('connection', (socket) => {
  console.log('مستخدم جديد متصل:', socket.id);

  socket.on('getRouterRtpCapabilities', (callback) => {
    callback(router.rtpCapabilities);
  });

  // --- الجزء الخاص بالمذيع (Broadcaster) ---
  
  // 1. إنشاء وسيلة نقل للإرسال
  socket.on('createProducerTransport', async (callback) => {
    try {
      producerTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: null }], // Render قد يحتاج announcedIp لاحقاً إذا فشل الاتصال الخارجي
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

  // 2. ربط وسيلة النقل
  socket.on('connectProducerTransport', async ({ dtlsParameters }, callback) => {
    await producerTransport.connect({ dtlsParameters });
    callback();
  });

  // 3. بدء إنتاج الفيديو/الصوت
  socket.on('produce', async ({ kind, rtpParameters }, callback) => {
    producer = await producerTransport.produce({ kind, rtpParameters });
    
    console.log(`New producer created: ${producer.id}`);
    
    // إبلاغ جميع المشاهدين بوجود بث جديد
    socket.broadcast.emit('new-producer', producer.id);

    producer.on('transportclose', () => {
      producer.close();
    });

    callback({ id: producer.id });
  });

  // --- الجزء الخاص بالمشاهد (Viewer) ---

  // 1. إنشاء وسيلة نقل للاستقبال
  socket.on('createConsumerTransport', async (callback) => {
    try {
      const consumerTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      // حفظ الـ Transport في الذاكرة تلقائياً بواسطة Mediasoup Router
      
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

  // 2. ربط وسيلة النقل للمشاهد
  socket.on('connectConsumerTransport', async ({ transportId, dtlsParameters }, callback) => {
    // نبحث عن الـ Transport الصحيح باستخدام ID
    const transport = Array.from(router.transports.values()).find(t => t.id === transportId);
    if (transport) {
      await transport.connect({ dtlsParameters });
      callback();
    } else {
        callback({ error: "Transport not found" });
    }
  });

  // 3. استهلاك البث
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
        paused: true, // نبدأ متوقفاً ثم نشغله بحدث resume
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

  // 4. تشغيل الفيديو للمشاهد
  socket.on('resume', async ({ consumerId }, callback) => {
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
