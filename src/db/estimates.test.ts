import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEstimate = {
  id: 'est-123',
  contact_id: 'contact-123',
  gmail_message_id: 'gmail-123',
  quickbooks_estimate_id: 'qb-123',
  status: 'draft',
  total_amount: 1500,
  items: [{ description: 'Test Sign', quantity: 1, unitPrice: 1500 }],
};

vi.mock('./client.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: mockEstimate, error: null })),
        })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: mockEstimate, error: null })),
          order: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve({ data: [mockEstimate], error: null })),
          })),
        })),
        order: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: [mockEstimate], error: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: mockEstimate, error: null })),
      })),
    })),
  },
}));

describe('estimates repository', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports createEstimate function', async () => {
    const estimates = await import('./estimates.js');
    expect(estimates.createEstimate).toBeDefined();
  });

  it('exports getEstimateById function', async () => {
    const estimates = await import('./estimates.js');
    expect(estimates.getEstimateById).toBeDefined();
  });

  it('exports updateEstimateStatus function', async () => {
    const estimates = await import('./estimates.js');
    expect(estimates.updateEstimateStatus).toBeDefined();
  });

  it('exports getRecentEstimates function', async () => {
    const estimates = await import('./estimates.js');
    expect(estimates.getRecentEstimates).toBeDefined();
  });
});
