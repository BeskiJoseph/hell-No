// Update AIService to use Groq for code conversion
import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export class AIService {
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor() {
    this.apiKey = process.env.GROQ_API_KEY || '';
    if (!this.apiKey) {
      console.error('GROQ_API_KEY is not set in environment variables');
      throw new Error('GROQ_API_KEY is required');
    }
    this.apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
  }

  async convert(prompt: string): Promise<string> {
    try {
      console.log('Making request to Groq API...');
      const response = await axios.post(
        this.apiUrl,
        {
          model: 'llama3-70b-8192',
          messages: [
            {
              role: 'system',
              content: `You are an expert PHP to Node.js converter. Your job is to:
1. Analyze the uploaded PHP code.
2. Convert it to TypeScript/Node.js using Express.js conventions.
3. Use proper TypeScript syntax and types.
4. Include proper error handling and async/await patterns.
5. Add helpful comments explaining the conversion.

IMPORTANT: Return ONLY the TypeScript code wrapped in \`\`\`typescript\`\`\` code blocks.
Do NOT include explanations, markdown, or any other content outside the code blocks.

Examples:
- PHP functions → TypeScript functions with proper typing
- PHP arrays → TypeScript interfaces and arrays
- PHP classes → TypeScript classes with proper access modifiers
- PHP database queries → TypeScript with proper async/await patterns`
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 4000
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Groq API response received');
      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('Error calling Groq API:', error);
      if (axios.isAxiosError(error)) {
        console.error('Response data:', error.response?.data);
        console.error('Response status:', error.response?.status);
        
        // Provide more specific error messages
        if (error.response?.status === 400) {
          const errorData = error.response.data;
          if (errorData?.error?.message) {
            throw new Error(`Groq API Error: ${errorData.error.message}`);
          } else if (errorData?.message) {
            throw new Error(`Groq API Error: ${errorData.message}`);
          } else {
            throw new Error('Groq API Error: Bad Request - Check your API key and model name');
          }
        } else if (error.response?.status === 401) {
          throw new Error('Groq API Error: Unauthorized - Invalid API key');
        } else if (error.response?.status === 429) {
          throw new Error('Groq API Error: Rate limit exceeded');
        }
      }
      throw new Error('Failed to convert code using Groq');
    }
  }
} 