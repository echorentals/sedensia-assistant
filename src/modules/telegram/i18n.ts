// src/modules/telegram/i18n.ts

type Locale = 'ko' | 'en';

const translations: Record<string, Record<Locale, string>> = {
  // Buttons
  send: { ko: '보내기', en: 'Send' },
  edit: { ko: '수정', en: 'Edit' },
  ignore: { ko: '무시', en: 'Ignore' },
  createEstimateSamePrice: { ko: '동일 가격으로 견적 생성', en: 'Create Estimate (Same Price)' },
  editPrices: { ko: '가격 수정', en: 'Edit Prices' },
  select: { ko: '선택', en: 'Select' },
  newEstimate: { ko: '새 견적으로 처리', en: 'Treat as New Estimate' },
  manualSearch: { ko: '수동 검색', en: 'Manual Search' },

  // Labels
  statusInquiry: { ko: '상태 문의', en: 'Status Inquiry' },
  reorderRequest: { ko: '재주문 요청', en: 'Reorder Request' },
  from: { ko: '발신', en: 'From' },
  subject: { ko: '제목', en: 'Subject' },
  matchedJob: { ko: '매칭된 작업', en: 'Matched Job' },
  currentStage: { ko: '현재 단계', en: 'Current Stage' },
  eta: { ko: '예상 완료', en: 'ETA' },
  draftResponse: { ko: '답변 초안', en: 'Draft Response' },
  previousOrder: { ko: '이전 주문', en: 'Previous Order' },
  unitPrice: { ko: '단가', en: 'Unit Price' },
  total: { ko: '총액', en: 'Total' },
  noMatchFound: { ko: '이전 주문을 찾을 수 없습니다', en: 'No previous order found' },
  multipleMatches: { ko: '여러 작업이 검색되었습니다', en: 'Multiple jobs found' },

  // Stages
  pending: { ko: '대기 중', en: 'Pending' },
  in_production: { ko: '제작 중', en: 'In Production' },
  ready: { ko: '완료 (배송 대기)', en: 'Ready for Delivery' },
  installed: { ko: '설치 완료', en: 'Installed' },
  completed: { ko: '완료', en: 'Completed' },

  // Completion notification
  jobComplete: { ko: '작업 완료', en: 'Job Complete' },
  invoiceAttached: { ko: '청구서 첨부됨', en: 'Invoice Attached' },
  sendEmail: { ko: '이메일 발송', en: 'Send Email' },
  skipInvoice: { ko: '청구서 건너뛰기', en: 'Skip Invoice' },

  // Language command
  languageSet: { ko: '언어가 한국어로 설정되었습니다.\n모든 알림이 한국어로 표시됩니다.', en: 'Language set to English.\nAll notifications will now be in English.' },
};

export function t(locale: Locale, key: string): string {
  return translations[key]?.[locale] || translations[key]?.['en'] || key;
}

export interface StatusInquiryData {
  company: string;
  from: string;
  subject: string;
  jobId: string;
  stage: string;
  eta?: string | null;
  draftResponse: string;
}

export function formatStatusInquiry(locale: Locale, data: StatusInquiryData): string {
  const stageName = t(locale, data.stage);
  const etaLine = data.eta ? `${t(locale, 'eta')}: ${data.eta}` : '';

  return `❓ ${t(locale, 'statusInquiry')} - ${data.company}

${t(locale, 'from')}: ${data.from}
${t(locale, 'subject')}: ${data.subject}

${t(locale, 'matchedJob')}: #${data.jobId.slice(0, 8)}
${t(locale, 'currentStage')}: ${stageName}
${etaLine}

━━━━━━━━━━━━━━━━━━
📝 ${t(locale, 'draftResponse')}:
"${data.draftResponse.slice(0, 150)}${data.draftResponse.length > 150 ? '...' : ''}"`;
}

export interface ReorderRequestData {
  company: string;
  from: string;
  originalMessage: string;
  previousOrderDate: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  total: number;
}

export function formatReorderRequest(locale: Locale, data: ReorderRequestData): string {
  const itemsList = data.items
    .map(item => `• ${item.description} × ${item.quantity} ... $${item.total.toLocaleString()}\n  ${t(locale, 'unitPrice')}: $${item.unitPrice.toLocaleString()}`)
    .join('\n');

  return `🔄 ${t(locale, 'reorderRequest')} - ${data.company}

${t(locale, 'from')}: ${data.from}
"${data.originalMessage}"

━━━━━━━━━━━━━━━━━━
📋 ${t(locale, 'previousOrder')} (${data.previousOrderDate}):
${itemsList}

${t(locale, 'total')}: $${data.total.toLocaleString()}`;
}

export function formatNoMatch(locale: Locale, searchTerms: string): string {
  return `❓ ${t(locale, 'statusInquiry')}

${t(locale, 'noMatchFound')}
"${searchTerms}" ${locale === 'ko' ? '검색 결과 없음' : 'no results'}`;
}

export interface MultipleMatchData {
  company: string;
  matches: Array<{
    jobId: string;
    description: string;
    date: string;
  }>;
}

export function formatMultipleMatches(locale: Locale, data: MultipleMatchData): string {
  const matchesList = data.matches
    .map((m, i) => `${i + 1}. #${m.jobId.slice(0, 8)} - ${m.description.slice(0, 30)} - ${m.date}`)
    .join('\n');

  return `❓ ${t(locale, 'statusInquiry')} - ${data.company}

${t(locale, 'multipleMatches')}:

${matchesList}`;
}
