'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { ClipboardPen, Trophy, Users, BarChart3, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES, getModuleForDay } from '@/lib/curriculum-data';
import { getTodayDateStr, getDayName, parseTimeToMinutes, isCurrentTimeInRange } from '@/lib/types';
import { useCurrentTeacher } from '@/hooks/useCurrentTeacher';

const QUICK_LINKS = [
  { href: '/score-entry', label: 'Enter Scores', desc: 'Record student answers', icon: ClipboardPen, accent: 'bg-primary/10 text-primary' },
  { href: '/leaderboard', label: 'Leaderboard', desc: 'View rankings & share', icon: Trophy, accent: 'bg-amber-500/10 text-amber-500' },
  { href: '/students', label: 'Students', desc: 'Manage student list', icon: Users, accent: 'bg-emerald-500/10 text-emerald-500' },
  { href: '/progress', label: 'Progress', desc: 'View student progress', icon: BarChart3, accent: 'bg-violet-500/10 text-violet-500' },
];

function formatTime12(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function Dashboard() {
  const students = useQuery(api.students.list);
  const todayEntries = useQuery(api.entries.getByDate, { date: getTodayDateStr() });
  const settings = useQuery(api.settings.get);
  const { teacher } = useCurrentTeacher();

  // Teacher's schedule
  const teacherSlotAssignments = useQuery(
    api.slotTeachers.listByTeacher,
    teacher ? { teacherId: teacher._id } : 'skip'
  );
  const allSlots = useQuery(api.scheduleSlots.list);
  const rooms = useQuery(api.rooms.list);
  const centers = useQuery(api.centers.list);

  const todaySlots = useMemo(() => {
    if (!teacherSlotAssignments || !allSlots) return [];
    const jsDay = new Date().getDay();
    const dayOfWeek = jsDay === 0 ? 7 : jsDay;
    const slotIds = new Set(teacherSlotAssignments.map((st: typeof teacherSlotAssignments[0]) => st.slotId));
    return allSlots
      .filter((s: typeof allSlots[0]) => slotIds.has(s._id) && s.dayOfWeek === dayOfWeek)
      .sort((a: typeof allSlots[0], b: typeof allSlots[0]) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));
  }, [teacherSlotAssignments, allSlots]);

  if (students === undefined || todayEntries === undefined || settings === undefined) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/3" />
          <div className="h-24 bg-muted rounded" />
          <div className="grid grid-cols-3 gap-2.5">
            <div className="h-16 bg-muted rounded" />
            <div className="h-16 bg-muted rounded" />
            <div className="h-16 bg-muted rounded" />
          </div>
        </div>
      </div>
    );
  }

  const dayName = getDayName();
  const todayModule = getModuleForDay(new Date().getDay());
  const studentCount = students.length;
  const studentsWithEntries = new Set(todayEntries.map(e => e.studentId)).size;
  const studentsWithoutEntries = studentCount - studentsWithEntries;
  return (
    <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
      {/* Greeting */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-foreground">Aristora</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{dayName}</p>
      </div>

      {/* Today's module hero card */}
      {todayModule ? (
        <Card className="mb-5 overflow-hidden border-border/50">
          <div className="h-1" style={{ backgroundColor: todayModule.color }} />
          <CardContent className="pt-4 pb-4">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Today&apos;s Module</p>
            <h2 className="text-lg font-bold mt-1" style={{ color: todayModule.color }}>
              {todayModule.id}: {todayModule.name}
            </h2>
            <p className="text-sm text-muted-foreground">{todayModule.tamilName}</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-5 border-border/50">
          <CardContent className="py-5">
            <p className="text-lg font-semibold text-muted-foreground">Sunday — No Class</p>
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2.5 mb-5">
        <Card className="border-border/50">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{studentCount}</p>
            <p className="text-[11px] text-muted-foreground">Students</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-primary">{studentsWithEntries}</p>
            <p className="text-[11px] text-muted-foreground">Entered</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-amber-500">{studentsWithoutEntries}</p>
            <p className="text-[11px] text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick links */}
      <div className="space-y-2 mb-6">
        {QUICK_LINKS.map(link => (
          <Link key={link.href} href={link.href}>
            <Card className="border-border/50 hover:border-primary/30 transition-all cursor-pointer active:scale-[0.98] mb-2">
              <CardContent className="p-3.5 flex items-center gap-3.5">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${link.accent}`}>
                  <link.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-foreground text-sm">{link.label}</p>
                  <p className="text-xs text-muted-foreground">{link.desc}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Today's Schedule */}
      {todaySlots.length > 0 ? (
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Today&apos;s Schedule</h3>
          <div className="space-y-1.5">
            {todaySlots.map((slot: typeof todaySlots[0]) => {
              const room = rooms?.find((r: NonNullable<typeof rooms>[0]) => r._id === slot.roomId);
              const center = room ? centers?.find((c: NonNullable<typeof centers>[0]) => c._id === room.centerId) : null;
              const isActive = isCurrentTimeInRange(slot.startTime, slot.endTime);
              return (
                <Card key={slot._id} className={`border-border/50 ${isActive ? 'border-primary/30 bg-primary/5' : ''}`}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <Clock className={`w-4 h-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isActive ? 'text-primary' : 'text-foreground'}`}>
                        {formatTime12(slot.startTime)} - {formatTime12(slot.endTime)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {room?.name ?? 'Room'}{center ? ` @ ${center.name}` : ''}
                      </p>
                    </div>
                    {isActive && (
                      <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">Active</span>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Weekly Schedule</h3>
          <div className="grid grid-cols-3 gap-2">
            {CURRICULUM_MODULES.map(mod => (
              <div key={mod.id} className="p-2.5 rounded-xl text-white text-center" style={{ backgroundColor: mod.color }}>
                <p className="text-[10px] font-medium opacity-75">{mod.day.slice(0, 3)}</p>
                <p className="text-xs font-bold mt-0.5">{mod.id}</p>
                <p className="text-[10px] opacity-85 leading-tight mt-0.5">{mod.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
