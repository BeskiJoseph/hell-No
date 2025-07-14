import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.error('GROQ_API_KEY is not set in environment variables');
  process.exit(1);
}

export async function analyzeWithGroq(prompt: string) {
  try {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const payload = {
      model: 'llama3-70b-8192', // Or 'llama3-8b-8192'
      messages: [
        { role: 'system', content: 'You are a helpful code migration assistant.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    };
    const headers = {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    };

    console.log('Request URL:', url);
    console.log('Request Headers:', headers);
    console.log('Request Payload:', payload);

    const response = await axios.post(url, payload, { headers });

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error calling Groq API:', error);
    throw error;
  }
} 