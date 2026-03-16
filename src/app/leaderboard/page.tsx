'use client';

import { useState, useCallback } from 'react';
import { useQuery } from 'convex/react';
import { Download } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/convex';
import { getTodayDateStr } from '@/lib/types';
import { getLeaderboard, getWeekDates, getMonthDates, LeaderboardEntry } from '@/lib/scoring';
import { toast } from 'sonner';

type Period = 'daily' | 'weekly' | 'monthly';

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>('daily');
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [date, setDate] = useState(getTodayDateStr());

  const students = useQuery(api.students.list);
  const entries = useQuery(api.entries.list);
  const settings = useQuery(api.settings.get);

  const dates = period === 'daily'
    ? [date]
    : period === 'weekly'
    ? getWeekDates(date)
    : getMonthDates(parseInt(date.split('-')[0]), parseInt(date.split('-')[1]));

  const gradeNum = gradeFilter !== 'all' ? parseInt(gradeFilter) : undefined;
  const leaderboard = students && entries ? getLeaderboard(entries, students, dates, gradeNum) : [];
  const tuitionName = settings?.tuitionName ?? '';

  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const downloadImage = useCallback(async () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    const rows = leaderboard.slice(0, 20);
    const width = 800;
    const rowHeight = 48;
    const headerHeight = 140;
    const footerHeight = 40;
    const height = headerHeight + (rows.length * rowHeight) + 60 + footerHeight;

    canvas.width = width;
    canvas.height = height;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#0B1120');
    gradient.addColorStop(1, '#131D2E');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#14B8A6';
    ctx.fillRect(0, 0, width, 4);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(tuitionName, width / 2, 50);

    ctx.font = '16px Arial, sans-serif';
    ctx.fillStyle = '#7B8FA3';
    const periodLabel = period === 'daily' ? `Daily Leaderboard - ${date}`
      : period === 'weekly' ? `Weekly Leaderboard - Week of ${dates[0]}`
      : `Monthly Leaderboard - ${date.substring(0, 7)}`;
    ctx.fillText(periodLabel, width / 2, 80);

    if (gradeNum) {
      ctx.fillText(`Grade ${gradeNum}`, width / 2, 105);
    }

    const tableTop = headerHeight;
    ctx.fillStyle = '#1A2836';
    ctx.fillRect(30, tableTop, width - 60, 40);

    ctx.fillStyle = '#7B8FA3';
    ctx.font = 'bold 13px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('RANK', 50, tableTop + 26);
    ctx.fillText('STUDENT', 120, tableTop + 26);
    ctx.fillText('GROUP', 420, tableTop + 26);
    ctx.textAlign = 'right';
    ctx.fillText('CORRECT', 620, tableTop + 26);
    ctx.fillText('POINTS', 740, tableTop + 26);

    rows.forEach((entry, i) => {
      const y = tableTop + 40 + (i * rowHeight);
      const rank = i + 1;

      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)';
      ctx.fillRect(30, y, width - 60, rowHeight);

      if (rank <= 3) {
        const colors = ['#FBBF24', '#94A3B8', '#D97706'];
        ctx.fillStyle = colors[rank - 1];
        ctx.beginPath();
        ctx.arc(70, y + rowHeight / 2, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0B1120';
        ctx.font = 'bold 12px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(rank), 70, y + rowHeight / 2 + 4);
      } else {
        ctx.fillStyle = '#7B8FA3';
        ctx.font = '14px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(rank), 70, y + rowHeight / 2 + 5);
      }

      ctx.fillStyle = '#E8EDF2';
      ctx.font = rank <= 3 ? 'bold 15px Arial, sans-serif' : '14px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(entry.studentName, 120, y + rowHeight / 2 + 5);

      ctx.fillStyle = '#7B8FA3';
      ctx.font = '12px Arial, sans-serif';
      ctx.fillText(entry.group || '-', 420, y + rowHeight / 2 + 5);

      ctx.fillStyle = '#14B8A6';
      ctx.font = '14px Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(String(entry.totalCorrect), 620, y + rowHeight / 2 + 5);

      ctx.fillStyle = rank <= 3 ? '#FBBF24' : '#E8EDF2';
      ctx.font = 'bold 16px Arial, sans-serif';
      ctx.fillText(String(entry.totalPoints), 740, y + rowHeight / 2 + 5);
    });

    const footerY = height - footerHeight;
    ctx.fillStyle = '#7B8FA3';
    ctx.font = '11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Generated on ${new Date().toLocaleDateString()}`, width / 2, footerY + 20);

    const link = document.createElement('a');
    link.download = `leaderboard-${gradeFilter !== 'all' ? `grade${gradeFilter}-` : ''}${period}-${date}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast.success('Image downloaded!');
  }, [leaderboard, tuitionName, period, date, dates, gradeFilter, gradeNum]);

  if (!students || !entries || !settings) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <h1 className="text-lg font-bold text-foreground mb-4">Leaderboard</h1>
        <div className="animate-pulse space-y-2">
          <div className="h-10 bg-muted rounded-xl" />
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
      <h1 className="text-lg font-bold text-foreground mb-4">Leaderboard</h1>

      {/* Period toggle */}
      <div className="flex gap-1.5 p-1 bg-muted rounded-xl mb-3">
        {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              period === p
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="flex-1 h-10 px-3 text-sm border border-border rounded-xl bg-card text-foreground"
        />
        <Select value={gradeFilter} onValueChange={(v) => setGradeFilter(v ?? 'all')}>
          <SelectTrigger className="w-32 h-10 text-sm">
            <SelectValue placeholder="Grade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Grades</SelectItem>
            {[6, 7, 8, 9, 10, 11].map(g => (
              <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button variant="outline" size="sm" className="w-full mb-4 rounded-xl" onClick={downloadImage}>
        <Download className="w-4 h-4 mr-2" />
        Download as Image
      </Button>

      {/* Leaderboard */}
      <div>
        {leaderboard.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No data for this period</p>
        ) : (
          <div className="space-y-1.5">
            {leaderboard.map((entry, i) => {
              const rank = i + 1;
              const rankStyles: Record<number, string> = {
                1: 'bg-amber-400 text-black',
                2: 'bg-slate-400 text-black',
                3: 'bg-amber-700 text-white',
              };
              return (
                <Card key={entry.studentId} className={`border-border/50 ${rank <= 3 ? 'border-primary/20' : ''}`}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${
                      rankStyles[rank] || 'bg-muted text-muted-foreground'
                    }`}>
                      {rank}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium text-foreground text-sm truncate ${rank <= 3 ? 'font-bold' : ''}`}>
                        {entry.studentName}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{entry.group || '-'}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold ${rank <= 3 ? 'text-lg' : 'text-sm'} text-foreground`}>
                        {entry.totalPoints}
                      </p>
                      <p className="text-[10px] text-primary">{entry.totalCorrect} correct</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Weekly breakdown */}
        {period === 'weekly' && leaderboard.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Daily Breakdown</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-2 text-muted-foreground font-medium">Name</th>
                  {weekDays.map((d) => (
                    <th key={d} className="text-center py-2 px-1 text-muted-foreground font-medium">{d}</th>
                  ))}
                  <th className="text-right py-2 pl-2 text-muted-foreground font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.slice(0, 15).map(entry => (
                  <tr key={entry.studentId} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-medium text-foreground truncate max-w-[80px]">{entry.studentName}</td>
                    {dates.map(d => (
                      <td key={d} className="text-center py-1.5 px-1 text-muted-foreground">
                        {entry.dailyBreakdown?.[d] || '-'}
                      </td>
                    ))}
                    <td className="text-right py-1.5 pl-2 font-bold text-foreground">{entry.totalPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
