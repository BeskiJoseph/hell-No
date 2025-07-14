import dotenv from 'dotenv';
import { Groq } from 'groq-sdk';

dotenv.config();

// New Groq client initialization
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Rename function from analyzeWithOpenAI to analyzeWithGroq
export async function analyzeWithGroq(prompt: string): Promise<string> {
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000
    });
    return response.choices[0].message.content ?? "";
  } catch (error) {
    console.error('Error calling Groq API:', error);
    throw error;
  }
} 