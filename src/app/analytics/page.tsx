'use client';

// /analytics — the lead/admin analytics surface, split out of /groups in
// Phase 1 of the session-page refactor. Two tabs: Revenue and Attendance.
// The tabs are the same components /groups used to mount internally, so
// behaviour is preserved — only the navigation home changes.

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { BarChart3, ClipboardCheck } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { RevenueTab } from '@/components/groups/revenue-tab';
import { AttendanceTab } from '@/components/groups/attendance-tab';
import { EditGroupDialog } from '@/components/groups/edit-group-dialog';

export default function AnalyticsPage() {
  const [view, setView] = useState<'revenue' | 'attendance'>('revenue');
  const [editingGroup, setEditingGroup] = useState<Id<'groups'> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Same prefetch + dialog wiring as /groups so the editor opens with warm
  // caches when a chart row is tapped.
  const week = useQuery(api.groups.weekGrid);
  useQuery(api.teachers.list);
  useQuery(api.centers.list);

  const openEditor = (groupId: Id<'groups'>) => {
    setEditingGroup(groupId);
    setDrawerOpen(true);
  };

  return (
    <div className="h-[calc(100svh-5rem)] flex flex-col overflow-hidden max-w-3xl mx-auto px-3 pt-3">
      <div className="shrink-0 flex items-center gap-2 mb-2">
        <div className="flex items-center gap-1 p-1 bg-muted rounded-xl w-fit">
          <button
            onClick={() => setView('revenue')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              view === 'revenue'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground',
            )}
          >
            <BarChart3 className="w-3.5 h-3.5" /> Revenue
          </button>
          <button
            onClick={() => setView('attendance')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              view === 'attendance'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground',
            )}
          >
            <ClipboardCheck className="w-3.5 h-3.5" /> Attendance
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-3">
        {view === 'revenue' && <RevenueTab onOpenGroup={openEditor} />}
        {view === 'attendance' && <AttendanceTab onOpenGroup={openEditor} />}
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
