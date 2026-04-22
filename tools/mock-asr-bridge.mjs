import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const HOST = process.env.LISTEN_GRAPHIC_MOCK_BRIDGE_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.LISTEN_GRAPHIC_MOCK_BRIDGE_PORT || '15377', 10);
const PATHNAME = process.env.LISTEN_GRAPHIC_MOCK_BRIDGE_PATH || '/ws';

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, provider: 'local-asr-bridge-mock' }));
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.on('upgrade', (req, socket) => {
  if (req.url !== PATHNAME) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const websocketKey = req.headers['sec-websocket-key'];
  if (typeof websocketKey !== 'string') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const acceptKey = createHash('sha1')
    .update(`${websocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n',
    ].join('\r\n'),
  );

  const state = {
    frameCount: 0,
    finalSent: false,
    sessionId: `mock-${Date.now()}`,
  };

  sendJsonFrame(socket, {
    type: 'status',
    status: 'connected',
    detail: 'mock bridge connected',
    bridge: {
      protocol: 'lg-asr-ws-v1',
      endpoint: `ws://${HOST}:${PORT}${PATHNAME}`,
      model: 'mock-streaming-asr',
    },
  });

  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const parsed = readClientFrame(buffer);
      if (!parsed) {
        break;
      }

      buffer = parsed.rest;
      if (parsed.opcode === 0x8) {
        socket.end();
        return;
      }

      if (parsed.opcode !== 0x1) {
        continue;
      }

      let payload;
      try {
        payload = JSON.parse(parsed.payload.toString('utf8'));
      } catch {
        sendJsonFrame(socket, {
          type: 'error',
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid JSON payload',
          },
        });
        continue;
      }

      handleMessage(socket, payload, state);
    }
  });

  socket.on('error', () => {
    socket.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-asr-bridge] listening on ws://${HOST}:${PORT}${PATHNAME}`);
  console.log(`[mock-asr-bridge] health check: http://${HOST}:${PORT}/healthz`);
});

function handleMessage(socket, payload, state) {
  switch (payload?.type) {
    case 'session.start': {
      sendJsonFrame(socket, {
        type: 'session.started',
        version: '1',
        session: {
          sessionId: payload?.session?.sessionId ?? state.sessionId,
          bridgeSessionId: state.sessionId,
        },
        bridge: {
          name: 'local-asr-bridge-mock',
          engine: 'mock-streaming-asr',
          engineVersion: '0.1.0',
          model: 'mock-streaming-asr',
          supports: {
            partials: true,
            finals: true,
            tokens: false,
            timestamps: false,
          },
        },
      });
      sendJsonFrame(socket, {
        type: 'status',
        status: 'listening',
        detail: 'mock bridge ready',
        bridge: {
          protocol: 'lg-asr-ws-v1',
          model: 'mock-streaming-asr',
        },
      });
      return;
    }
    case 'audio.frame': {
      state.frameCount += 1;
      if (!state.finalSent && state.frameCount === 1) {
        sendJsonFrame(socket, {
          type: 'transcript.partial',
          utterance: {
            utteranceId: 'utt-1',
            revision: 1,
            text: '今天',
            startMs: 0,
            endMs: 320,
          },
          vendor: {
            name: 'mock-streaming-asr',
            event: 'partial',
          },
        });
      }

      if (!state.finalSent && state.frameCount >= 3) {
        state.finalSent = true;
        sendJsonFrame(socket, {
          type: 'transcript.final',
          utterance: {
            utteranceId: 'utt-1',
            revision: 2,
            text: '今天天气不错，我们开始测试本地 bridge。',
            startMs: 0,
            endMs: 1600,
            finalReason: 'endpoint',
            stability: 'stable',
            language: 'zh',
            confidence: 0.95,
          },
          vendor: {
            name: 'mock-streaming-asr',
            event: 'endpoint',
          },
        });
      }
      return;
    }
    case 'audio.flush': {
      if (!state.finalSent) {
        state.finalSent = true;
        sendJsonFrame(socket, {
          type: 'transcript.final',
          utterance: {
            utteranceId: 'utt-1',
            revision: 2,
            text: '今天天气不错，我们开始测试本地 bridge。',
            startMs: 0,
            endMs: 1600,
            finalReason: 'input_finished',
            stability: 'stable',
            language: 'zh',
            confidence: 0.95,
          },
        });
      }
      return;
    }
    case 'session.stop': {
      sendJsonFrame(socket, {
        type: 'status',
        status: 'closing',
        detail: 'mock bridge stopping',
      });
      socket.end();
      return;
    }
    default: {
      sendJsonFrame(socket, {
        type: 'error',
        error: {
          code: 'BAD_REQUEST',
          message: `Unsupported message type: ${String(payload?.type ?? 'unknown')}`,
        },
      });
    }
  }
}

function sendJsonFrame(socket, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = createServerFrameHeader(body.length);
  socket.write(Buffer.concat([header, body]));
}

function createServerFrameHeader(payloadLength) {
  if (payloadLength < 126) {
    return Buffer.from([0x81, payloadLength]);
  }

  if (payloadLength < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
    return header;
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payloadLength), 2);
  return header;
}

function readClientFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    payloadLength = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + payloadLength) {
    return null;
  }

  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += maskLength;
  const payload = buffer.subarray(offset, offset + payloadLength);
  const decoded = Buffer.alloc(payload.length);

  for (let i = 0; i < payload.length; i += 1) {
    decoded[i] = mask ? payload[i] ^ mask[i % 4] : payload[i];
  }

  return {
    opcode,
    payload: decoded,
    rest: buffer.subarray(offset + payloadLength),
  };
}
