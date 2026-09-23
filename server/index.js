/**
 * rn-web-inspector server
 * -------------------------------------------------------------
 * Run with:  node server/index.js
 * Then open: http://localhost:4000  in any browser (no install)
 *
 * Two kinds of WebSocket clients connect to the same server:
 *   1. React Native app(s)  -> role=device  -> SENDS events
 *   2. Browser dashboard(s) -> role=browser -> RECEIVES events
 *
 * The server relays: device -> all connected browsers, and keeps
 * track of which devices are currently connected (name, platform,
 * app name) so a dashboard that opens late still sees who's online.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 4000;
const HISTORY_LIMIT = 500;

const history = []; // ring buffer of recent events
const devices = new Map(); // deviceId -> { id, deviceName, appName, platform, connectedAt }

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

const browserClients = new Set();

wss.on('connection', (ws) => {
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return; // ignore malformed frames
    }

    if (msg.type === 'hello') {
      ws.role = msg.role;

      if (msg.role === 'browser') {
        browserClients.add(ws);
        // Newly-connected dashboard gets recent history AND who's online now
        ws.send(JSON.stringify({ type: 'history', events: history }));
        ws.send(JSON.stringify({ type: 'device-list', devices: [...devices.values()] }));
      } else if (msg.role === 'device') {
        const deviceId = crypto.randomUUID();
        ws.deviceId = deviceId;

        const deviceInfo = {
          id: deviceId,
          deviceName: msg.deviceName || 'Unnamed device',
          appName: msg.appName || 'Unknown app',
          platform: msg.platform || 'unknown',
          connectedAt: Date.now(),
        };
        devices.set(deviceId, deviceInfo);

        console.log(`[connected] ${deviceInfo.appName} on ${deviceInfo.deviceName} (${deviceInfo.platform})`);
        broadcastToBrowsers({ type: 'device-connected', device: deviceInfo });
      }
      return;
    }

    // Any other message coming from a device is an event to relay + store,
    // tagged with which device sent it.
    if (ws.role === 'device') {
      const tagged = { ...msg, deviceId: ws.deviceId };
      history.push(tagged);
      if (history.length > HISTORY_LIMIT) history.shift();
      broadcastToBrowsers(tagged);
    }
  });

  ws.on('close', () => {
    browserClients.delete(ws);
    if (ws.deviceId && devices.has(ws.deviceId)) {
      const deviceInfo = devices.get(ws.deviceId);
      devices.delete(ws.deviceId);
      console.log(`[disconnected] ${deviceInfo.appName} on ${deviceInfo.deviceName}`);
      broadcastToBrowsers({ type: 'device-disconnected', deviceId: ws.deviceId });
    }
  });
});

function broadcastToBrowsers(payload) {
  const data = JSON.stringify(payload);
  for (const client of browserClients) {
    if (client.readyState === 1) client.send(data);
  }
}

server.listen(PORT, () => {
  console.log(`rn-web-inspector running:`);
  console.log(`  Dashboard:  http://localhost:${PORT}`);
  console.log(`  WS endpoint (for RN client): ws://<your-machine-ip>:${PORT}`);
});
