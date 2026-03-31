import axios from 'axios';
import { AIProvider } from '../types/index';

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

/** Configuration for whichever AI provider is active */
export interface AIProviderConfig {
  provider: AIProvider;
  model: string;
  ollamaUrl?: string;
  apiKey?: string;
}

// ─── Provider Connection Tests ─────────────────────────────────────────────────

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

export async function testOpenAIConnection(apiKey: string): Promise<boolean> {
  try {
    const response = await axios.get('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function listOpenAIModels(apiKey: string): Promise<string[]> {
  try {
    const response = await axios.get('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });
    const models = (response.data?.data || []) as { id: string }[];
    return models
      .map(m => m.id)
      .filter(id => id.startsWith('gpt-'))
      .sort();
  } catch {
    return [];
  }
}

export async function testAnthropicConnection(apiKey: string): Promise<boolean> {
  try {
    // Minimal request to check key validity
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
        validateStatus: (s) => s < 500, // 4xx is fine (means key format is ok or rate limited)
      }
    );
    // 200 = success, 401 = bad key, 429 = rate limited (key valid)
    return response.status === 200 || response.status === 429;
  } catch {
    return false;
  }
}

export async function testGeminiConnection(apiKey: string): Promise<boolean> {
  try {
    const response = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { timeout: 10000 }
    );
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function listGeminiModels(apiKey: string): Promise<string[]> {
  try {
    const response = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { timeout: 10000 }
    );
    const models = (response.data?.models || []) as { name: string; supportedGenerationMethods?: string[] }[];
    return models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace('models/', ''))
      .sort();
  } catch {
    return [];
  }
}

/** Test any AI provider's connection */
export async function testAIProviderConnection(
  provider: AIProvider,
  config: { ollamaUrl?: string; apiKey?: string }
): Promise<{ success: boolean; models?: string[] }> {
  switch (provider) {
    case 'ollama': {
      const ok = await testOllamaConnection(config.ollamaUrl);
      const models = ok ? (await listOllamaModels(config.ollamaUrl)).map(m => m.name) : [];
      return { success: ok, models };
    }
    case 'openai': {
      if (!config.apiKey) return { success: false };
      const ok = await testOpenAIConnection(config.apiKey);
      const models = ok ? await listOpenAIModels(config.apiKey) : [];
      return { success: ok, models };
    }
    case 'anthropic': {
      if (!config.apiKey) return { success: false };
      const ok = await testAnthropicConnection(config.apiKey);
      // Anthropic doesn't have a list-models endpoint; provide known models
      const models = ok ? ['claude-sonnet-4-20250514', 'claude-haiku-4-20250514', 'claude-opus-4-20250514'] : [];
      return { success: ok, models };
    }
    case 'gemini': {
      if (!config.apiKey) return { success: false };
      const ok = await testGeminiConnection(config.apiKey);
      const models = ok ? await listGeminiModels(config.apiKey) : [];
      return { success: ok, models };
    }
  }
}

// ─── Unified Text Generation ───────────────────────────────────────────────────

async function generateCompletion(prompt: string, config: AIProviderConfig): Promise<string> {
  switch (config.provider) {
    case 'ollama':
      return ollamaGenerate(prompt, config.model, config.ollamaUrl || OLLAMA_DEFAULT_URL);
    case 'openai':
      return openaiGenerate(prompt, config.model, config.apiKey!);
    case 'anthropic':
      return anthropicGenerate(prompt, config.model, config.apiKey!);
    case 'gemini':
      return geminiGenerate(prompt, config.model, config.apiKey!);
  }
}

async function ollamaGenerate(prompt: string, model: string, baseUrl: string): Promise<string> {
  const response = await axios.post(
    `${baseUrl}/api/generate`,
    {
      model,
      prompt,
      stream: false,
      options: { temperature: 0.3, num_predict: 512 },
    },
    { timeout: 60000 }
  );
  return (response.data as { response: string }).response;
}

async function openaiGenerate(prompt: string, model: string, apiKey: string): Promise<string> {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: 'You are an SEO expert. Respond only with valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 512,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );
  return (response.data as { choices: { message: { content: string } }[] }).choices[0].message.content;
}

async function anthropicGenerate(prompt: string, model: string, apiKey: string): Promise<string> {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
      system: 'You are an SEO expert. Respond only with valid JSON.',
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );
  const data = response.data as { content: { type: string; text: string }[] };
  return data.content[0].text;
}

async function geminiGenerate(prompt: string, model: string, apiKey: string): Promise<string> {
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
    }
  );
  const data = response.data as { candidates: { content: { parts: { text: string }[] } }[] };
  return data.candidates[0].content.parts[0].text;
}

// ─── SEO Analysis Functions ────────────────────────────────────────────────────

function parseAIResponse(raw: string): AIAnalysisOutput {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in response');
  return JSON.parse(jsonMatch[0]) as AIAnalysisOutput;
}

export async function analyzeContentQuality(
  input: AIAnalysisInput,
  providerConfig: AIProviderConfig
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
    const raw = await generateCompletion(prompt, providerConfig);
    return parseAIResponse(raw);
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
  providerConfig: AIProviderConfig
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
    const raw = await generateCompletion(prompt, providerConfig);
    return parseAIResponse(raw);
  } catch {
    return {
      score: 5,
      issues: ['Failed to analyze with AI model'],
      suggestions: [],
    };
  }
}

// ─── Issue-Group Recommendations ───────────────────────────────────────────────

export interface IssueGroupOutput {
  explanation: string;
  fixSuggestions: string[];
}

export async function analyzeIssueGroup(
  issueType: string,
  affectedPages: { url: string; title?: string | null; statusCode?: number | null }[],
  providerConfig: AIProviderConfig
): Promise<IssueGroupOutput> {
  const sampleSize = Math.min(affectedPages.length, 15);
  const samples = affectedPages.slice(0, sampleSize);
  const pageList = samples.map((p, i) =>
    `${i + 1}. ${p.url}${p.title ? ` — title: "${p.title}"` : ''}${p.statusCode ? ` (${p.statusCode})` : ''}`
  ).join('\n');

  const prompt = `You are an expert SEO auditor. A website crawl found ${affectedPages.length} page(s) with this issue: "${issueType.replace(/_/g, ' ')}".

Here are sample affected pages:
${pageList}

Respond with valid JSON only using this exact structure:
{
  "explanation": "<2-3 sentence explanation of why this issue matters for SEO and user experience>",
  "fixSuggestions": ["<actionable fix 1>", "<actionable fix 2>", "<actionable fix 3>"]
}`;

  try {
    const raw = await generateCompletion(prompt, providerConfig);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    const parsed = JSON.parse(jsonMatch[0]) as IssueGroupOutput;
    return {
      explanation: parsed.explanation || 'No explanation provided.',
      fixSuggestions: Array.isArray(parsed.fixSuggestions) ? parsed.fixSuggestions : [],
    };
  } catch {
    return {
      explanation: 'Failed to generate AI recommendation for this issue.',
      fixSuggestions: [],
    };
  }
}
