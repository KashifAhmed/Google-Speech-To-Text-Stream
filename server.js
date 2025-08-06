const WebSocket = require('ws');
const speech = require('@google-cloud/speech');
const fs = require('fs');
const path = require('path');
const http = require('http');
require('dotenv').config();

const PORT = process.env.PORT || 8080;

console.log('🚀 [Server] Starting STT WebSocket server...');
console.log('📊 [Server] Environment variables:', {
  PORT,
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'SET' : 'NOT SET',
  NODE_ENV: process.env.NODE_ENV || 'development',
  PWD: process.cwd()
});

// Validate Google Cloud credentials
console.log('🔍 [Server] Validating Google Cloud credentials...');
const credentialsEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credentialsJsonEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

let credentials;

if (credentialsJsonEnv) {
  // Direct JSON in environment variable
  console.log('📋 [Server] Using inline JSON credentials from GOOGLE_APPLICATION_CREDENTIALS_JSON');
  try {
    credentials = JSON.parse(credentialsJsonEnv);
    console.log('✅ [Server] Inline JSON credentials parsed successfully');
  } catch (error) {
    console.error('❌ [Server] Error parsing GOOGLE_APPLICATION_CREDENTIALS_JSON:', error.message);
    process.exit(1);
  }
} else if (credentialsEnv) {
  // File path in environment variable
  console.log('📁 [Server] Using credentials file from GOOGLE_APPLICATION_CREDENTIALS:', credentialsEnv);
  console.log('📁 [Server] Resolved path:', path.resolve(credentialsEnv));

  // Check if credentials file exists
  if (!fs.existsSync(credentialsEnv)) {
    console.error('❌ [Server] Credentials file not found at:', credentialsEnv);
    console.error('❌ [Server] Current working directory:', process.cwd());
    console.error('❌ [Server] Files in current directory:', fs.readdirSync('.'));
    process.exit(1);
  }

  try {
    const credentialsContent = fs.readFileSync(credentialsEnv, 'utf8');
    credentials = JSON.parse(credentialsContent);
    console.log('✅ [Server] Credentials file found and parsed successfully');
  } catch (error) {
    console.error('❌ [Server] Error reading/parsing credentials file:', error.message);
    process.exit(1);
  }
} else {
  console.error('❌ [Server] Neither GOOGLE_APPLICATION_CREDENTIALS nor GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable is set');
  process.exit(1);
}

console.log('📋 [Server] Service account info:', {
  project_id: credentials.project_id,
  client_email: credentials.client_email,
  type: credentials.type,
  hasPrivateKey: !!credentials.private_key
});

// Validate required fields
const requiredFields = ['type', 'project_id', 'private_key_id', 'private_key', 'client_email', 'client_id', 'auth_uri', 'token_uri'];
const missingFields = requiredFields.filter(field => !credentials[field]);

if (missingFields.length > 0) {
  console.error('❌ [Server] Missing required fields in credentials:', missingFields);
  process.exit(1);
}

if (credentials.type !== 'service_account') {
  console.error('❌ [Server] Invalid credentials type. Expected "service_account", got:', credentials.type);
  process.exit(1);
}

// Initialize Google Speech client with detailed error handling
console.log('🔧 [Server] Initializing Google Speech client...');
let speechClient;

try {
  // Initialize with explicit credentials
  speechClient = new speech.SpeechClient({
    credentials: credentials,
    projectId: credentials.project_id
  });
  console.log('✅ [Server] Google Speech client initialized');
  
  // Test the client connection
  console.log('🧪 [Server] Testing Google Speech client connection...');
  speechClient.getProjectId()
    .then(projectId => {
      console.log('✅ [Server] Google Speech client connection successful. Project ID:', projectId);
    })
    .catch(error => {
      console.error('❌ [Server] Google Speech client connection test failed:', error.message);
      console.error('❌ [Server] Full error:', error);
    });
    
} catch (error) {
  console.error('❌ [Server] Failed to initialize Google Speech client:', error.message);
  console.error('❌ [Server] Full error:', error);
  process.exit(1);
}

