/**
 * media.ts — Image (and future video/audio) generation tools for AitherOS agents.
 *
 * Reads provider config from env vars injected by the orchestrator:
 *   AITHER_IMAGE_API_KEY     — API key for the image provider
 *   AITHER_IMAGE_BASE_URL    — Base URL of the provider
 *   AITHER_IMAGE_MODEL       — Default image model (e.g. imagen-4.0-generate-001)
 *   AITHER_IMAGE_PROVIDER    — Provider type: google | openai | openai_compatible | fal
 *
 * Supported provider formats:
 *   google            — Google AI Studio Imagen API (generativelanguage.googleapis.com)
 *   openai            — OpenAI DALL-E (/v1/images/generations)
 *   openai_compatible — Any OpenAI-compatible image endpoint
 *   fal               — fal.ai (fal.run)
 */

import fs   from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import http  from 'node:http';
import { WORKSPACE } from '../config.js';

const IMAGE_API_KEY  = process.env.AITHER_IMAGE_API_KEY  ?? '';
const IMAGE_BASE_URL = process.env.AITHER_IMAGE_BASE_URL ?? '';
const IMAGE_MODEL    = process.env.AITHER_IMAGE_MODEL    ?? '';
const IMAGE_PROVIDER = process.env.AITHER_IMAGE_PROVIDER ?? '';

// ── HTTP helper ───────────────────────────────────────────────────────────────

