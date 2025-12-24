const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // للسماح بالاتصال من أي مكان أثناء الاختبار
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

let worker;
let router;
let producerTransport;
let producer;

const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } }
];

const createWorker = async () => {
  worker = await mediasoup.createWorker({ logLevel: 'warn' });
  worker.on('died', () => {
    console.error('mediasoup worker has died');
    setTimeout(() => process.exit(1), 2000);
  });
  router = await worker.createRouter({ mediaCodecs });
};

createWorker();

io.on('connection', (socket) => {
  socket.on('getRouterRtpCapabilities', (callback) => {
    callback(router.rtpCapabilities);
  });

  socket.on('createProducerTransport', async (callback) => {
    try {
      producerTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
        enableUdp: true, enableTcp: true, preferUdp: true,
      });
      callback({
        id: producerTransport.id,
        iceParameters: producerTransport.iceParameters,
        iceCandidates: producerTransport.iceCandidates,
        dtlsParameters: producerTransport.dtlsParameters,
      });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  socket.on('connectProducerTransport', async ({ dtlsParameters }, callback) => {
    await producerTransport.connect({ dtlsParameters });
    callback();
  });

  socket.on('produce', async ({ kind, rtpParameters }, callback) => {
    producer = await producerTransport.produce({ kind, rtpParameters });
    callback({ id: producer.id });
    socket.broadcast.emit('new-producer');
  });

  socket.on('createConsumerTransport', async (callback) => {
    try {
      const consumerTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
      });
      callback({
        id: consumerTransport.id,
        iceParameters: consumerTransport.iceParameters,
        iceCandidates: consumerTransport.iceCandidates,
        dtlsParameters: consumerTransport.dtlsParameters,
      });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  socket.on('connectConsumerTransport', async ({ transportId, dtlsParameters }, callback) => {
    const consumerTransport = router.transports.find(t => t.id === transportId);
    await consumerTransport.connect({ dtlsParameters });
    callback();
  });

  socket.on('consume', async ({ transportId, rtpCapabilities }, callback) => {
    try {
      if (router.canConsume({ producerId: producer.id, rtpCapabilities })) {
        const consumerTransport = router.transports.find(t => t.id === transportId);
        const consumer = await consumerTransport.consume({
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
      }
    } catch (error) {
      callback({ error: error.message });
    }
  });

  socket.on('resume', async (consumerId, callback) => {
    for (const transport of router.transports) {
      const consumer = Array.from(transport.consumers.values()).find(c => c.id === consumerId);
      if (consumer) {
        await consumer.resume();
        break;
      }
    }
    callback();
  });
});

server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
