/**
 * Utility to build Google Cloud credentials from environment variables
 */
function buildGoogleCredentials() {
  // Debug environment info
  console.log('🔧 [Credentials] Node.js version:', process.version);
  console.log('🔧 [Credentials] Platform:', process.platform);
  console.log('🔧 [Credentials] OpenSSL version:', process.versions.openssl);
  
  const rawPrivateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY;
  console.log('🔧 [Credentials] Private key length:', rawPrivateKey?.length || 0);
  console.log('🔧 [Credentials] Private key starts with:', rawPrivateKey?.substring(0, 50) || 'N/A');
  
  const processedPrivateKey = rawPrivateKey?.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
  console.log('🔧 [Credentials] Processed key starts with:', processedPrivateKey?.substring(0, 50) || 'N/A');
  
  const credentials = {
    type: "service_account",
    project_id: process.env.GOOGLE_CLOUD_PROJECT_ID,
    private_key_id: process.env.GOOGLE_CLOUD_PRIVATE_KEY_ID,
    private_key: processedPrivateKey,
    client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLOUD_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.GOOGLE_CLOUD_CLIENT_X509_CERT_URL,
    universe_domain: "googleapis.com"
  };

  // Validate required fields
  const requiredFields = ['project_id', 'private_key_id', 'private_key', 'client_email', 'client_id'];
  const missingFields = requiredFields.filter(field => !credentials[field]);

  if (missingFields.length > 0) {
    throw new Error(`Missing required Google Cloud environment variables: ${missingFields.map(f => `GOOGLE_CLOUD_${f.toUpperCase()}`).join(', ')}`);
  }

  return credentials;
}

/**
 * Alternative credential builder using different approaches for Fly.io
 */
function buildGoogleCredentialsAlternative() {
  try {
    // Method 1: Try with Buffer encoding
    const privateKeyBuffer = Buffer.from(process.env.GOOGLE_CLOUD_PRIVATE_KEY || '', 'utf8');
    const privateKeyString = privateKeyBuffer.toString('utf8').replace(/\\n/g, '\n');
    
    return {
      type: "service_account",
      project_id: process.env.GOOGLE_CLOUD_PROJECT_ID,
      private_key_id: process.env.GOOGLE_CLOUD_PRIVATE_KEY_ID,
      private_key: privateKeyString,
      client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLOUD_CLIENT_ID,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: process.env.GOOGLE_CLOUD_CLIENT_X509_CERT_URL,
      universe_domain: "googleapis.com"
    };
  } catch (error) {
    console.error('🔧 [Credentials] Alternative method failed:', error.message);
    throw error;
  }
}

module.exports = { buildGoogleCredentials, buildGoogleCredentialsAlternative };
