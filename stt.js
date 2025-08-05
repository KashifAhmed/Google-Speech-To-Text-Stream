import { speech } from '@google-cloud/speech';
import { Server } from 'ws';

const speechClient = new speech.SpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS)
});

export default async function handler(req, res) {
  if (req.headers.upgrade !== 'websocket') {
    res.status(400).json({ error: 'Expected WebSocket connection' });
    return;
  }

  const wss = new Server({ noServer: true });
  
  wss.on('connection', handleConnection);
  
  // Upgrade the connection
  wss.handleUpgrade(req, req.socket, Buffer.alloc(0), (ws) => {
    wss.emit('connection', ws, req);
  });
}

function handleConnection(ws, req) {
  // ... existing WebSocket logic ...
}