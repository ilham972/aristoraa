'use client';

import { useState } from 'react';
import { useCurrentTeacher } from '@/hooks/useCurrentTeacher';
import { GeneralTab } from '@/components/settings/general-tab';
import { CentersTab } from '@/components/settings/centers-tab';
import { ScheduleTab } from '@/components/settings/schedule-tab';
import { TeachersTab } from '@/components/settings/teachers-tab';
import { CurriculumTab } from '@/components/settings/curriculum-tab';
import { ContentTab } from '@/components/settings/content-tab';

type Tab = 'general' | 'centers' | 'schedule' | 'teachers' | 'content' | 'curriculum';

const ALL_TABS: { key: Tab; label: string; adminOnly: boolean }[] = [
  { key: 'general', label: 'General', adminOnly: false },
  { key: 'centers', label: 'Centers', adminOnly: true },
  { key: 'schedule', label: 'Schedule', adminOnly: true },
  { key: 'teachers', label: 'Teachers', adminOnly: true },
  { key: 'content', label: 'Content', adminOnly: true },
  { key: 'curriculum', label: 'Curriculum', adminOnly: true },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const { teacher, role, isLoading } = useCurrentTeacher();

  const isAdmin = role === 'admin';
  // If no teacher record yet, show all tabs so they can bootstrap
  const showAllTabs = isAdmin || !teacher;
  const visibleTabs = showAllTabs ? ALL_TABS : ALL_TABS.filter(t => !t.adminOnly);

  if (isLoading) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <h1 className="text-lg font-bold text-foreground mb-4">Settings</h1>
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
      <h1 className="text-lg font-bold text-foreground mb-4">Settings</h1>

      {/* Tab toggle */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl mb-4 overflow-x-auto">
        {visibleTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'general' && <GeneralTab />}
      {activeTab === 'centers' && <CentersTab />}
      {activeTab === 'schedule' && <ScheduleTab />}
      {activeTab === 'teachers' && <TeachersTab />}
      {activeTab === 'content' && <ContentTab />}
      {activeTab === 'curriculum' && <CurriculumTab />}
    </div>
  );
}
