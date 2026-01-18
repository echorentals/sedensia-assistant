// src/modules/ai/drafter.ts
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/index.js';

let client: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

const STAGE_NAMES_KO: Record<string, string> = {
  pending: '대기 중',
  in_production: '제작 중',
  ready: '완료 (배송 대기)',
  installed: '설치 완료',
  completed: '완료',
};

const STAGE_NAMES_EN: Record<string, string> = {
  pending: 'Pending',
  in_production: 'In Production',
  ready: 'Ready for Delivery',
  installed: 'Installed',
  completed: 'Completed',
};

export interface StatusResponseInput {
  language: 'ko' | 'en';
  recipientName: string;
  jobDescription: string;
  currentStage: string;
  eta?: string | null;
}

export async function draftStatusResponse(input: StatusResponseInput): Promise<string> {
  const stageName = input.language === 'ko'
    ? STAGE_NAMES_KO[input.currentStage] || input.currentStage
    : STAGE_NAMES_EN[input.currentStage] || input.currentStage;

  const etaText = input.eta
    ? input.language === 'ko'
      ? `예상 완료일: ${input.eta}`
      : `Estimated completion: ${input.eta}`
    : '';

  const systemPrompt = input.language === 'ko'
    ? `You are writing a professional status update email in Korean for a sign fabrication company (세덴시아 사인).
Keep it concise and polite. Use formal Korean (존댓말).
Sign off with "감사합니다,\n세덴시아 사인"`
    : `You are writing a professional status update email in English for a sign fabrication company (Sedensia Signs).
Keep it concise and professional.
Sign off with "Best regards,\nSedensia Signs"`;

  const userMessage = input.language === 'ko'
    ? `Write a brief status update email to ${input.recipientName} about their order:
Job: ${input.jobDescription}
Status: ${stageName}
${etaText}

Keep it to 3-4 sentences maximum.`
    : `Write a brief status update email to ${input.recipientName} about their order:
Job: ${input.jobDescription}
Status: ${stageName}
${etaText}

Keep it to 3-4 sentences maximum.`;

  const response = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  return textContent.text.trim();
}

export interface ReorderResponseInput {
  language: 'ko' | 'en';
  recipientName: string;
  previousOrderDescription: string;
  previousTotal: number;
}

export async function draftReorderConfirmation(input: ReorderResponseInput): Promise<string> {
  const systemPrompt = input.language === 'ko'
    ? `You are writing a professional email in Korean for a sign fabrication company (세덴시아 사인).
Keep it concise and polite. Use formal Korean (존댓말).
Sign off with "감사합니다,\n세덴시아 사인"`
    : `You are writing a professional email in English for a sign fabrication company (Sedensia Signs).
Keep it concise and professional.
Sign off with "Best regards,\nSedensia Signs"`;

  const userMessage = input.language === 'ko'
    ? `Write a brief email to ${input.recipientName} confirming we received their reorder request:
Previous order: ${input.previousOrderDescription}
Previous total: $${input.previousTotal.toLocaleString()}

Ask them to confirm they want the same items at the same price. Keep it to 3-4 sentences.`
    : `Write a brief email to ${input.recipientName} confirming we received their reorder request:
Previous order: ${input.previousOrderDescription}
Previous total: $${input.previousTotal.toLocaleString()}

Ask them to confirm they want the same items at the same price. Keep it to 3-4 sentences.`;

  const response = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  return textContent.text.trim();
}
