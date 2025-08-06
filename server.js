const WebSocket = require('ws');
const speech = require('@google-cloud/speech');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { buildGoogleCredentials } = require('./utils/googleCredentials');
require('dotenv').config();

const PORT = process.env.PORT || 8080;

console.log('🚀 [Server] Starting STT WebSocket server on port', PORT);

let credentials;

try {
  credentials = buildGoogleCredentials();
  console.log('✅ [Server] Google Cloud credentials loaded');
} catch (error) {
  console.error('❌ [Server] Error building Google Cloud credentials:', error.message);
  process.exit(1);
}

// Validate credentials type
if (credentials.type !== 'service_account') {
  console.error('❌ [Server] Invalid credentials type. Expected "service_account", got:', credentials.type);
  process.exit(1);
}

let speechClient;

try {
  speechClient = new speech.SpeechClient({
    credentials: credentials,
    projectId: credentials.project_id
  });
  console.log('✅ [Server] Google Speech client initialized');
  
  // Test authentication on startup
  speechClient.getProjectId()
    .then(() => {
      console.log('✅ [Server] Google Cloud authentication verified');
    })
    .catch(error => {
      console.error('❌ [Server] Google Cloud auth test failed:', error.message);
      if (error.message.includes('DECODER routines')) {
        console.error('❌ [Server] Private key format issue detected');
      }
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
          if (recognizeStream && isStreamActive && !recognizeStream.destroyed) {
            // Convert base64 audio to buffer and send to Google STT
            const audioBuffer = Buffer.from(data.audio, 'base64');
            console.log(`📤 [Server] Client #${clientId} forwarding to Google STT, buffer size:`, audioBuffer.length);
            
            // Estimate audio duration based on buffer size (rough calculation for WEBM_OPUS)
            // Assuming ~1.5KB per second for compressed audio
            const estimatedDurationMs = (audioBuffer.length / 1500) * 1000;
            sessionAudioDuration += estimatedDurationMs;
            
            try {
              recognizeStream.write(audioBuffer);
            } catch (error) {
              console.error(`💥 [Server] Client #${clientId} error writing to stream:`, error.message);
              if (error.code === 'ERR_STREAM_DESTROYED') {
                console.log(`🔄 [Server] Client #${clientId} stream was destroyed, marking as inactive`);
                isStreamActive = false;
                recognizeStream = null;
              }
            }
          } else {
            console.warn(`⚠️ [Server] Client #${clientId} sent audio but stream not active:`, {
              recognizeStream: !!recognizeStream,
              isStreamActive,
              isDestroyed: recognizeStream ? recognizeStream.destroyed : 'N/A'
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
      try {
        if (!recognizeStream.destroyed) {
          recognizeStream.destroy();
        }
      } catch (error) {
        console.error(`💥 [Server] Client #${clientId} error destroying stream:`, error.message);
      }
      recognizeStream = null;
      isStreamActive = false;
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
      interimResults: true,
      singleUtterance: false
    };

    try {
      recognizeStream = speechClient
        .streamingRecognize(request)
        .on('error', (error) => {
          console.error(`💥 [Server] Client #${clientId} Google STT error:`, error.message);
          
          // Mark stream as inactive when there's an error
          isStreamActive = false;
          recognizeStream = null;
          
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
        .on('destroy', () => {
          isStreamActive = false;
          recognizeStream = null;
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
      .on('end', () => {});

      if (recognizeStream) {
        isStreamActive = true;
        console.log(`✅ [Server] Client #${clientId} Google STT stream created successfully`);
        
        ws.send(JSON.stringify({
          type: 'status',
          status: 'started'
        }));
      } else {
        console.error(`❌ [Server] Client #${clientId} Failed to create Google STT stream`);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Failed to initialize speech recognition stream'
        }));
      }
      
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
      try {
        if (!recognizeStream.destroyed) {
          recognizeStream.end();
        } else {
          console.log(`⚠️ [Server] Client #${clientId} stream already destroyed`);
        }
      } catch (error) {
        console.error(`💥 [Server] Client #${clientId} error ending stream:`, error.message);
      }
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