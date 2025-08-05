import { speech } from '@google-cloud/speech';

const speechClient = new speech.SpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS)
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