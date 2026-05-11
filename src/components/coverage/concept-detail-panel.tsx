'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Book, FileText } from 'lucide-react';
import { findUnit } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import type { CoverageRow } from './unit-coverage-card';

interface Props {
  row: CoverageRow | null;
  threshold: number;
  onClose: () => void;
}

const DIFFICULTY_LABELS: Array<{ key: 1 | 2 | 3 | 4 | 5 | 'unset'; label: string; color: string }> = [
  { key: 1, label: '1', color: 'bg-emerald-500' },
  { key: 2, label: '2', color: 'bg-emerald-400' },
  { key: 3, label: '3', color: 'bg-amber-400' },
  { key: 4, label: '4', color: 'bg-orange-500' },
  { key: 5, label: '5', color: 'bg-red-500' },
  { key: 'unset', label: '?', color: 'bg-zinc-500' },
];

export function ConceptDetailPanel({ row, threshold, onClose }: Props) {
  const router = useRouter();

  // Resolve the parent exercise for the "Crop from textbook" deep-link.
  // Skipped when the panel is closed.
  const parentExId = useQuery(
    api.learningEngine.derivedConcepts.getUnitMapping,
    row ? { unitId: row.unitId } : 'skip',
  );

  if (!row) {
    return (
      <Sheet open={false} onOpenChange={onClose}>
        <SheetContent side="bottom" className="rounded-t-2xl" />
      </Sheet>
    );
  }

  const meta = findUnit(row.unitId);
  const moduleId = row.unitId.split('-')[0];
  const moduleColor = MODULE_COLORS[moduleId] ?? '#0D9488';
  const needsMore = row.isGated ? threshold - row.total : 0;
  const maxBar = Math.max(
    row.byDifficulty[1],
    row.byDifficulty[2],
    row.byDifficulty[3],
    row.byDifficulty[4],
    row.byDifficulty[5],
    row.byDifficulty.unset,
    1,
  );

  // The parent exercise of the concept, used for the textbook deep-link.
  const parentExerciseId =
    parentExId?.exerciseToConcepts.find((e) =>
      e.conceptIds.some((cid) => cid === row.conceptId),
    )?.exerciseId ?? null;

  function goTextbook() {
    const eid = parentExerciseId;
    if (eid) {
      router.push(`/settings/crop/${row!.unitId}?exerciseId=${eid}`);
    } else {
      router.push(`/settings/crop/${row!.unitId}`);
    }
  }

  function goPastPaper() {
    // No paper context known here — route to lead's past-paper management
    // (Settings → Data Entry). This is intentional: 0.6c doesn't pre-filter
    // papers by topic linkage. Phase D will refine routing if needed.
    router.push('/settings');
  }

  return (
    <Sheet open={true} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left pb-3">
          <div className="flex items-start gap-3">
            <div
              className="w-1.5 self-stretch rounded-full shrink-0 mt-1"
              style={{ backgroundColor: moduleColor }}
            />
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-sm font-semibold text-foreground leading-tight">
                {row.conceptName}
              </SheetTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {meta ? `${meta.module.id} · G${meta.grade} T${meta.term} · ${meta.unit.name}` : row.unitId}
              </p>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-4 pb-4">
          {/* Summary numbers */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant={row.isGated ? 'destructive' : 'secondary'}
              className="text-xs"
            >
              {row.total} question{row.total === 1 ? '' : 's'}
            </Badge>
            {row.isGated && (
              <Badge variant="destructive" className="text-xs">
                Needs {needsMore} more
              </Badge>
            )}
            {row.hasNoHardQuestions && (
              <Badge className="bg-amber-500/20 text-amber-500 border border-amber-500/40 text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" />
                No hard questions
              </Badge>
            )}
          </div>

          {/* Difficulty histogram */}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              By difficulty
            </p>
            <div className="flex items-end gap-2 h-20">
              {DIFFICULTY_LABELS.map(({ key, label, color }) => {
                const count = row.byDifficulty[key];
                const heightPct = (count / maxBar) * 100;
                return (
                  <div key={key} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className={`w-full ${color} rounded-t-sm transition-all`}
                        style={{ height: `${heightPct}%`, minHeight: count > 0 ? 4 : 0 }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                    <span className="text-[10px] font-semibold text-foreground">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Source breakdown */}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              By source
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-muted/50 p-2 text-center">
                <p className="text-base font-bold text-foreground">{row.bySource.textbook}</p>
                <p className="text-[10px] text-muted-foreground">Textbook</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-2 text-center">
                <p className="text-base font-bold text-foreground">{row.bySource.past_paper}</p>
                <p className="text-[10px] text-muted-foreground">Past paper</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-2 text-center">
                <p className="text-base font-bold text-foreground">{row.bySource.teacher_authored}</p>
                <p className="text-[10px] text-muted-foreground">Authored</p>
              </div>
            </div>
          </div>

          {/* Deep-link actions */}
          <div className="flex flex-col gap-2 pt-2">
            <Button
              variant="default"
              size="sm"
              onClick={goTextbook}
              className="justify-start"
            >
              <Book className="w-4 h-4 mr-2" />
              Crop more from textbook
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={goPastPaper}
              className="justify-start"
            >
              <FileText className="w-4 h-4 mr-2" />
              Crop more from past papers
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
