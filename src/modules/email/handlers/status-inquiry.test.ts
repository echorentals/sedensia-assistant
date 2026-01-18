// src/modules/email/handlers/status-inquiry.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/index.js', () => ({
  findContactByEmail: vi.fn(),
  getUserLanguage: vi.fn(),
}));

vi.mock('../../jobs/index.js', () => ({
  findMatchingJob: vi.fn(),
  findAllMatchingJobs: vi.fn(),
}));

vi.mock('../../ai/index.js', () => ({
  draftStatusResponse: vi.fn(),
}));

vi.mock('../../telegram/index.js', () => ({
  sendStatusInquiryNotification: vi.fn(),
}));

import { handleStatusInquiry } from './status-inquiry.js';
import { findMatchingJob, findAllMatchingJobs } from '../../jobs/index.js';
import { draftStatusResponse } from '../../ai/index.js';

describe('handleStatusInquiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds matching job and drafts response', async () => {
    const mockJob = {
      job: {
        id: 'job-123',
        description: 'Channel Letters',
        stage: 'in_production',
        eta: '2026-01-24',
        contact_id: 'contact-1',
      },
      confidence: 0.9,
      matchedKeywords: ['channel letters'],
    };

    vi.mocked(findMatchingJob).mockResolvedValue(mockJob as any);
    vi.mocked(draftStatusResponse).mockResolvedValue('안녕하세요...');

    const result = await handleStatusInquiry({
      contact: { id: 'contact-1', name: 'Minseok', email: 'test@test.com', company: 'Samsung', is_active: true, created_at: '' },
      keywords: ['channel letters'],
      emailLanguage: 'ko',
      gmailMessageId: 'msg-123',
      subject: 'Status check',
    });

    expect(result.success).toBe(true);
    expect(result.matchedJob).toBeDefined();
    expect(draftStatusResponse).toHaveBeenCalledWith(expect.objectContaining({
      language: 'ko',
    }));
  });

  it('returns no match when job not found', async () => {
    vi.mocked(findMatchingJob).mockResolvedValue(null);
    vi.mocked(findAllMatchingJobs).mockResolvedValue([]);

    const result = await handleStatusInquiry({
      contact: { id: 'contact-1', name: 'Minseok', email: 'test@test.com', company: 'Samsung', is_active: true, created_at: '' },
      keywords: ['unknown sign'],
      emailLanguage: 'en',
      gmailMessageId: 'msg-123',
      subject: 'Status check',
    });

    expect(result.success).toBe(true);
    expect(result.matchedJob).toBeUndefined();
    expect(result.noMatch).toBe(true);
  });

  it('returns multiple matches when ambiguous', async () => {
    const mockMatches = [
      {
        job: { id: 'job-1', description: 'Sign A', stage: 'pending', contact_id: 'contact-1' },
        confidence: 0.6,
        matchedKeywords: ['sign'],
      },
      {
        job: { id: 'job-2', description: 'Sign B', stage: 'in_production', contact_id: 'contact-1' },
        confidence: 0.5,
        matchedKeywords: ['sign'],
      },
    ];

    vi.mocked(findMatchingJob).mockResolvedValue(null);
    vi.mocked(findAllMatchingJobs).mockResolvedValue(mockMatches as any);

    const result = await handleStatusInquiry({
      contact: { id: 'contact-1', name: 'Minseok', email: 'test@test.com', company: 'Samsung', is_active: true, created_at: '' },
      keywords: ['sign'],
      emailLanguage: 'en',
      gmailMessageId: 'msg-123',
      subject: 'Status check',
    });

    expect(result.success).toBe(true);
    expect(result.multipleMatches).toHaveLength(2);
    expect(result.matchedJob).toBeUndefined();
  });

  it('handles errors gracefully', async () => {
    vi.mocked(findMatchingJob).mockRejectedValue(new Error('Database error'));

    const result = await handleStatusInquiry({
      contact: { id: 'contact-1', name: 'Minseok', email: 'test@test.com', company: 'Samsung', is_active: true, created_at: '' },
      keywords: ['channel letters'],
      emailLanguage: 'ko',
      gmailMessageId: 'msg-123',
      subject: 'Status check',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Database error');
  });
});
