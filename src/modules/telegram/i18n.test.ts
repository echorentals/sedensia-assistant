// src/modules/telegram/i18n.test.ts
import { describe, it, expect } from 'vitest';
import { t, formatStatusInquiry, formatReorderRequest, formatNoMatch, formatMultipleMatches } from './i18n.js';

describe('i18n', () => {
  describe('t (translate)', () => {
    it('returns Korean text for ko locale', () => {
      expect(t('ko', 'send')).toBe('보내기');
      expect(t('ko', 'edit')).toBe('수정');
      expect(t('ko', 'ignore')).toBe('무시');
    });

    it('returns English text for en locale', () => {
      expect(t('en', 'send')).toBe('Send');
      expect(t('en', 'edit')).toBe('Edit');
      expect(t('en', 'ignore')).toBe('Ignore');
    });

    it('returns key for unknown translation', () => {
      expect(t('ko', 'unknown_key')).toBe('unknown_key');
    });
  });

  describe('formatStatusInquiry', () => {
    const mockData = {
      company: 'Samsung',
      from: 'Minseok Kim',
      subject: 'Channel Letters Progress',
      jobId: 'abc123def456',
      stage: 'in_production',
      eta: '2026-01-24',
      draftResponse: 'Hi Minseok, the channel letters are in production...',
    };

    it('formats Korean status inquiry message', () => {
      const result = formatStatusInquiry('ko', mockData);
      expect(result).toContain('❓ 상태 문의');
      expect(result).toContain('Samsung');
      expect(result).toContain('발신:');
      expect(result).toContain('제작 중');
    });

    it('formats English status inquiry message', () => {
      const result = formatStatusInquiry('en', mockData);
      expect(result).toContain('❓ Status Inquiry');
      expect(result).toContain('Samsung');
      expect(result).toContain('From:');
      expect(result).toContain('In Production');
    });
  });

  describe('formatReorderRequest', () => {
    const mockData = {
      company: 'Samsung',
      from: 'Minseok Kim',
      originalMessage: 'Can we get the same signs from last month?',
      previousOrderDate: '2025-12-15',
      items: [{ description: 'Wayfinding Signs (12"x8")', quantity: 8, unitPrice: 120, total: 960 }],
      total: 960,
    };

    it('formats Korean reorder message', () => {
      const result = formatReorderRequest('ko', mockData);
      expect(result).toContain('🔄 재주문 요청');
      expect(result).toContain('이전 주문');
      expect(result).toContain('$960');
    });

    it('formats English reorder message', () => {
      const result = formatReorderRequest('en', mockData);
      expect(result).toContain('🔄 Reorder Request');
      expect(result).toContain('Previous Order');
      expect(result).toContain('$960');
    });
  });

  describe('formatNoMatch', () => {
    it('formats Korean no match message', () => {
      const result = formatNoMatch('ko', 'channel letters');
      expect(result).toContain('이전 주문을 찾을 수 없습니다');
    });

    it('formats English no match message', () => {
      const result = formatNoMatch('en', 'channel letters');
      expect(result).toContain('No previous order found');
    });
  });

  describe('formatMultipleMatches', () => {
    const mockData = {
      company: 'Samsung',
      matches: [
        { jobId: 'abc123', description: 'Channel Letters 24"', date: '2026-01-10' },
        { jobId: 'def456', description: 'Wayfinding Signs', date: '2026-01-05' },
      ],
    };

    it('formats Korean multiple matches message', () => {
      const result = formatMultipleMatches('ko', mockData);
      expect(result).toContain('여러 작업이 검색되었습니다');
    });

    it('formats English multiple matches message', () => {
      const result = formatMultipleMatches('en', mockData);
      expect(result).toContain('Multiple jobs found');
    });
  });
});
