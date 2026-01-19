export { supabase } from './client.js';
export { findContactByEmail, getAllActiveContacts, getContactById } from './contacts.js';
export type { Contact } from './contacts.js';
export {
  createEstimate,
  getEstimateById,
  updateEstimateStatus,
  updateEstimateItems,
  getRecentEstimates,
  getPendingEstimates,
} from './estimates.js';
export type { Estimate, EstimateItem } from './estimates.js';
export {
  getPricingSuggestion,
  recordPricingHistory,
  updatePricingOutcome,
  getSignTypes,
  findSignTypeByName,
  getMaterials,
  findMaterialByName,
  type PricingSuggestion,
  type SignType,
  type Material,
} from './pricing.js';
export {
  createJob,
  getJobById,
  getActiveJobs,
  updateJobStage,
  updateJobEta,
  findJobByPrefix,
  type Job,
} from './jobs.js';
export {
  getTelegramUser,
  upsertTelegramUser,
  setUserLanguage,
  getUserLanguage,
  type TelegramUser,
} from './telegram-users.js';
export {
  createInvoice,
  getInvoiceByJobId,
  updateInvoiceSent,
  updateInvoicePaid,
  type Invoice,
  type CreateInvoiceInput,
} from './invoices.js';
