"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeWithGroq = analyzeWithGroq;
const dotenv_1 = __importDefault(require("dotenv"));
const groq_sdk_1 = require("groq-sdk");
dotenv_1.default.config();
const groq = new groq_sdk_1.Groq({ apiKey: process.env.GROQ_API_KEY });
async function analyzeWithGroq(prompt) {
    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1000
        });
        return response.choices[0].message.content ?? "";
    }
    catch (error) {
        console.error('Error calling Groq API:', error);
        throw error;
    }
}
//# sourceMappingURL=openaiClient.js.map