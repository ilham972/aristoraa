'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

const LINKS = [
  { href: '/curriculum', label: 'Curriculum', desc: 'Manage modules & exercises', color: 'bg-purple-100 text-purple-600' },
  { href: '/progress', label: 'Student Progress', desc: 'View individual progress', color: 'bg-teal-100 text-teal-600' },
  { href: '/settings', label: 'Settings', desc: 'Groups, backup & restore', color: 'bg-gray-100 text-gray-600' },
];

export default function MorePage() {
  return (
    <div className="px-4 pt-6 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-4">More</h1>
      <div className="space-y-2">
        {LINKS.map(link => (
          <Link key={link.href} href={link.href}>
            <Card className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer mb-2">
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${link.color}`}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{link.label}</p>
                  <p className="text-xs text-gray-500">{link.desc}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
