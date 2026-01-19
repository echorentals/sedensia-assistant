import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../../config/index.js';

// Lazy initialization pattern for Anthropic client
let client: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

export const ParsedEstimateRequestSchema = z.object({
  intent: z.enum(['new_request', 'status_inquiry', 'reorder', 'approval', 'general']),
  language: z.enum(['ko', 'en']).default('en'),
  items: z.array(z.object({
    signType: z.string(),
    quantity: z.number(),
    size: z.string().nullish(),
    material: z.string().nullish(),
    description: z.string().nullish(),
  })),
  specialRequests: z.array(z.string()),
  urgency: z.enum(['normal', 'urgent', 'rush']).nullish(),
  referencedJobDescription: z.string().nullish(),
  keywords: z.array(z.string()).default([]),
  hasImages: z.boolean().default(false),
  imageAnalysisNotes: z.string().nullish(),
});

export type ParsedEstimateRequest = z.infer<typeof ParsedEstimateRequestSchema>;

// Image input for parsing
export interface ParseImage {
  mimeType: string;
  data: Buffer;
}

const SYSTEM_PROMPT = `You are an AI assistant that parses estimate request emails for a sign fabrication company.

Extract the following information from the email and any attached images:
1. Intent: Is this a new estimate request, a status inquiry about an existing job, a reorder of previous signs, an approval of a quote, or a general message?
2. Language: Detect the primary language of the email - "ko" for Korean, "en" for English
3. Items: List each sign type requested with quantity, size, and material if mentioned
4. Special Requests: Any specific requirements like colors (PMS codes), deadlines, installation needs
5. Urgency: normal, urgent, or rush based on language used
6. Referenced Job: If this is a status inquiry or reorder, what job/sign are they referring to?
7. Keywords: Extract key search terms that could identify a specific job (e.g., "channel letters", "Taylor facility", "wayfinding signs")
8. Image Analysis: If images are provided, carefully examine them for:
   - Sign dimensions (width x height)
   - Quantities shown in diagrams or tables
   - Sign types visible in photos or drawings
   - Any text, measurements, or specifications visible

IMPORTANT: When images contain dimensions or specifications, these MUST be reflected in the items array. Image-derived dimensions take priority over any assumptions. For example, if an image shows "6ft x 2.25ft", the item size should be "72" x 27"" or "6ft x 2.25ft", not a default size.

Common sign types: ACM polymetal signs, PVC signs, corrugated plastic signs, vinyl banners, A-Frame, x-frame Standing Sign, large format vinyl banners, magnetic signs.

Common materials: ACM polymetal, magnetic sheets, vinyl banners, PVC, corrugated plastic

Respond with valid JSON matching this schema:
{
  "intent": "new_request" | "status_inquiry" | "reorder" | "approval" | "general",
  "language": "ko" | "en",
  "items": [{ "signType": string, "quantity": number, "size": string, "material": string | null, "description": string | null }],
  "specialRequests": string[],
  "urgency": "normal" | "urgent" | "rush" | null,
  "referencedJobDescription": string | null,
  "keywords": string[],
  "hasImages": boolean,
  "imageAnalysisNotes": string | null
}

If images contain information you cannot clearly read or interpret, set imageAnalysisNotes to describe what you see and what details are unclear.`;

/**
 * Extracts JSON from a response string, handling markdown code blocks.
 * @internal Exported for testing purposes only.
 */
export function extractJsonFromResponse(text: string): string {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  return text.trim();
}

// Map MIME types to Anthropic's expected media types
type AnthropicMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function toAnthropicMediaType(mimeType: string): AnthropicMediaType | null {
  const mapping: Record<string, AnthropicMediaType> = {
    'image/jpeg': 'image/jpeg',
    'image/png': 'image/png',
    'image/gif': 'image/gif',
    'image/webp': 'image/webp',
    'image/bmp': 'image/png', // Convert BMP to PNG for Anthropic
  };
  return mapping[mimeType] || null;
}

export async function parseEstimateRequest(email: {
  from: string;
  subject: string;
  body: string;
  images?: ParseImage[];
}): Promise<ParsedEstimateRequest> {
  const textMessage = `From: ${email.from}
Subject: ${email.subject}

${email.body}`;

  // Build message content array
  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

  // Add images first if present
  if (email.images && email.images.length > 0) {
    content.push({
      type: 'text',
      text: `This email includes ${email.images.length} image attachment(s). Please analyze them for sign specifications, dimensions, and quantities.`,
    });

    for (const image of email.images) {
      const mediaType = toAnthropicMediaType(image.mimeType);
      if (mediaType) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: image.data.toString('base64'),
          },
        });
      }
    }
  }

  // Add the email text
  content.push({
    type: 'text',
    text: textMessage,
  });

  try {
    const response = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from AI');
    }

    const jsonStr = extractJsonFromResponse(textContent.text);
    const parsed = JSON.parse(jsonStr);
    return ParsedEstimateRequestSchema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`AI response validation failed: ${error.message}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error('Failed to parse AI response as JSON');
    }
    if (error instanceof Error && error.message === 'No text response from AI') {
      throw error;
    }
    throw new Error(`AI parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