function httpPost(url: string, headers: Record<string, string>, body: string, timeoutMs = 60000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(
      { hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search, method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('image generation request timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpGet(url: string, headers: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(
      { hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search, method: 'GET', headers },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(httpGet(res.headers.location, headers));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ── Provider implementations ──────────────────────────────────────────────────

type ImageResult = { imageBuffer: Buffer; mimeType: string };

async function generateGoogle(apiKey: string, baseUrl: string, model: string, prompt: string, aspectRatio: string): Promise<ImageResult> {
  // Strip /openai suffix if present (that's the chat endpoint, not Imagen)
  const cleanBase = baseUrl.replace(/\/openai\/?$/, '').replace(/\/$/, '');
  const url = `${cleanBase}/models/${model}:generateImages?key=${apiKey}`;

  const body = JSON.stringify({
    prompt,
    number_of_images: 1,
    aspect_ratio: aspectRatio,
    safetyFilterLevel: 'BLOCK_ONLY_HIGH',
    personGeneration: 'DONT_ALLOW',
  });

  const res = await httpPost(url, { 'Content-Type': 'application/json' }, body);
  if (res.status !== 200) {
    throw new Error(`Google Imagen API error ${res.status}: ${res.body.slice(0, 400)}`);
  }

  const data = JSON.parse(res.body);
  const images: any[] = data.generatedImages ?? [];
  if (images.length === 0) {
    throw new Error(`Google Imagen returned no images. Response: ${res.body.slice(0, 400)}`);
  }
  if (images[0].raiFilteredReason) {
    throw new Error(`Google Imagen content filtered: ${images[0].raiFilteredReason}. Rephrase the prompt.`);
  }

  const b64 = images[0]?.image?.imageBytes;
  if (!b64) throw new Error(`Google Imagen: missing imageBytes in response`);
  return { imageBuffer: Buffer.from(b64, 'base64'), mimeType: 'image/png' };
}

async function generateOpenAI(apiKey: string, baseUrl: string, model: string, prompt: string, size: string): Promise<ImageResult> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/v1/images/generations`;

  const body = JSON.stringify({ model, prompt, n: 1, size, response_format: 'b64_json' });
  const res = await httpPost(url, {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  }, body);

  if (res.status !== 200) {
    throw new Error(`OpenAI images API error ${res.status}: ${res.body.slice(0, 400)}`);
  }

  const data = JSON.parse(res.body);
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    // Some providers return a URL instead — download it
    const imageUrl = data?.data?.[0]?.url;
    if (imageUrl) {
      const buf = await httpGet(imageUrl, {});
      return { imageBuffer: buf, mimeType: 'image/png' };
    }
    throw new Error(`OpenAI images API: no b64_json or url in response`);
  }
  return { imageBuffer: Buffer.from(b64, 'base64'), mimeType: 'image/png' };
}

async function generateFal(apiKey: string, model: string, prompt: string, imageSize: string): Promise<ImageResult> {
  const url = `https://fal.run/${model}`;
  const body = JSON.stringify({ prompt, image_size: imageSize, num_images: 1 });
  const res = await httpPost(url, {
    'Content-Type': 'application/json',
    'Authorization': `Key ${apiKey}`,
  }, body, 90000);

  if (res.status !== 200) {
    throw new Error(`fal.ai error ${res.status}: ${res.body.slice(0, 400)}`);
  }

  const data = JSON.parse(res.body);
  const imageUrl = data?.images?.[0]?.url;
  if (!imageUrl) throw new Error(`fal.ai: no image URL in response`);
  const buf = await httpGet(imageUrl, {});
  return { imageBuffer: buf, mimeType: 'image/png' };
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const tools = [
  {
    name: 'generate_image',
    description:
      'Generate an image using the workforce image model (configured by the operator). ' +
      'Saves the result as a PNG file in the workspace and returns the file path. ' +
      'Use this to create visual assets, illustrations, diagrams, or any image content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt:       { type: 'string', description: 'Detailed text description of the image to generate' },
        output_path:  { type: 'string', description: 'Where to save the PNG (relative to workspace, e.g. "assets/hero.png")' },
        aspect_ratio: { type: 'string', description: 'Aspect ratio: "1:1" (default), "16:9", "9:16", "4:3", "3:4"' },
        model:        { type: 'string', description: 'Override the default image model' },
        negative_prompt: { type: 'string', description: 'What to exclude from the image (not all providers support this)' },
      },
      required: ['prompt', 'output_path'],
    },
  },
  {
    name: 'image_provider_status',
    description: 'Check whether an image generation provider is configured for this workforce and what model is available.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

function resolveSize(aspectRatio: string): { openaiSize: string; falSize: string } {
  switch (aspectRatio) {
    case '16:9': return { openaiSize: '1792x1024', falSize: 'landscape_16_9' };
    case '9:16': return { openaiSize: '1024x1792', falSize: 'portrait_16_9' };
    case '4:3':  return { openaiSize: '1024x768',  falSize: 'landscape_4_3' };
    case '3:4':  return { openaiSize: '768x1024',  falSize: 'portrait_4_3' };
    default:     return { openaiSize: '1024x1024', falSize: 'square_hd' };
  }
}

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {

  async generate_image(args) {
    const apiKey  = IMAGE_API_KEY;
    const baseUrl = IMAGE_BASE_URL;
    const model   = (args.model as string | undefined) || IMAGE_MODEL;
    const provider = IMAGE_PROVIDER;

    if (!apiKey || !model) {
      return [
        'ERROR: No image provider configured for this workforce.',
        'The operator must add an image-capable model to a provider and assign it to an agent in this workforce.',
        '',
        `Current config: AITHER_IMAGE_PROVIDER="${provider}" AITHER_IMAGE_MODEL="${model}" AITHER_IMAGE_API_KEY="${apiKey ? '***set***' : 'NOT SET'}"`,
      ].join('\n');
    }

    const prompt      = args.prompt as string;
    const outputPath  = args.output_path as string;
    const aspectRatio = (args.aspect_ratio as string | undefined) || '1:1';
    const { openaiSize, falSize } = resolveSize(aspectRatio);

    // Resolve output path relative to workspace
    const absPath = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(WORKSPACE, outputPath);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(absPath), { recursive: true });

    let result: ImageResult;
    const isGoogle = provider === 'google' || baseUrl.includes('googleapis.com');
    const isFal    = provider === 'fal' || baseUrl.includes('fal.run') || baseUrl.includes('fal.ai');

    try {
      if (isGoogle) {
        result = await generateGoogle(apiKey, baseUrl || 'https://generativelanguage.googleapis.com/v1beta', model, prompt, aspectRatio);
      } else if (isFal) {
        result = await generateFal(apiKey, model, prompt, falSize);
      } else {
        // OpenAI / openai_compatible
        result = await generateOpenAI(apiKey, baseUrl || 'https://api.openai.com', model, prompt, openaiSize);
      }
    } catch (err: any) {
      return `ERROR generating image: ${err.message}`;
    }

    await fs.writeFile(absPath, result.imageBuffer);
    const stat = await fs.stat(absPath);
    const kb = (stat.size / 1024).toFixed(1);
    const rel = path.relative(WORKSPACE, absPath);

    return [
      `Image saved successfully.`,
      `Path: ${rel}`,
      `Size: ${kb} KB`,
      `Model: ${model}`,
      `Provider: ${isGoogle ? 'Google Imagen' : isFal ? 'fal.ai' : 'OpenAI-compatible'}`,
      `Prompt: ${prompt.slice(0, 120)}${prompt.length > 120 ? '...' : ''}`,
    ].join('\n');
  },

  async image_provider_status(_args) {
    if (!IMAGE_API_KEY || !IMAGE_MODEL) {
      return [
        'No image provider configured for this workforce.',
        'To enable image generation:',
        '  1. In Providers settings, add a model with type "image" to your provider',
        '  2. Assign that provider to at least one agent in this workforce',
        '  3. Re-run the execution — the orchestrator will inject image credentials automatically',
      ].join('\n');
    }
    return [
      'Image provider: READY',
      `Provider type: ${IMAGE_PROVIDER || 'unknown'}`,
      `Base URL: ${IMAGE_BASE_URL || '(default for provider)'}`,
      `Default model: ${IMAGE_MODEL}`,
      `API key: configured`,
    ].join('\n');
  },
};
