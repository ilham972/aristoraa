'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Plus, Trash2, ChevronDown, ChevronRight, Users, UserCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/convex';
import { toast } from 'sonner';
import type { Id } from '@/lib/convex';
import { getModuleById } from '@/lib/curriculum-data';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatTime12(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function ScheduleTab() {
  const [selectedDay, setSelectedDay] = useState(1);
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
  const [addSlotOpen, setAddSlotOpen] = useState(false);
  const [slotStartTime, setSlotStartTime] = useState('16:00');
  const [slotEndTime, setSlotEndTime] = useState('17:00');
  const [slotRoomId, setSlotRoomId] = useState('');

  // Student picker
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [pickerSlotId, setPickerSlotId] = useState<Id<"scheduleSlots"> | null>(null);

  // Teacher picker
  const [teacherPickerOpen, setTeacherPickerOpen] = useState(false);
  const [teacherPickerSlotId, setTeacherPickerSlotId] = useState<Id<"scheduleSlots"> | null>(null);

  // Override
  const [overrideDate, setOverrideDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  const allSlots = useQuery(api.scheduleSlots.list);
  const centers = useQuery(api.centers.list);
  const rooms = useQuery(api.rooms.list);
  const students = useQuery(api.students.list);
  const teachers = useQuery(api.teachers.list);

  const addSlotMutation = useMutation(api.scheduleSlots.add);
  const removeSlotMutation = useMutation(api.scheduleSlots.remove);
  const assignStudentMutation = useMutation(api.slotStudents.assign);
  const unassignStudentMutation = useMutation(api.slotStudents.unassign);
  const assignTeacherMutation = useMutation(api.slotTeachers.assign);
  const unassignTeacherMutation = useMutation(api.slotTeachers.unassign);
  const addOverrideMutation = useMutation(api.slotStudents.addOverride);
  const removeOverrideMutation = useMutation(api.slotStudents.removeOverride);

  const daySlots = useMemo(() => {
    if (!allSlots) return [];
    return allSlots
      .filter((s) => s.dayOfWeek === selectedDay)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [allSlots, selectedDay]);

  if (!allSlots || !centers || !rooms || !students || !teachers) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2].map(i => <div key={i} className="h-20 bg-muted rounded-xl" />)}
      </div>
    );
  }

  const getRoom = (roomId: string) => rooms.find((r: typeof rooms[0]) => r._id === roomId);
  const getCenter = (centerId: string) => centers.find((c: typeof centers[0]) => c._id === centerId);

  const handleAddSlot = async () => {
    if (!slotRoomId) { toast.error('Select a room'); return; }
    if (slotStartTime >= slotEndTime) { toast.error('End time must be after start time'); return; }

    // Check overlaps in same room same day
    const overlapping = daySlots.filter((s: typeof daySlots[0]) =>
      s.roomId === slotRoomId &&
      s.startTime < slotEndTime && s.endTime > slotStartTime
    );
    if (overlapping.length > 0) {
      toast.error('Time slot overlaps with existing slot in this room');
      return;
    }

    await addSlotMutation({
      dayOfWeek: selectedDay,
      startTime: slotStartTime,
      endTime: slotEndTime,
      roomId: slotRoomId as Id<"rooms">,
    });
    toast.success('Slot added');
    setAddSlotOpen(false);
  };

  const handleDeleteSlot = async (id: Id<"scheduleSlots">) => {
    if (confirm('Delete this time slot and all its assignments?')) {
      await removeSlotMutation({ id });
      toast.success('Slot deleted');
      if (expandedSlot === id) setExpandedSlot(null);
    }
  };

  return (
    <>
      {/* Day filter pills */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto">
        {[1, 2, 3, 4, 5, 6].map(day => (
          <button
            key={day}
            onClick={() => setSelectedDay(day)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all shrink-0 ${
              selectedDay === day
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {DAY_NAMES[day]}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mb-3">{DAY_FULL[selectedDay]} — {daySlots.length} slot{daySlots.length !== 1 ? 's' : ''}</p>

      {daySlots.length === 0 ? (
        <Card className="border-border/50 mb-3">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">No slots for {DAY_FULL[selectedDay]}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2 mb-3">
          {daySlots.map((slot: typeof daySlots[0]) => {
            const room = getRoom(slot.roomId);
            const center = room ? getCenter(room.centerId) : null;
            const isExpanded = expandedSlot === slot._id;

            return (
              <Card key={slot._id} className="border-border/50">
                <CardContent className="p-0">
                  <div
                    role="button"
                    tabIndex={0}
                    className="w-full p-3.5 flex items-center gap-3 text-left cursor-pointer"
                    onClick={() => setExpandedSlot(isExpanded ? null : slot._id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedSlot(isExpanded ? null : slot._id); } }}
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground text-sm">
                        {formatTime12(slot.startTime)} - {formatTime12(slot.endTime)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {room?.name ?? 'Unknown Room'}{center ? ` @ ${center.name}` : ''}
                        {room && (() => {
                          const tt = (room as { moduleTimetable?: Record<string, string> }).moduleTimetable;
                          const modId = tt?.[String(slot.dayOfWeek)];
                          const mod = modId ? getModuleById(modId) : null;
                          return mod ? <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: mod.color + '20', color: mod.color }}>{mod.id}</span> : null;
                        })()}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon-xs" onClick={() => handleDeleteSlot(slot._id)} className="text-destructive hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <ExpandedSlotContent
                      slotId={slot._id}
                      overrideDate={overrideDate}
                      setOverrideDate={setOverrideDate}
                      students={students}
                      teachers={teachers}
                      assignStudentMutation={assignStudentMutation}
                      unassignStudentMutation={unassignStudentMutation}
                      assignTeacherMutation={assignTeacherMutation}
                      unassignTeacherMutation={unassignTeacherMutation}
                      addOverrideMutation={addOverrideMutation}
                      removeOverrideMutation={removeOverrideMutation}
                      onOpenStudentPicker={() => { setPickerSlotId(slot._id); setStudentPickerOpen(true); }}
                      onOpenTeacherPicker={() => { setTeacherPickerSlotId(slot._id); setTeacherPickerOpen(true); }}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Button onClick={() => setAddSlotOpen(true)} variant="outline" className="w-full rounded-xl gap-1.5">
        <Plus className="w-4 h-4" />
        Add Slot
      </Button>

      {/* Add Slot Dialog */}
      <Dialog open={addSlotOpen} onOpenChange={setAddSlotOpen}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>Add Slot — {DAY_FULL[selectedDay]}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-sm">Start Time</Label>
                <Input type="time" value={slotStartTime} onChange={e => setSlotStartTime(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-sm">End Time</Label>
                <Input type="time" value={slotEndTime} onChange={e => setSlotEndTime(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-sm">Room</Label>
              <Select value={slotRoomId} onValueChange={(v: string | null) => setSlotRoomId(v ?? '')}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select room" /></SelectTrigger>
                <SelectContent>
                  {centers.map((center: typeof centers[0]) => {
                    const centerRooms = rooms.filter((r: typeof rooms[0]) => r.centerId === center._id);
                    return centerRooms.map((room: typeof rooms[0]) => (
                      <SelectItem key={room._id} value={room._id}>
                        {room.name} @ {center.name}
                      </SelectItem>
                    ));
                  })}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddSlot} className="w-full rounded-xl">Add Slot</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Student Picker Dialog */}
      <Dialog open={studentPickerOpen} onOpenChange={setStudentPickerOpen}>
        <DialogContent className="max-w-sm mx-auto max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Student to Slot</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            {students.map(student => (
              <button
                key={student._id}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted transition-colors text-left"
                onClick={async () => {
                  if (pickerSlotId) {
                    await assignStudentMutation({ slotId: pickerSlotId, studentId: student._id });
                    toast.success(`${student.name} assigned`);
                  }
                }}
              >
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                  <span className="text-xs font-semibold text-muted-foreground">{student.name.charAt(0)}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{student.name}</p>
                  <p className="text-xs text-muted-foreground">Grade {student.schoolGrade}</p>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Teacher Picker Dialog */}
      <Dialog open={teacherPickerOpen} onOpenChange={setTeacherPickerOpen}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>Add Teacher to Slot</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            {teachers.map((teacher: typeof teachers[0]) => (
              <button
                key={teacher._id}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted transition-colors text-left"
                onClick={async () => {
                  if (teacherPickerSlotId) {
                    await assignTeacherMutation({ slotId: teacherPickerSlotId, teacherId: teacher._id });
                    toast.success(`${teacher.name} assigned`);
                    setTeacherPickerOpen(false);
                  }
                }}
              >
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-xs font-semibold text-primary">{teacher.name.charAt(0)}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{teacher.name}</p>
                  <Badge variant="secondary" className="text-[10px]">{teacher.role}</Badge>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Expanded slot inline content
function ExpandedSlotContent({
  slotId,
  overrideDate,
  setOverrideDate,
  students: allStudents,
  teachers: allTeachers,
  assignStudentMutation,
  unassignStudentMutation,
  assignTeacherMutation,
  unassignTeacherMutation,
  addOverrideMutation,
  removeOverrideMutation,
  onOpenStudentPicker,
  onOpenTeacherPicker,
}: {
  slotId: Id<"scheduleSlots">;
  overrideDate: string;
  setOverrideDate: (d: string) => void;
  students: Array<{ _id: Id<"students">; name: string; schoolGrade: number }>;
  teachers: Array<{ _id: Id<"teachers">; name: string; role: string }>;
  assignStudentMutation: any;
  unassignStudentMutation: any;
  assignTeacherMutation: any;
  unassignTeacherMutation: any;
  addOverrideMutation: any;
  removeOverrideMutation: any;
  onOpenStudentPicker: () => void;
  onOpenTeacherPicker: () => void;
}) {
  const slotStudents = useQuery(api.slotStudents.listBySlot, { slotId });
  const slotTeachers = useQuery(api.slotTeachers.listBySlot, { slotId });
  const overrides = useQuery(api.slotStudents.listOverrides, { slotId, date: overrideDate });

  if (!slotStudents || !slotTeachers) {
    return <div className="p-3 text-xs text-muted-foreground">Loading...</div>;
  }

  const assignedStudents = slotStudents.map((ss: typeof slotStudents[0]) => {
    const student = allStudents.find((s: typeof allStudents[0]) => s._id === ss.studentId);
    return student ? { ...student, assignmentId: ss._id } : null;
  }).filter(Boolean) as Array<{ _id: Id<"students">; name: string; schoolGrade: number; assignmentId: string }>;

  const assignedTeachers = slotTeachers.map((st: typeof slotTeachers[0]) => {
    const teacher = allTeachers.find((t: typeof allTeachers[0]) => t._id === st.teacherId);
    return teacher ? { ...teacher, assignmentId: st._id } : null;
  }).filter(Boolean) as Array<{ _id: Id<"teachers">; name: string; role: string; assignmentId: string }>;

  return (
    <div className="px-3.5 pb-3.5 border-t border-border/50 space-y-4">
      {/* Students section */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            Students ({assignedStudents.length})
          </p>
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={onOpenStudentPicker}>
            <Plus className="w-3 h-3" /> Add
          </Button>
        </div>
        {assignedStudents.length > 0 ? (
          <div className="space-y-1">
            {assignedStudents.map(student => (
              <div key={student._id} className="flex items-center justify-between py-1.5 px-2 bg-muted rounded-lg">
                <span className="text-xs text-foreground">{student.name} <span className="text-muted-foreground">G{student.schoolGrade}</span></span>
                <button
                  onClick={async () => {
                    await unassignStudentMutation({ slotId, studentId: student._id });
                    toast.success(`${student.name} removed`);
                  }}
                  className="w-5 h-5 rounded flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No students assigned</p>
        )}
      </div>

      {/* Overrides section */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Daily Overrides</p>
        <Input
          type="date"
          value={overrideDate}
          onChange={e => setOverrideDate(e.target.value)}
          className="mb-2 h-8 text-xs"
        />
        {overrides && overrides.length > 0 ? (
          <div className="space-y-1 mb-2">
            {overrides.map((o: any) => {
              const student = allStudents.find(s => s._id === o.studentId);
              return (
                <div key={o._id} className="flex items-center justify-between py-1.5 px-2 bg-muted rounded-lg">
                  <span className="text-xs">
                    <Badge variant={o.action === 'add' ? 'default' : 'destructive'} className="text-[9px] mr-1.5">{o.action}</Badge>
                    {student?.name ?? 'Unknown'}
                  </span>
                  <button
                    onClick={async () => {
                      await removeOverrideMutation({ id: o._id });
                      toast.success('Override removed');
                    }}
                    className="w-5 h-5 rounded flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mb-2">No overrides for this date</p>
        )}
      </div>

      {/* Teachers section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <UserCheck className="w-3.5 h-3.5" />
            Teachers ({assignedTeachers.length})
          </p>
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={onOpenTeacherPicker}>
            <Plus className="w-3 h-3" /> Add
          </Button>
        </div>
        {assignedTeachers.length > 0 ? (
          <div className="space-y-1">
            {assignedTeachers.map(teacher => (
              <div key={teacher._id} className="flex items-center justify-between py-1.5 px-2 bg-muted rounded-lg">
                <span className="text-xs text-foreground">{teacher.name} <Badge variant="secondary" className="text-[9px] ml-1">{teacher.role}</Badge></span>
                <button
                  onClick={async () => {
                    await unassignTeacherMutation({ slotId, teacherId: teacher._id });
                    toast.success(`${teacher.name} removed`);
                  }}
                  className="w-5 h-5 rounded flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No teachers assigned</p>
        )}
      </div>
    </div>
  );
}
