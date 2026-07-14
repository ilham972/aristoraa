'use client';

import { useState, useEffect } from 'react';
import { useCurrentTeacher } from '@/hooks/useCurrentTeacher';
import { GeneralTab } from '@/components/settings/general-tab';
import { ContentTab } from '@/components/settings/content-tab';
import { BookTab } from '@/components/settings/book-tab';
import { DataEntryTab } from '@/components/settings/data-entry-tab';
import { TagsTab } from '@/components/settings/tags-tab';

type Tab = 'general' | 'content' | 'book' | 'tags' | 'data-entry';

const TAB_KEYS: Tab[] = ['general', 'content', 'book', 'tags', 'data-entry'];
const SS_KEY = 'settings.activeTab';

function readPersistedTab(): Tab {
  if (typeof window === 'undefined') return 'general';
  const v = window.sessionStorage.getItem(SS_KEY);
  return v && (TAB_KEYS as string[]).includes(v) ? (v as Tab) : 'general';
}

const ALL_TABS: { key: Tab; label: string; adminOnly: boolean }[] = [
  { key: 'general', label: 'General', adminOnly: false },
  { key: 'content', label: 'Content', adminOnly: true },
  { key: 'book', label: 'Book', adminOnly: true },
  { key: 'tags', label: 'Tags', adminOnly: true },
  { key: 'data-entry', label: 'Data Entry', adminOnly: true },
];

export default function SettingsPage() {
  // Read once on mount from sessionStorage so back-from-crop returns to the
  // same tab the user was on. Lazy initializer is fine on the client; SSR
  // returns 'general'.
  const [activeTab, setActiveTab] = useState<Tab>(() => readPersistedTab());
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(SS_KEY, activeTab);
    }
  }, [activeTab]);
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

      {activeTab === 'general' && <GeneralTab isAdmin={isAdmin || !teacher} />}
      {activeTab === 'content' && <ContentTab />}
      {activeTab === 'book' && <BookTab />}
      {activeTab === 'tags' && <TagsTab />}
      {activeTab === 'data-entry' && <DataEntryTab />}
    </div>
  );
}
