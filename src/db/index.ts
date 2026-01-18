export { supabase } from './client.js';
export { findContactByEmail, getAllActiveContacts } from './contacts.js';
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
