import { env } from '../../config/index.js';
import { refreshTokenIfNeeded } from './auth.js';
import type { QuickBooksTokens } from './tokens.js';

const SANDBOX_BASE_URL = 'https://sandbox-quickbooks.api.intuit.com/v3/company';
const PRODUCTION_BASE_URL = 'https://quickbooks.api.intuit.com/v3/company';

export function getBaseUrl(): string {
  return env.QUICKBOOKS_ENVIRONMENT === 'production'
    ? PRODUCTION_BASE_URL
    : SANDBOX_BASE_URL;
}

export interface QuickBooksClient {
  tokens: QuickBooksTokens;
  baseUrl: string;
}

export async function getQuickBooksClient(): Promise<QuickBooksClient | null> {
  const tokens = await refreshTokenIfNeeded();
  if (!tokens) return null;

  return {
    tokens,
    baseUrl: `${getBaseUrl()}/${tokens.realmId}`,
  };
}

async function qbRequest<T>(
  client: QuickBooksClient,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${client.baseUrl}${endpoint}`, {
    ...options,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${client.tokens.accessToken}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`QuickBooks API error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Estimate types
export interface QBLineItem {
  DetailType: 'SalesItemLineDetail';
  Amount: number;
  Description: string;
  SalesItemLineDetail: {
    Qty: number;
    UnitPrice: number;
  };
}

export interface QBEstimate {
  Id?: string;
  DocNumber?: string;
  CustomerRef: { value: string; name?: string };
  Line: QBLineItem[];
  TotalAmt?: number;
  TxnDate?: string;
  EmailStatus?: string;
  CustomerMemo?: { value: string };
}

export interface CreateEstimateInput {
  customerId: string;
  customerName?: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  memo?: string;
}

export async function createEstimate(input: CreateEstimateInput): Promise<QBEstimate> {
  const client = await getQuickBooksClient();
  if (!client) throw new Error('QuickBooks client not available');

  const lines: QBLineItem[] = input.lines.map(line => ({
    DetailType: 'SalesItemLineDetail',
    Amount: line.quantity * line.unitPrice,
    Description: line.description,
    SalesItemLineDetail: {
      Qty: line.quantity,
      UnitPrice: line.unitPrice,
    },
  }));

  const estimate: QBEstimate = {
    CustomerRef: {
      value: input.customerId,
      name: input.customerName,
    },
    Line: lines,
    EmailStatus: 'NotSent',
  };

  if (input.memo) {
    estimate.CustomerMemo = { value: input.memo };
  }

  const result = await qbRequest<{ Estimate: QBEstimate }>(
    client,
    '/estimate',
    {
      method: 'POST',
      body: JSON.stringify(estimate),
    }
  );

  return result.Estimate;
}

export async function getEstimates(maxResults = 100): Promise<QBEstimate[]> {
  const client = await getQuickBooksClient();
  if (!client) return [];

  const query = `SELECT * FROM Estimate MAXRESULTS ${maxResults}`;
  const result = await qbRequest<{ QueryResponse: { Estimate?: QBEstimate[] } }>(
    client,
    `/query?query=${encodeURIComponent(query)}`
  );

  return result.QueryResponse.Estimate || [];
}

export async function getEstimate(estimateId: string): Promise<QBEstimate | null> {
  const client = await getQuickBooksClient();
  if (!client) return null;

  try {
    const result = await qbRequest<{ Estimate: QBEstimate }>(
      client,
      `/estimate/${estimateId}`
    );
    return result.Estimate;
  } catch {
    return null;
  }
}

export interface QBCustomer {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address: string };
}

export async function getCustomers(): Promise<QBCustomer[]> {
  const client = await getQuickBooksClient();
  if (!client) return [];

  const query = 'SELECT * FROM Customer MAXRESULTS 1000';
  const result = await qbRequest<{ QueryResponse: { Customer?: QBCustomer[] } }>(
    client,
    `/query?query=${encodeURIComponent(query)}`
  );

  return result.QueryResponse.Customer || [];
}

export async function findCustomerByName(name: string): Promise<QBCustomer | null> {
  const client = await getQuickBooksClient();
  if (!client) return null;

  const query = `SELECT * FROM Customer WHERE DisplayName LIKE '%${name}%'`;
  const result = await qbRequest<{ QueryResponse: { Customer?: QBCustomer[] } }>(
    client,
    `/query?query=${encodeURIComponent(query)}`
  );

  return result.QueryResponse.Customer?.[0] || null;
}

// Invoice types
export interface QBInvoice {
  Id?: string;
  DocNumber?: string;
  CustomerRef: { value: string; name?: string };
  Line: QBLineItem[];
  TotalAmt?: number;
  TxnDate?: string;
  EmailStatus?: string;
  LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
}

export async function createInvoiceFromEstimate(estimateId: string): Promise<QBInvoice | null> {
  const client = await getQuickBooksClient();
  if (!client) return null;

  try {
    // Fetch the estimate
    const estimate = await getEstimate(estimateId);
    if (!estimate) {
      console.error('Estimate not found:', estimateId);
      return null;
    }

    // Create invoice with same data
    const invoice: QBInvoice = {
      CustomerRef: estimate.CustomerRef,
      Line: estimate.Line,
      LinkedTxn: [{ TxnId: estimateId, TxnType: 'Estimate' }],
    };

    const result = await qbRequest<{ Invoice: QBInvoice }>(
      client,
      '/invoice',
      {
        method: 'POST',
        body: JSON.stringify(invoice),
      }
    );

    return result.Invoice;
  } catch (error) {
    console.error('Failed to create invoice from estimate:', error);
    return null;
  }
}

export async function getInvoice(invoiceId: string): Promise<QBInvoice | null> {
  const client = await getQuickBooksClient();
  if (!client) return null;

  try {
    const result = await qbRequest<{ Invoice: QBInvoice }>(
      client,
      `/invoice/${invoiceId}`
    );
    return result.Invoice;
  } catch {
    return null;
  }
}

export async function getInvoicePdf(invoiceId: string): Promise<Buffer | null> {
  const client = await getQuickBooksClient();
  if (!client) return null;

  try {
    const response = await fetch(
      `${client.baseUrl}/invoice/${invoiceId}/pdf`,
      {
        headers: {
          'Accept': 'application/pdf',
          'Authorization': `Bearer ${client.tokens.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      console.error('Failed to get invoice PDF:', response.status);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('Failed to get invoice PDF:', error);
    return null;
  }
}
