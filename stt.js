import { speech } from '@google-cloud/speech';
import { Server } from 'ws';

// Build credentials from environment variables
const credentials = {
  type: "service_account",
  project_id: process.env.GOOGLE_CLOUD_PROJECT_ID,
  private_key_id: process.env.GOOGLE_CLOUD_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_CLOUD_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_CLOUD_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.GOOGLE_CLOUD_CLIENT_X509_CERT_URL,
  universe_domain: "googleapis.com"
};

const speechClient = new speech.SpeechClient({
  credentials: credentials
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