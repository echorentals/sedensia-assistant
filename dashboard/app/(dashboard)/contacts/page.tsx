import { createClient } from '@/lib/supabase/server';
import { ContactsTable } from '@/components/contacts-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import { addContact } from './actions';
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
  const contacts = await getContacts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Contacts</h1>
          <p className="text-muted-foreground">Manage monitored email contacts</p>
        </div>

        <Dialog>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Contact
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Contact</DialogTitle>
            </DialogHeader>
            <form action={addContact} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Company</Label>
                <Input id="company" name="company" />
              </div>
              <Button type="submit" className="w-full">Add Contact</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <ContactsTable contacts={contacts} />
    </div>
  );
}
