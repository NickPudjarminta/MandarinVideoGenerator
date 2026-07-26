import 'dotenv/config'

export function requireEnv(name) {
  const value = process.env[name]
  if (!value || value.includes('your_') || value.includes('_here')) {
    throw new Error(`Missing or placeholder env var: ${name}. Set it in .env`)
  }
  return value
}

export function getEnv() {
  return {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    AZURE_SPEECH_KEY: process.env.AZURE_SPEECH_KEY,
    AZURE_SPEECH_REGION: process.env.AZURE_SPEECH_REGION || 'eastus',
  }
}
