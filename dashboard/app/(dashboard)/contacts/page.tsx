import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ContactsTable } from '@/components/contacts-table';
import { AddContactDialog } from '@/components/add-contact-dialog';
import type { Contact } from '@/lib/database.types';

async function getContacts(): Promise<Contact[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .order('name');

  if (error) {
    console.error('Failed to fetch contacts:', error);
    return [];
  }

  return data as Contact[];
}

export default async function ContactsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const contacts = await getContacts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Contacts</h1>
          <p className="text-muted-foreground">Manage monitored email contacts</p>
        </div>

        <AddContactDialog />
      </div>

      <ContactsTable contacts={contacts} />
    </div>
  );
}
