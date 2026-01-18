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
  items: z.array(z.object({
    signType: z.string(),
    quantity: z.number(),
    size: z.string(),
    description: z.string().optional(),
  })),
  specialRequests: z.array(z.string()),
  urgency: z.enum(['normal', 'urgent', 'rush']).optional(),
  referencedJobDescription: z.string().optional(),
});

export type ParsedEstimateRequest = z.infer<typeof ParsedEstimateRequestSchema>;

const SYSTEM_PROMPT = `You are an AI assistant that parses estimate request emails for a sign fabrication company.

Extract the following information from the email:
1. Intent: Is this a new estimate request, a status inquiry about an existing job, a reorder of previous signs, an approval of a quote, or a general message?
2. Items: List each sign type requested with quantity and size
3. Special Requests: Any specific requirements like colors (PMS codes), materials, deadlines
4. Urgency: normal, urgent, or rush based on language used
5. Referenced Job: If this is a status inquiry or reorder, what job/sign are they referring to?

Respond with valid JSON matching this schema:
{
  "intent": "new_request" | "status_inquiry" | "reorder" | "approval" | "general",
  "items": [{ "signType": string, "quantity": number, "size": string, "description": string }],
  "specialRequests": string[],
  "urgency": "normal" | "urgent" | "rush",
  "referencedJobDescription": string | null
}`;

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

export async function parseEstimateRequest(email: {
  from: string;
  subject: string;
  body: string;
}): Promise<ParsedEstimateRequest> {
  const userMessage = `From: ${email.from}
Subject: ${email.subject}

${email.body}`;

  try {
    const response = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
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
