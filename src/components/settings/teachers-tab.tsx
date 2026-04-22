'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { useUser } from '@clerk/nextjs';
import { Plus, Pencil, Trash2 } from 'lucide-react';
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

export function TeachersTab() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<Id<"teachers"> | null>(null);
  const [formName, setFormName] = useState('');
  const [formClerkId, setFormClerkId] = useState('');
  const [formRole, setFormRole] = useState('correction');

  const { user } = useUser();
  const teachers = useQuery(api.teachers.list);

  const addTeacherMutation = useMutation(api.teachers.add);
  const updateTeacherMutation = useMutation(api.teachers.update);
  const removeTeacherMutation = useMutation(api.teachers.remove);

  if (!teachers) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2].map(i => <div key={i} className="h-20 bg-muted rounded-xl" />)}
      </div>
    );
  }

  const resetForm = () => {
    setFormName('');
    setFormClerkId('');
    setFormRole('correction');
    setEditId(null);
  };

  const handleSave = async () => {
    if (!formName.trim()) { toast.error('Name is required'); return; }
    if (!formClerkId.trim() && !editId) { toast.error('Clerk User ID is required'); return; }

    if (editId) {
      await updateTeacherMutation({ id: editId, name: formName.trim(), role: formRole });
      toast.success('Teacher updated');
    } else {
      await addTeacherMutation({ clerkUserId: formClerkId.trim(), name: formName.trim(), role: formRole });
      toast.success('Teacher added');
    }
    setDialogOpen(false);
    resetForm();
  };

  const handleEdit = (teacher: typeof teachers[0]) => {
    setEditId(teacher._id);
    setFormName(teacher.name);
    setFormClerkId(teacher.clerkUserId);
    setFormRole(teacher.role);
    setDialogOpen(true);
  };

  const handleDelete = async (id: Id<"teachers">) => {
    if (confirm('Delete this teacher and all their slot assignments?')) {
      await removeTeacherMutation({ id });
      toast.success('Teacher deleted');
    }
  };

  const handleBootstrap = async () => {
    if (!user) return;
    await addTeacherMutation({
      clerkUserId: user.id,
      name: user.fullName || user.firstName || 'Admin',
      role: 'admin',
    });
    toast.success('Registered yourself as admin');
  };

  return (
    <>
      {teachers.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">No teachers registered yet</p>
            <Button onClick={handleBootstrap} className="rounded-xl gap-1.5">
              <Plus className="w-4 h-4" />
              Register Myself as Admin
            </Button>
            <p className="text-[11px] text-muted-foreground">This will use your current login</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {teachers.map((teacher: typeof teachers[0]) => (
            <Card key={teacher._id} className="border-border/50">
              <CardContent className="p-3.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">{teacher.name.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground text-sm truncate">{teacher.name}</p>
                    <Badge variant={teacher.role === 'admin' ? 'default' : 'secondary'} className="text-[10px] shrink-0">
                      {teacher.role}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{teacher.clerkUserId}</p>
                </div>
                <div className="flex gap-0.5 shrink-0">
                  <Button variant="ghost" size="icon-xs" onClick={() => handleEdit(teacher)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(teacher._id)} className="text-destructive hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          <Button onClick={() => { resetForm(); setDialogOpen(true); }} variant="outline" className="w-full rounded-xl gap-1.5 mt-2">
            <Plus className="w-4 h-4" />
            Add Teacher
          </Button>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>{editId ? 'Edit Teacher' : 'Add Teacher'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Name *</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Teacher name" className="mt-1" />
            </div>
            {!editId && (
              <div>
                <Label className="text-sm">Clerk User ID *</Label>
                <Input value={formClerkId} onChange={e => setFormClerkId(e.target.value)} placeholder="user_..." className="mt-1 font-mono text-xs" />
                {user && (
                  <Button variant="ghost" size="sm" className="mt-1 text-xs h-6" onClick={() => setFormClerkId(user.id)}>
                    Use my ID: {user.id.substring(0, 15)}...
                  </Button>
                )}
              </div>
            )}
            <div>
              <Label className="text-sm">Role</Label>
              <Select value={formRole} onValueChange={(v: string | null) => setFormRole(v ?? 'correction')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="correction">Correction Officer</SelectItem>
                  <SelectItem value="teacher">Teacher (legacy)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSave} className="w-full rounded-xl">{editId ? 'Update' : 'Add Teacher'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
