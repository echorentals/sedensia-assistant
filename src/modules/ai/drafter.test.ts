// src/modules/ai/drafter.test.ts
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

import { draftStatusResponse, draftReorderConfirmation } from './drafter.js';

describe('drafter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('draftStatusResponse', () => {
    it('drafts Korean response for status inquiry', async () => {
      const koreanDraft = '안녕하세요 민석님,\n\n채널 레터 제작 현황 안내드립니다.\n현재 제작 중이며 1월 24일 완료 예정입니다.\n\n감사합니다,\n세덴시아 사인';

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: koreanDraft }],
      });

      const result = await draftStatusResponse({
        language: 'ko',
        recipientName: '민석',
        jobDescription: 'Channel Letters (24"x18")',
        currentStage: 'in_production',
        eta: '2026-01-24',
      });

      expect(result).toContain('민석');
      expect(mockCreate).toHaveBeenCalled();
    });

    it('drafts English response for status inquiry', async () => {
      const englishDraft = 'Hi Minseok,\n\nHere\'s an update on the channel letters.\nCurrently in production, estimated completion Jan 24.\n\nBest regards,\nSedensia Signs';

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: englishDraft }],
      });

      const result = await draftStatusResponse({
        language: 'en',
        recipientName: 'Minseok',
        jobDescription: 'Channel Letters (24"x18")',
        currentStage: 'in_production',
        eta: '2026-01-24',
      });

      expect(result).toContain('Minseok');
    });
  });

  describe('draftReorderConfirmation', () => {
    it('drafts Korean reorder confirmation', async () => {
      const koreanDraft = '안녕하세요 민석님,\n\n재주문 요청 확인드립니다.\n\n감사합니다,\n세덴시아 사인';

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: koreanDraft }],
      });

      const result = await draftReorderConfirmation({
        language: 'ko',
        recipientName: '민석',
        previousOrderDescription: 'Wayfinding Signs (12"x8") x 8',
        previousTotal: 960,
      });

      expect(result).toContain('민석');
    });
  });
});
