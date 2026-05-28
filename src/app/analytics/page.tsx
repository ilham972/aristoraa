'use client';

// /analytics — the business-intelligence surface for the owner. Replaces
// the old two-tab (Revenue + Attendance) layout with a five-tab executive
// dashboard: Pulse / Finance / Operations / Students / Growth.
//
// Pulse is the home — KPI strip, sparkline, insight callouts. The other
// tabs drill into a single executive question each. Range pickers and
// drilldowns live inside each tab so this shell stays a thin router.

import { useState } from 'react';
import { useQuery } from 'convex/react';
import {
  Activity,
  BarChart3,
  ClipboardList,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { EditGroupDialog } from '@/components/groups/edit-group-dialog';
import { PulseTab } from '@/components/analytics/pulse-tab';
import { FinanceTab } from '@/components/analytics/finance-tab';
import { OperationsTab } from '@/components/analytics/operations-tab';
import { StudentsTab } from '@/components/analytics/students-tab';
import { GrowthTab } from '@/components/analytics/growth-tab';

type AnalyticsView = 'pulse' | 'finance' | 'operations' | 'students' | 'growth';

const TABS: Array<{ value: AnalyticsView; label: string; icon: React.ReactNode }> = [
  { value: 'pulse', label: 'Pulse', icon: <Sparkles className="w-3.5 h-3.5" /> },
  { value: 'finance', label: 'Finance', icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { value: 'operations', label: 'Operations', icon: <Activity className="w-3.5 h-3.5" /> },
  { value: 'students', label: 'Students', icon: <Users className="w-3.5 h-3.5" /> },
  { value: 'growth', label: 'Growth', icon: <TrendingUp className="w-3.5 h-3.5" /> },
];

export default function AnalyticsPage() {
  const [view, setView] = useState<AnalyticsView>('pulse');
  const [editingGroup, setEditingGroup] = useState<Id<'groups'> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Prefetch the dialog refs so opening a group editor from any tab is warm.
  const week = useQuery(api.groups.weekGrid);
  useQuery(api.teachers.list);
  useQuery(api.centers.list);

  const openEditor = (groupId: Id<'groups'>) => {
    setEditingGroup(groupId);
    setDrawerOpen(true);
  };

  return (
    <div className="h-[calc(100svh-5rem)] flex flex-col overflow-hidden max-w-3xl mx-auto px-3 pt-3">
      {/* Tab strip — horizontally scrollable on mobile for the 5 tabs. */}
      <div className="shrink-0 flex items-center gap-1 p-1 bg-muted rounded-xl overflow-x-auto mb-3 scrollbar-thin">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setView(t.value)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-all',
              view === t.value
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-3">
        {view === 'pulse' && <PulseTab />}
        {view === 'finance' && <FinanceTab onOpenGroup={openEditor} />}
        {view === 'operations' && <OperationsTab onOpenGroup={openEditor} />}
        {view === 'students' && <StudentsTab />}
        {view === 'growth' && <GrowthTab />}
      </div>

      <EditGroupDialog
        groupId={editingGroup}
        seed={
          editingGroup
            ? week?.groups.find((g) => g._id === editingGroup)
            : undefined
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
