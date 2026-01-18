'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import type { Contact } from '@/lib/database.types';
import { toggleContactActive } from '@/app/(dashboard)/contacts/actions';

interface ContactsTableProps {
  contacts: Contact[];
}

export function ContactsTable({ contacts }: ContactsTableProps) {
  async function handleToggle(contactId: string, currentValue: boolean) {
    await toggleContactActive(contactId, !currentValue);
  }

  return (
    <div className="bg-white rounded-lg shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => (
            <TableRow key={contact.id}>
              <TableCell className="font-medium">{contact.name}</TableCell>
              <TableCell>{contact.company || '-'}</TableCell>
              <TableCell>{contact.email}</TableCell>
              <TableCell>
                <Switch
                  checked={contact.is_active}
                  onCheckedChange={() => handleToggle(contact.id, contact.is_active)}
                />
              </TableCell>
            </TableRow>
          ))}
          {contacts.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                No contacts found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
