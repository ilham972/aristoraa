'use client';

import { Bell } from 'lucide-react';
import { NotificationList } from '@/components/messaging/NotificationList';

export default function NotificationsPage() {
  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Notifications</h1>
      </div>
      <NotificationList />
    </div>
  );
}
