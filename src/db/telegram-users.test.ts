import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(),
      })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
    })),
  },
}));

import { getTelegramUser, upsertTelegramUser, setUserLanguage } from './telegram-users.js';
import { supabase } from './client.js';

describe('telegram-users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTelegramUser', () => {
    it('returns user when found', async () => {
      const mockUser = {
        id: 'uuid-123',
        telegram_id: '12345',
        name: 'Patrick',
        language: 'en',
        created_at: '2026-01-18T00:00:00Z',
        updated_at: '2026-01-18T00:00:00Z',
      };

      const mockSingle = vi.fn().mockResolvedValue({ data: mockUser, error: null });
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as any);

      const result = await getTelegramUser('12345');

      expect(result).toEqual(mockUser);
      expect(supabase.from).toHaveBeenCalledWith('telegram_users');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('telegram_id', '12345');
    });

    it('returns null when user not found', async () => {
      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as any);

      const result = await getTelegramUser('99999');

      expect(result).toBeNull();
    });
  });

  describe('upsertTelegramUser', () => {
    it('creates new user with default Korean language', async () => {
      const mockUser = {
        id: 'uuid-123',
        telegram_id: '12345',
        name: 'Test User',
        language: 'ko',
        created_at: '2026-01-18T00:00:00Z',
        updated_at: '2026-01-18T00:00:00Z',
      };

      const mockSingle = vi.fn().mockResolvedValue({ data: mockUser, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect });
      vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as any);

      const result = await upsertTelegramUser('12345', 'Test User');

      expect(result).toEqual(mockUser);
      expect(mockUpsert).toHaveBeenCalledWith(
        { telegram_id: '12345', name: 'Test User', updated_at: expect.any(String) },
        { onConflict: 'telegram_id' }
      );
    });
  });

  describe('setUserLanguage', () => {
    it('updates user language preference', async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as any);

      const result = await setUserLanguage('12345', 'en');

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        language: 'en',
        updated_at: expect.any(String),
      });
      expect(mockEq).toHaveBeenCalledWith('telegram_id', '12345');
    });
  });
});
