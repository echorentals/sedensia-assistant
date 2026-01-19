import { supabase } from './client.js';

export interface Contact {
  id: string;
  name: string;
  email: string;
  company: string | null;
  is_active: boolean;
  created_at: string;
}

export async function findContactByEmail(email: string): Promise<Contact | null> {
  // Extract email from "Name <email@domain.com>" format
  const emailMatch = email.match(/<(.*)>/);
  const cleanEmail = emailMatch ? emailMatch[1]?.toLowerCase().trim() : email.toLowerCase().trim();

  if (!cleanEmail) return null;

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('email', cleanEmail)
    .eq('is_active', true)
    .single();

  if (error) {
    console.error('Failed to fetch contact:', error);
    return null;
  }

  if (!data) {
    return null;
  }

  return data as Contact;
}

export async function getAllActiveContacts(): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('Failed to fetch active contacts:', error);
    return [];
  }

  if (!data) {
    return [];
  }

  return data as Contact[];
}

export async function getContactById(id: string): Promise<Contact | null> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Contact;
}
