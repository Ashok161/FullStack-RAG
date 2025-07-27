// backend/test-gemini.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function testGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.includes('your-actual-gemini-api-key-here')) {
    console.error('\n❌ ERROR: GEMINI_API_KEY is not set correctly in your backend/.env file.');
    console.log('Please get a real key from Google AI Studio and add it to your .env file.');
    return;
  }

  console.log('🔑 Using API Key ending with:', apiKey.slice(-4));
  console.log('📡 Attempting to connect to Google Gemini API...');

  try {
    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent',
      {
        model: 'models/embedding-001',
        content: { parts: [{ text: 'This is a test.' }] }
      },
      {
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      }
    );

    if (response.data && response.data.embedding && response.data.embedding.values) {
      console.log('\n✅ SUCCESS! Connection to Gemini API is working.');
      console.log('Your API key is valid and billing is enabled.');
      console.log('\nNow, you can confidently run the real preprocessing script.');
      console.log('RUN THIS NEXT: npm run preprocess');
    } else {
      console.error('\n❌ FAILED: The API returned an unexpected response.');
      console.log('Response:', response.data);
    }
  } catch (error) {
    console.error('\n❌ FAILED: Could not connect to Gemini API.');
    if (error.response) {
      console.error('Status Code:', error.response.status);
      console.error('Error Details:', JSON.stringify(error.response.data, null, 2));
      if (error.response.status === 400) {
        console.log('\n👉 FIX: This error means your API Key is INVALID or BILLING is not enabled for your Google Cloud project.');
      }
    } else {
      console.error('Error Message:', error.message);
    }
    console.log('\nPlease go to Google AI Studio, get a new key, ensure billing is enabled, and update your .env file.');
  }
}

testGeminiApiKey();