// Add process error handlers
process.on('uncaughtException', (error) => {
  console.error('💥 [Server] Uncaught Exception:', error);
  console.error('💥 [Server] Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 [Server] Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('💥 [Server] Stack:', reason?.stack);
  process.exit(1);
});

// Create HTTP server first
console.log('🔧 [Server] Creating HTTP server on port', PORT);
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    // Health check endpoint
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'healthy', 
      service: 'STT WebSocket Server',
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// WebSocket server
console.log('🔧 [Server] Creating WebSocket server on port', PORT);
let wss;

try {
  wss = new WebSocket.Server({ 
    server: server,
    perMessageDeflate: false,
    clientTracking: true
  });
  
  const isProduction = process.env.NODE_ENV === 'production';
  const protocol = isProduction ? 'wss' : 'ws';
  const host = isProduction ? process.env.RENDER_EXTERNAL_URL || 'your-app.onrender.com' : 'localhost';
  
  // Start the HTTP server
  server.listen(PORT, () => {
    console.log(`🎤 [Server] STT WebSocket server running on ${protocol}://${host}:${PORT}`);
    console.log(`🔗 [Server] Connect to: ${protocol}://${host}${isProduction ? '' : ':' + PORT}`);
    console.log(`🏥 [Server] Health check available at: http://${host}${isProduction ? '' : ':' + PORT}/`);
    console.log('🎤 [Server] Server ready to accept connections');
  });
  
} catch (error) {
  console.error('💥 [Server] Failed to create WebSocket server:', error);
  process.exit(1);
}

wss.on('listening', () => {
  console.log('👂 [Server] WebSocket server is listening');
  console.log('🌐 [Server] Health check: Server is operational');
});

wss.on('error', (error) => {
  console.error('💥 [Server] WebSocket server error:', {
    message: error.message,
    code: error.code,
    stack: error.stack
  });
});

let clientCounter = 0;

// Cost tracking
const STT_COST_PER_15_SECONDS = 0.006; // $0.006 per 15 seconds for standard model
const costTracker = {
  totalRequests: 0,
  totalAudioDurationSeconds: 0,
  totalCostUSD: 0,
  sessions: []
};

wss.on('connection', (ws, req) => {
  clientCounter++;
  const clientId = clientCounter;
  const clientInfo = {
    id: clientId,
    ip: req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    origin: req.headers.origin
  };
  
  console.log(`📱 [Server] Client #${clientId} connected:`, clientInfo);
  
  let recognizeStream = null;
  let isStreamActive = false;
  let sessionStartTime = null;
  let sessionAudioDuration = 0;

  ws.on('message', async (message) => {
    console.log(`📨 [Server] Client #${clientId} sent message:`, message.toString().substring(0, 200) + '...');
    try {
      const data = JSON.parse(message);
      console.log(`📨 [Server] Client #${clientId} parsed message:`, {
        type: data.type,
        configKeys: data.config ? Object.keys(data.config) : undefined,
        audioSize: data.audio ? data.audio.length : undefined
      });
      
      switch (data.type) {
        case 'start':
          console.log(`🎙️ [Server] Client #${clientId} starting recognition:`, data.config);
          sessionStartTime = Date.now();
          sessionAudioDuration = 0;
          startRecognition(ws, data.config);
          break;
        case 'audio':
          console.log(`🎵 [Server] Client #${clientId} sent audio chunk, size:`, data.audio ? data.audio.length : 0);
          if (recognizeStream && isStreamActive) {
            // Convert base64 audio to buffer and send to Google STT
            const audioBuffer = Buffer.from(data.audio, 'base64');
            console.log(`📤 [Server] Client #${clientId} forwarding to Google STT, buffer size:`, audioBuffer.length);
            
            // Estimate audio duration based on buffer size (rough calculation for WEBM_OPUS)
            // Assuming ~1.5KB per second for compressed audio
            const estimatedDurationMs = (audioBuffer.length / 1500) * 1000;
            sessionAudioDuration += estimatedDurationMs;
            
            recognizeStream.write(audioBuffer);
          } else {
            console.warn(`⚠️ [Server] Client #${clientId} sent audio but stream not active:`, {
              recognizeStream: !!recognizeStream,
              isStreamActive
            });
          }
          break;
        case 'stop':
          console.log(`⏹️ [Server] Client #${clientId} stopping recognition`);
          stopRecognition();
          break;
        case 'ping':
          console.log(`💓 [Server] Client #${clientId} ping received, sending pong`);
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        case 'cost_summary':
          console.log(`💰 [Server] Client #${clientId} requested cost summary`);
          const summary = {
            type: 'cost_summary',
            totalRequests: costTracker.totalRequests,
            totalAudioDurationSeconds: Math.round(costTracker.totalAudioDurationSeconds * 100) / 100,
            totalCostUSD: Math.round(costTracker.totalCostUSD * 10000) / 10000,
            averageCostPerRequest: costTracker.totalRequests > 0 ? 
              Math.round((costTracker.totalCostUSD / costTracker.totalRequests) * 10000) / 10000 : 0,
            recentSessions: costTracker.sessions.slice(-10) // Last 10 sessions
          };
          ws.send(JSON.stringify(summary));
          break;
        default:
          console.log(`❓ [Server] Client #${clientId} unknown message type:`, data.type);
      }
    } catch (error) {
      console.error(`💥 [Server] Client #${clientId} error processing message:`, error);
      console.error(`💥 [Server] Client #${clientId} raw message was:`, message.toString());
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`📱 [Server] Client #${clientId} disconnected:`, {
      code,
      reason: reason.toString(),
      wasStreamActive: isStreamActive
    });
    stopRecognition();
  });

  ws.on('error', (error) => {
    console.error(`💥 [Server] Client #${clientId} WebSocket error:`, error);
  });

  ws.on('pong', () => {
    console.log(`🏓 [Server] Client #${clientId} pong received`);
  });

  // Send initial connection confirmation
  console.log(`📤 [Server] Sending connection confirmation to client #${clientId}`);
  ws.send(JSON.stringify({
    type: 'status',
    status: 'connected',
    clientId: clientId
  }));

  function startRecognition(ws, config = {}) {
    console.log(`🎙️ [Server] Client #${clientId} startRecognition called with config:`, config);
    
    if (recognizeStream) {
      console.log(`🔄 [Server] Client #${clientId} destroying existing recognition stream`);
      recognizeStream.destroy();
    }

    const request = {
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: config.languageCode || 'en-US',
        alternativeLanguageCodes: config.alternativeLanguageCodes || [],
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: false,
        model: 'latest_long',
        useEnhanced: true,
      },
      interimResults: false, // Changed from true to false
      singleUtterance: true  // Changed from false to true
    };

    console.log(`📤 [Server] Client #${clientId} creating Google STT stream with request:`, JSON.stringify(request, null, 2));

    try {
      recognizeStream = speechClient
        .streamingRecognize(request)
        .on('error', (error) => {
          console.error(`💥 [Server] Client #${clientId} Google STT stream error:`, {
            message: error.message,
            code: error.code,
            details: error.details,
            metadata: error.metadata,
            stack: error.stack
          });
          
          // Send detailed error info to client
          const errorMessage = error.code ? 
            `Google STT Error [${error.code}]: ${error.message}` : 
            `Google STT Error: ${error.message}`;
            
          ws.send(JSON.stringify({
            type: 'error',
            message: errorMessage,
            code: error.code,
            details: error.details
          }));
        })
      .on('data', (data) => {
        if (data.results[0] && data.results[0].alternatives[0]) {
          const result = data.results[0];
          const transcript = result.alternatives[0].transcript;
          
          // Calculate cost for this session
          const sessionDurationSeconds = sessionAudioDuration / 1000;
          const sessionCost = Math.ceil(sessionDurationSeconds / 15) * STT_COST_PER_15_SECONDS;
          
          // Update global cost tracking
          costTracker.totalRequests++;
          costTracker.totalAudioDurationSeconds += sessionDurationSeconds;
          costTracker.totalCostUSD += sessionCost;
          
          // Store session info
          costTracker.sessions.push({
            clientId: clientId,
            timestamp: new Date().toISOString(),
            durationSeconds: sessionDurationSeconds,
            costUSD: sessionCost,
            transcript: transcript.substring(0, 100) + (transcript.length > 100 ? '...' : '')
          });
          
          // Only final results will come through now
          const response = {
            type: 'transcript',
            transcript: transcript,
            isFinal: true,
            confidence: result.alternatives[0].confidence,
            languageCode: data.results[0].languageCode,
            cost: {
              sessionDurationSeconds: Math.round(sessionDurationSeconds * 100) / 100,
              sessionCostUSD: Math.round(sessionCost * 10000) / 10000,
              totalCostUSD: Math.round(costTracker.totalCostUSD * 10000) / 10000
            }
          };
          
          console.log(`💰 [Server] Client #${clientId} session cost: $${sessionCost.toFixed(4)} (${sessionDurationSeconds.toFixed(2)}s)`);
          console.log(`💰 [Server] Total cost to date: $${costTracker.totalCostUSD.toFixed(4)} (${costTracker.totalRequests} requests)`);
          console.log(`📤 [Server] Client #${clientId} sending transcript:`, response);
          ws.send(JSON.stringify(response));
        }
      })
      .on('end', () => {
        console.log(`🔚 [Server] Client #${clientId} Google STT stream ended`);
      });

      isStreamActive = true;
      console.log(`🎙️ [Server] Client #${clientId} Recognition started successfully`);
      
      ws.send(JSON.stringify({
        type: 'status',
        status: 'started'
      }));
      
    } catch (error) {
      console.error(`💥 [Server] Client #${clientId} Failed to create Google STT stream:`, {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      
      ws.send(JSON.stringify({
        type: 'error',
        message: `Failed to start recognition: ${error.message}`,
        code: error.code
      }));
    }
  }

  function stopRecognition() {
    console.log(`⏹️ [Server] Client #${clientId} stopRecognition called`);
    
    if (recognizeStream) {
      console.log(`⏹️ [Server] Client #${clientId} ending Google STT stream`);
      recognizeStream.end();
      recognizeStream = null;
      isStreamActive = false;
      console.log(`⏹️ [Server] Client #${clientId} Recognition stopped`);
      
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'status',
          status: 'stopped'
        }));
      }
    } else {
      console.log(`⏹️ [Server] Client #${clientId} No recognition stream to stop`);
    }
  }
});