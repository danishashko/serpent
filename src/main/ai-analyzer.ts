import axios from 'axios';

const OLLAMA_DEFAULT_URL = 'http://localhost:11434';

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export interface AIAnalysisInput {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  wordCount: number | null;
  statusCode: number | null;
  canonicalUrl: string | null;
  isIndexable: boolean;
}

export interface AIAnalysisOutput {
  score: number; // 1–10
  issues: string[];
  suggestions: string[];
  optimizedTitle?: string;
  optimizedMeta?: string;
}

export async function testOllamaConnection(baseUrl: string = OLLAMA_DEFAULT_URL): Promise<boolean> {
  try {
    const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 5000 });
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function listOllamaModels(baseUrl: string = OLLAMA_DEFAULT_URL): Promise<OllamaModel[]> {
  try {
    const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 5000 });
    return response.data?.models || [];
  } catch {
    return [];
  }
}

async function ollamaGenerate(
  prompt: string,
  model: string,
  baseUrl: string = OLLAMA_DEFAULT_URL
): Promise<string> {
  const response = await axios.post(
    `${baseUrl}/api/generate`,
    {
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 512,
      },
    },
    { timeout: 60000 }
  );
  return (response.data as { response: string }).response;
}

export async function analyzeContentQuality(
  input: AIAnalysisInput,
  model: string,
  baseUrl: string = OLLAMA_DEFAULT_URL
): Promise<AIAnalysisOutput> {
  const prompt = `You are an SEO expert. Analyze this webpage's SEO quality and respond with valid JSON only.

URL: ${input.url}
Title: ${input.title || 'MISSING'}
Meta Description: ${input.metaDescription || 'MISSING'}
H1: ${input.h1 || 'MISSING'}
Word Count: ${input.wordCount ?? 'UNKNOWN'}

Respond with this exact JSON structure:
{
  "score": <number 1-10>,
  "issues": [<string>, ...],
  "suggestions": [<string>, ...],
  "optimizedTitle": "<suggested title if needed>",
  "optimizedMeta": "<suggested meta description if needed>"
}`;

  try {
    const raw = await ollamaGenerate(prompt, model, baseUrl);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    return JSON.parse(jsonMatch[0]) as AIAnalysisOutput;
  } catch {
    return {
      score: 5,
      issues: ['Failed to analyze with AI model'],
      suggestions: [],
    };
  }
}

export async function analyzeTechnicalSEO(
  input: AIAnalysisInput,
  model: string,
  baseUrl: string = OLLAMA_DEFAULT_URL
): Promise<AIAnalysisOutput> {
  const prompt = `You are a technical SEO expert. Analyze this page's technical health and respond with valid JSON only.

URL: ${input.url}
Status Code: ${input.statusCode ?? 'UNKNOWN'}
Canonical URL: ${input.canonicalUrl || 'NOT SET'}
Is Indexable: ${input.isIndexable}
Title: ${input.title || 'MISSING'}

Identify technical issues and suggest fixes. Respond with this exact JSON structure:
{
  "score": <number 1-10>,
  "issues": [<string>, ...],
  "suggestions": [<string>, ...]
}`;

  try {
    const raw = await ollamaGenerate(prompt, model, baseUrl);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    return JSON.parse(jsonMatch[0]) as AIAnalysisOutput;
  } catch {
    return {
      score: 5,
      issues: ['Failed to analyze with AI model'],
      suggestions: [],
    };
  }
}
