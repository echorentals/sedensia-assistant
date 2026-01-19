// src/modules/ai/drafter.completion.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-api-key',
  },
}));

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
      };
    },
  };
});

import { draftCompletionEmail } from './drafter.js';

describe('draftCompletionEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drafts English completion email', async () => {
    const englishDraft =
      'Dear Minseok,\n\nWe are pleased to inform you that your Channel Letters for Taylor Facility project has been completed and delivered.\n\nPlease find attached invoice INV-1042 for the total amount of $4,936.20. Payment terms are Net 30.\n\nThank you for your business. We look forward to working with you again.\n\nBest regards,\nSedensia Signs';

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: englishDraft }],
    });

    const result = await draftCompletionEmail({
      contactName: 'Minseok',
      companyName: 'Samsung',
      jobDescription: 'Channel Letters for Taylor Facility',
      invoiceNumber: 'INV-1042',
      invoiceTotal: 4936.2,
      language: 'en',
    });

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(mockCreate).toHaveBeenCalledOnce();

    // Verify the call includes correct language context
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain('English');
  });

  it('drafts Korean completion email', async () => {
    const koreanDraft =
      '민석님께,\n\n삼성 Taylor Facility용 Channel Letters 프로젝트가 완료되어 배송되었음을 알려드립니다.\n\n첨부된 청구서 INV-1042를 확인해 주세요. 총 금액은 $4,936.20이며, 결제 조건은 Net 30입니다.\n\n감사합니다.\n\n세덴시아 사인';

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: koreanDraft }],
    });

    const result = await draftCompletionEmail({
      contactName: '민석',
      companyName: 'Samsung',
      jobDescription: 'Channel Letters',
      invoiceNumber: 'INV-1042',
      invoiceTotal: 4936.2,
      language: 'ko',
    });

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);

    // Verify the call includes correct language context
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain('한국어');
  });

  it('throws error when no text response from AI', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: '123', name: 'test', input: {} }],
    });

    await expect(
      draftCompletionEmail({
        contactName: 'Minseok',
        companyName: 'Samsung',
        jobDescription: 'Channel Letters',
        invoiceNumber: 'INV-1042',
        invoiceTotal: 4936.2,
        language: 'en',
      })
    ).rejects.toThrow('No text response from AI');
  });
});
