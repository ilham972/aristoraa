'use client';

// SessionWorkspace — the shared 3-tab body for a single session (slot+date):
// the Sheets / Lead / Attendance strip plus the active tab's body.
//
// "Sheets" (tab id 'score', kept for URL back-compat) is the merged
// sheet-management + scoring surface — it folds in what used to be two
// separate Score and Sheets tabs.
//
// Both the standalone /session/[slotId]/[date] page and the embedded Session
// tab on /groups mount this, so the tab set never drifts between the two
// surfaces. The body components own their own data fetching + loading states,
// so this component is pure tab routing — it deliberately does NOT render the
// page header (group name / date / back arrow / navigation), because that
// chrome differs per surface (back-arrow + group stepper on the page;
// Today/Tomorrow + pill strip on the embedded launcher).

import { cn } from '@/lib/utils';
import type { Id } from '@/lib/convex';
import { ClipboardCheck, FileSpreadsheet, Radio } from 'lucide-react';
import { AttendanceTab } from './attendance-tab';
import { ScoreSheetTab } from './score-sheet-tab';
import { LeadTab } from './lead-tab';

export type SessionTab = 'score' | 'lead' | 'attendance';
export const ALL_SESSION_TABS: SessionTab[] = ['score', 'lead', 'attendance'];

export function isSessionTab(v: string | null): v is SessionTab {
  // 'sheets' is the old id for the now-merged tab — normalize it to 'score'
  // so bookmarked ?tab=sheets links keep working.
  return v !== null && ((ALL_SESSION_TABS as string[]).includes(v) || v === 'sheets');
}

// Map a (possibly legacy) tab string onto a current SessionTab.
export function normalizeSessionTab(v: string | null): SessionTab | null {
  if (v === 'sheets') return 'score';
  return isSessionTab(v) ? (v as SessionTab) : null;
}

const TABS: Array<{ id: SessionTab; label: string; icon: typeof FileSpreadsheet }> = [
  { id: 'score', label: 'Sheets', icon: FileSpreadsheet },
  { id: 'lead', label: 'Lead', icon: Radio },
  { id: 'attendance', label: 'Attendance', icon: ClipboardCheck },
];

export function SessionWorkspace({
  slotId,
  date,
  tab,
  onTabChange,
}: {
  slotId: Id<'scheduleSlots'>;
  date: string;
  tab: SessionTab;
  onTabChange: (t: SessionTab) => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Tab strip — underline-style, sits below whatever header the host
          surface renders. */}
      <div className="shrink-0 border-b border-border/60 mb-3">
        <div className="flex items-center gap-1 -mb-px overflow-x-auto">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active tab body. Each tab manages its own internal scroll. */}
      <div className="flex-1 min-h-0">
        {tab === 'attendance' ? (
          <AttendanceTab slotId={slotId} date={date} />
        ) : tab === 'score' ? (
          <ScoreSheetTab slotId={slotId} date={date} />
        ) : tab === 'lead' ? (
          <LeadTab lockedSlotId={slotId} lockedDate={date} />
        ) : null}
      </div>
    </div>
  );
}
