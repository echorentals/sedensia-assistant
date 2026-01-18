'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function addContact(formData: FormData): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from('contacts').insert({
    name: formData.get('name') as string,
    email: formData.get('email') as string,
    company: formData.get('company') as string || null,
    is_active: true,
  });

  if (error) {
    console.error('Failed to add contact:', error);
    return;
  }

  revalidatePath('/contacts');
}

export async function toggleContactActive(contactId: string, isActive: boolean) {
  const supabase = await createClient();

  await supabase
    .from('contacts')
    .update({ is_active: isActive })
    .eq('id', contactId);

  revalidatePath('/contacts');
}
