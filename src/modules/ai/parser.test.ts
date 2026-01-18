import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the config before importing the parser
vi.mock('../../config/index.js', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-api-key',
  },
}));

// Mock the Anthropic SDK with a proper class constructor
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

// Import after mocks are set up
import {
  parseEstimateRequest,
  extractJsonFromResponse,
  ParsedEstimateRequestSchema,
} from './parser.js';

describe('ai parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractJsonFromResponse', () => {
    it('extracts JSON from markdown code block with json tag', () => {
      const input = '```json\n{"intent": "new_request"}\n```';
      expect(extractJsonFromResponse(input)).toBe('{"intent": "new_request"}');
    });

    it('extracts JSON from markdown code block without json tag', () => {
      const input = '```\n{"intent": "status_inquiry"}\n```';
      expect(extractJsonFromResponse(input)).toBe('{"intent": "status_inquiry"}');
    });

    it('returns trimmed text when no code block present', () => {
      const input = '  {"intent": "general"}  ';
      expect(extractJsonFromResponse(input)).toBe('{"intent": "general"}');
    });

    it('handles multiline JSON in code block', () => {
      const input = '```json\n{\n  "intent": "new_request",\n  "items": []\n}\n```';
      const result = extractJsonFromResponse(input);
      expect(result).toContain('"intent": "new_request"');
      expect(result).toContain('"items": []');
    });
  });

  describe('parseEstimateRequest', () => {
    const mockEmail = {
      from: 'client@example.com',
      subject: 'Need a sign quote',
      body: 'I need 2 channel letter signs, 24x36 inches each.',
    };

    const validResponse = {
      intent: 'new_request' as const,
      items: [
        { signType: 'channel letters', quantity: 2, size: '24x36 inches' },
      ],
      specialRequests: [],
      urgency: 'normal' as const,
    };

    it('successfully parses a valid AI response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(validResponse) }],
      });

      const result = await parseEstimateRequest(mockEmail);

      expect(result.intent).toBe('new_request');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].signType).toBe('channel letters');
      expect(result.items[0].quantity).toBe(2);
    });

    it('parses response wrapped in markdown code block', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '```json\n' + JSON.stringify(validResponse) + '\n```' }],
      });

      const result = await parseEstimateRequest(mockEmail);

      expect(result.intent).toBe('new_request');
      expect(result.items).toHaveLength(1);
    });

    it('throws error when no text content in response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'image', source: {} }],
      });

      await expect(parseEstimateRequest(mockEmail)).rejects.toThrow('No text response from AI');
    });

    it('throws error when response is empty', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [],
      });

      await expect(parseEstimateRequest(mockEmail)).rejects.toThrow('No text response from AI');
    });

    it('throws descriptive error for invalid JSON', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'not valid json {{{' }],
      });

      await expect(parseEstimateRequest(mockEmail)).rejects.toThrow('Failed to parse AI response as JSON');
    });

    it('throws validation error when response does not match schema', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ intent: 'invalid_intent', items: [] }) }],
      });

      await expect(parseEstimateRequest(mockEmail)).rejects.toThrow('AI response validation failed');
    });

    it('throws validation error when required fields are missing', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ intent: 'new_request' }) }],
      });

      await expect(parseEstimateRequest(mockEmail)).rejects.toThrow('AI response validation failed');
    });

    it('throws wrapped error when API call fails', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      await expect(parseEstimateRequest(mockEmail)).rejects.toThrow('AI parsing failed: API rate limit exceeded');
    });

    it('handles response with optional fields', async () => {
      const responseWithOptionals = {
        intent: 'status_inquiry' as const,
        items: [],
        specialRequests: ['Need update on order'],
        urgency: 'urgent' as const,
        referencedJobDescription: 'The channel letter sign from last month',
      };

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(responseWithOptionals) }],
      });

      const result = await parseEstimateRequest(mockEmail);

      expect(result.intent).toBe('status_inquiry');
      expect(result.urgency).toBe('urgent');
      expect(result.referencedJobDescription).toBe('The channel letter sign from last month');
    });

    it('handles all valid intent types', async () => {
      const intents = ['new_request', 'status_inquiry', 'reorder', 'approval', 'general'] as const;

      for (const intent of intents) {
        mockCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: JSON.stringify({ intent, items: [], specialRequests: [] }) }],
        });

        const result = await parseEstimateRequest(mockEmail);
        expect(result.intent).toBe(intent);
      }
    });
  });

  describe('ParsedEstimateRequestSchema', () => {
    it('validates correct schema structure', () => {
      const validData = {
        intent: 'new_request',
        items: [{ signType: 'banner', quantity: 1, size: '3x6 feet' }],
        specialRequests: ['PMS 185 red'],
      };

      const result = ParsedEstimateRequestSchema.parse(validData);
      expect(result).toEqual(validData);
    });

    it('rejects invalid intent values', () => {
      const invalidData = {
        intent: 'unknown_intent',
        items: [],
        specialRequests: [],
      };

      expect(() => ParsedEstimateRequestSchema.parse(invalidData)).toThrow();
    });

    it('rejects non-numeric quantity', () => {
      const invalidData = {
        intent: 'new_request',
        items: [{ signType: 'banner', quantity: 'two', size: '3x6' }],
        specialRequests: [],
      };

      expect(() => ParsedEstimateRequestSchema.parse(invalidData)).toThrow();
    });
  });
});
