import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    QUICKBOOKS_ENVIRONMENT: 'sandbox',
  },
}));

vi.mock('./auth.js', () => ({
  refreshTokenIfNeeded: vi.fn(),
}));

import { refreshTokenIfNeeded } from './auth.js';

describe('QuickBooks Invoice Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = vi.fn();
  });

  it('createInvoiceFromEstimate creates invoice with estimate data', async () => {
    vi.mocked(refreshTokenIfNeeded).mockResolvedValue({
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: new Date(Date.now() + 3600000),
      realmId: 'test-realm',
    });

    const mockEstimate = {
      Estimate: {
        Id: 'est-123',
        CustomerRef: { value: 'cust-1', name: 'Samsung' },
        Line: [
          {
            DetailType: 'SalesItemLineDetail',
            Amount: 1000,
            Description: 'Channel Letters',
            SalesItemLineDetail: { Qty: 2, UnitPrice: 500 },
          },
        ],
        TotalAmt: 1000,
      },
    };

    const mockInvoice = {
      Invoice: {
        Id: 'inv-456',
        DocNumber: 'INV-1001',
        TotalAmt: 1000,
      },
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockEstimate,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInvoice,
      } as Response);

    const { createInvoiceFromEstimate } = await import('./client.js');
    const result = await createInvoiceFromEstimate('est-123');

    expect(result).toBeDefined();
    expect(result?.Id).toBe('inv-456');
  });

  it('createInvoiceFromEstimate returns null when estimate not found', async () => {
    vi.mocked(refreshTokenIfNeeded).mockResolvedValue({
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: new Date(Date.now() + 3600000),
      realmId: 'test-realm',
    });

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    } as Response);

    const { createInvoiceFromEstimate } = await import('./client.js');
    const result = await createInvoiceFromEstimate('non-existent');

    expect(result).toBeNull();
  });

  it('getInvoice returns invoice data', async () => {
    vi.mocked(refreshTokenIfNeeded).mockResolvedValue({
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: new Date(Date.now() + 3600000),
      realmId: 'test-realm',
    });

    const mockInvoice = {
      Invoice: {
        Id: 'inv-456',
        DocNumber: 'INV-1001',
        CustomerRef: { value: 'cust-1', name: 'Samsung' },
        Line: [],
        TotalAmt: 1000,
      },
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInvoice,
    } as Response);

    const { getInvoice } = await import('./client.js');
    const result = await getInvoice('inv-456');

    expect(result).toBeDefined();
    expect(result?.Id).toBe('inv-456');
    expect(result?.DocNumber).toBe('INV-1001');
  });

  it('getInvoicePdf returns PDF buffer', async () => {
    vi.mocked(refreshTokenIfNeeded).mockResolvedValue({
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: new Date(Date.now() + 3600000),
      realmId: 'test-realm',
    });

    const pdfData = Buffer.from('%PDF-1.4 test');

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => pdfData.buffer,
    } as Response);

    const { getInvoicePdf } = await import('./client.js');
    const result = await getInvoicePdf('inv-456');

    expect(result).toBeInstanceOf(Buffer);
  });

  it('getInvoicePdf returns null on error', async () => {
    vi.mocked(refreshTokenIfNeeded).mockResolvedValue({
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: new Date(Date.now() + 3600000),
      realmId: 'test-realm',
    });

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const { getInvoicePdf } = await import('./client.js');
    const result = await getInvoicePdf('non-existent');

    expect(result).toBeNull();
  });

  it('exports createInvoiceFromEstimate function', async () => {
    const client = await import('./client.js');
    expect(client.createInvoiceFromEstimate).toBeDefined();
  });

  it('exports getInvoice function', async () => {
    const client = await import('./client.js');
    expect(client.getInvoice).toBeDefined();
  });

  it('exports getInvoicePdf function', async () => {
    const client = await import('./client.js');
    expect(client.getInvoicePdf).toBeDefined();
  });
});
