import { speech } from '@google-cloud/speech';

// Build credentials from environment variables
const credentials = {
  type: "service_account",
  project_id: process.env.GOOGLE_CLOUD_PROJECT_ID,
  private_key_id: process.env.GOOGLE_CLOUD_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_CLOUD_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_CLOUD_CLIENT_ID,
  auth_uri: process.env.GOOGLE_CLOUD_AUTH_URI,
  token_uri: process.env.GOOGLE_CLOUD_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GOOGLE_CLOUD_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.GOOGLE_CLOUD_CLIENT_X509_CERT_URL,
  universe_domain: process.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN
};

const speechClient = new speech.SpeechClient({
  credentials: credentials
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { audioContent, config } = req.body;

    if (!audioContent) {
      return res.status(400).json({ error: 'Audio content is required' });
    }

    const request = {
      audio: {
        content: audioContent,
      },
      config: {
        encoding: config?.encoding || 'WEBM_OPUS',
        sampleRateHertz: config?.sampleRateHertz || 48000,
        languageCode: config?.languageCode || 'en-US',
        enableAutomaticPunctuation: true,
        model: 'latest_long',
        ...config
      },
    };

    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    res.status(200).json({
      success: true,
      transcription,
      confidence: response.results[0]?.alternatives[0]?.confidence || 0
    });

  } catch (error) {
    console.error('STT Error:', error);
    res.status(500).json({
      success: false,
      error: 'Speech recognition failed',
      message: error.message
    });
  }
}