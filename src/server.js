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
    origin: "https://pokiklas123-wq.github.io", // السماح لموقعك فقط بالاتصال
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// ####################################################
//           منطق Mediasoup (الوسيط)
// ####################################################
let worker;
let router;
let producerTransport;
let producer;
let broadcastId = null; // لتخزين معرف البث الحالي

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
  });

  worker.on('died', () => {
    console.error('mediasoup worker has died');
    setTimeout(() => process.exit(1), 2000);
  });

  router = await worker.createWebRtcTransportRouter();
};

createWorker();

// ####################################################
//           إدارة الاتصالات (Socket.io)
// ####################################################
io.on('connection', (socket) => {
  console.log('مستخدم جديد متصل:', socket.id);

  // --- للمعلم (Broadcaster) ---
  socket.on('startBroadcast', async (id, callback) => {
    if (producer) {
      // إذا كان هناك بث قائم بالفعل
      callback({ error: 'بث آخر قائم بالفعل.' });
      return;
    }
    broadcastId = id;
    console.log(`المعلم بدأ البث بالمعرف: ${broadcastId}`);

    producerTransport = await router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    callback({
      id: producerTransport.id,
      iceParameters: producerTransport.iceParameters,
      iceCandidates: producerTransport.iceCandidates,
      dtlsParameters: producerTransport.dtlsParameters,
    });
  });

  socket.on('connectProducerTransport', async (dtlsParameters) => {
    await producerTransport.connect({ dtlsParameters });
  });

  socket.on('produce', async ({ kind, rtpParameters }, callback) => {
    producer = await producerTransport.produce({ kind, rtpParameters });
    callback({ id: producer.id });
    console.log('تم إنشاء المنتج (Producer)، البث مباشر الآن.');
    // إعلام جميع المشاهدين بوجود بث جديد
    io.emit('newBroadcast');
  });

  // --- للمشاهد (Viewer) ---
  socket.on('getRouterRtpCapabilities', (callback) => {
    callback(router.rtpCapabilities);
  });

  socket.on('createConsumerTransport', async (callback) => {
    const consumerTransport = await router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    callback({
      id: consumerTransport.id,
      iceParameters: consumerTransport.iceParameters,
      iceCandidates: consumerTransport.iceCandidates,
      dtlsParameters: consumerTransport.dtlsParameters,
    });
  });

  socket.on('connectConsumerTransport', async ({ transportId, dtlsParameters }) => {
    const transport = router.transports.find(t => t.id === transportId);
    if (transport) {
      await transport.connect({ dtlsParameters });
    }
  });

  socket.on('consume', async ({ transportId, rtpCapabilities }, callback) => {
    if (!producer || !router.canConsume({ producerId: producer.id, rtpCapabilities })) {
      return callback({ error: 'لا يمكن استهلاك البث' });
    }

    const transport = router.transports.find(t => t.id === transportId);
    if (!transport) {
      return callback({ error: 'لم يتم العثور على النقل' });
    }

    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: true,
    });

    callback({
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  });

  socket.on('resume', async (consumerId) => {
    const consumer = router.transports.flatMap(t => Array.from(t.consumers.values())).find(c => c.id === consumerId);
    if (consumer) {
      await consumer.resume();
    }
  });
  
  // --- التحقق من وجود بث ---
  socket.on('checkBroadcast', (id, callback) => {
    if (producer && broadcastId === id) {
      callback({ isBroadcasting: true });
    } else {
      callback({ isBroadcasting: false });
    }
  });

  socket.on('disconnect', () => {
    console.log('مستخدم قطع الاتصال:', socket.id);
    // يمكنك إضافة منطق هنا لإيقاف البث إذا قطع المعلم الاتصال
  });
});

server.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
});
