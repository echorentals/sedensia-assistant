import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSingle = vi.fn();
const mockEqChained = vi.fn(() => ({
  single: mockSingle,
}));
const mockEq = vi.fn((): unknown => ({
  eq: mockEqChained,
}));
const mockSelect = vi.fn(() => ({
  eq: mockEq,
}));
const mockFrom = vi.fn(() => ({
  select: mockSelect,
}));

vi.mock('./client.js', () => ({
  supabase: {
    from: mockFrom,
  },
}));

describe('contacts repository', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({
      data: { id: '1', name: 'Test', email: 'test@example.com', company: 'Test Co', is_active: true },
      error: null,
    });
    mockEqChained.mockReturnValue({
      single: mockSingle,
    });
  });

  describe('findContactByEmail', () => {
    it('exports findContactByEmail function', async () => {
      const contacts = await import('./contacts.js');
      expect(contacts.findContactByEmail).toBeDefined();
    });

    it('returns contact when email matches', async () => {
      const { findContactByEmail } = await import('./contacts.js');
      const contact = await findContactByEmail('test@example.com');
      expect(contact).not.toBeNull();
      expect(contact?.email).toBe('test@example.com');
    });

    it('extracts email from "Name <email>" format', async () => {
      const { findContactByEmail } = await import('./contacts.js');
      mockSingle.mockResolvedValue({
        data: { id: '2', name: 'John Doe', email: 'john@example.com', company: null, is_active: true },
        error: null,
      });

      const contact = await findContactByEmail('John Doe <john@example.com>');
      expect(contact).not.toBeNull();
      expect(contact?.email).toBe('john@example.com');
      expect(mockEq).toHaveBeenCalledWith('email', 'john@example.com');
    });

    it('returns null for empty string', async () => {
      const { findContactByEmail } = await import('./contacts.js');
      const contact = await findContactByEmail('');
      expect(contact).toBeNull();
    });

    it('returns null for malformed format like "<>"', async () => {
      const { findContactByEmail } = await import('./contacts.js');
      const contact = await findContactByEmail('<>');
      expect(contact).toBeNull();
    });

    it('returns null and logs error when supabase returns error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const { findContactByEmail } = await import('./contacts.js');
      const contact = await findContactByEmail('error@example.com');

      expect(contact).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to fetch contact:',
        { message: 'Database error' }
      );

      consoleErrorSpy.mockRestore();
    });

    it('returns null when contact not found (no data)', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: null,
      });

      const { findContactByEmail } = await import('./contacts.js');
      const contact = await findContactByEmail('notfound@example.com');

      expect(contact).toBeNull();
    });
  });

  describe('getAllActiveContacts', () => {
    beforeEach(() => {
      // Reset mock for getAllActiveContacts (doesn't use single())
      mockEq.mockReturnValue({
        eq: mockEqChained,
      });
    });

    it('exports getAllActiveContacts function', async () => {
      const contacts = await import('./contacts.js');
      expect(contacts.getAllActiveContacts).toBeDefined();
    });

    it('returns all active contacts', async () => {
      const mockContacts = [
        { id: '1', name: 'Alice', email: 'alice@example.com', company: 'Co A', is_active: true },
        { id: '2', name: 'Bob', email: 'bob@example.com', company: 'Co B', is_active: true },
      ];
      mockEq.mockReturnValue({
        data: mockContacts,
        error: null,
      });

      const { getAllActiveContacts } = await import('./contacts.js');
      const contacts = await getAllActiveContacts();

      expect(contacts).toHaveLength(2);
      expect(contacts[0].name).toBe('Alice');
      expect(contacts[1].name).toBe('Bob');
      expect(mockEq).toHaveBeenCalledWith('is_active', true);
    });

    it('returns empty array when no contacts exist', async () => {
      mockEq.mockReturnValue({
        data: [],
        error: null,
      });

      const { getAllActiveContacts } = await import('./contacts.js');
      const contacts = await getAllActiveContacts();

      expect(contacts).toEqual([]);
    });

    it('returns empty array and logs error when supabase returns error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockEq.mockReturnValue({
        data: null,
        error: { message: 'Connection failed' },
      });

      const { getAllActiveContacts } = await import('./contacts.js');
      const contacts = await getAllActiveContacts();

      expect(contacts).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to fetch active contacts:',
        { message: 'Connection failed' }
      );

      consoleErrorSpy.mockRestore();
    });

    it('returns empty array when data is null (without error)', async () => {
      mockEq.mockReturnValue({
        data: null,
        error: null,
      });

      const { getAllActiveContacts } = await import('./contacts.js');
      const contacts = await getAllActiveContacts();

      expect(contacts).toEqual([]);
    });
  });
});
