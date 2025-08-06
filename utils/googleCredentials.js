/**
 * Utility to build Google Cloud credentials from environment variables
 */
function buildGoogleCredentials() {
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

  // Validate required fields
  const requiredFields = ['project_id', 'private_key_id', 'private_key', 'client_email', 'client_id'];
  const missingFields = requiredFields.filter(field => !credentials[field]);

  if (missingFields.length > 0) {
    throw new Error(`Missing required Google Cloud environment variables: ${missingFields.map(f => `GOOGLE_CLOUD_${f.toUpperCase()}`).join(', ')}`);
  }

  return credentials;
}

module.exports = { buildGoogleCredentials };
