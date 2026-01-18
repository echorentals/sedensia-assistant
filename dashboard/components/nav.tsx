'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Briefcase, FileText, Users, DollarSign, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logout } from '@/app/login/actions';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/estimates', label: 'Estimates', icon: FileText },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/pricing', label: 'Pricing', icon: DollarSign },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-slate-900 text-white min-h-screen p-4 flex flex-col">
      <div className="mb-8">
        <h1 className="text-xl font-bold">Sedensia</h1>
        <p className="text-slate-400 text-sm">Dashboard</p>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                isActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <form action={logout}>
        <Button variant="ghost" className="w-full justify-start text-slate-400 hover:text-white">
          <LogOut className="h-5 w-5 mr-3" />
          Sign out
        </Button>
      </form>
    </aside>
  );
}
