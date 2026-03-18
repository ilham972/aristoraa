'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Plus, Trash2, ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/convex';
import { toast } from 'sonner';
import type { Id } from '@/lib/convex';

export function CentersTab() {
  const [expandedCenter, setExpandedCenter] = useState<string | null>(null);
  const [addCenterOpen, setAddCenterOpen] = useState(false);
  const [editCenterId, setEditCenterId] = useState<Id<"centers"> | null>(null);
  const [formName, setFormName] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formDistrict, setFormDistrict] = useState('');
  const [formRoad, setFormRoad] = useState('');
  const [newRoomName, setNewRoomName] = useState('');

  const centers = useQuery(api.centers.list);
  const rooms = useQuery(api.rooms.list);

  const addCenterMutation = useMutation(api.centers.add);
  const updateCenterMutation = useMutation(api.centers.update);
  const removeCenterMutation = useMutation(api.centers.remove);
  const addRoomMutation = useMutation(api.rooms.add);
  const removeRoomMutation = useMutation(api.rooms.remove);

  if (!centers || !rooms) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2].map(i => <div key={i} className="h-20 bg-muted rounded-xl" />)}
      </div>
    );
  }

  const resetForm = () => {
    setFormName('');
    setFormCity('');
    setFormDistrict('');
    setFormRoad('');
  };

  const handleAddCenter = async () => {
    if (!formName.trim()) { toast.error('Name is required'); return; }
    await addCenterMutation({ name: formName.trim(), city: formCity.trim(), district: formDistrict.trim(), road: formRoad.trim() });
    toast.success('Center added');
    setAddCenterOpen(false);
    resetForm();
  };

  const handleUpdateCenter = async () => {
    if (!editCenterId || !formName.trim()) return;
    await updateCenterMutation({ id: editCenterId, name: formName.trim(), city: formCity.trim(), district: formDistrict.trim(), road: formRoad.trim() });
    toast.success('Center updated');
    setEditCenterId(null);
    resetForm();
  };

  const handleDeleteCenter = async (id: Id<"centers">) => {
    if (confirm('Delete this center and all its rooms, slots, and assignments?')) {
      await removeCenterMutation({ id });
      toast.success('Center deleted');
      if (expandedCenter === id) setExpandedCenter(null);
    }
  };

  const handleAddRoom = async (centerId: Id<"centers">) => {
    if (!newRoomName.trim()) return;
    await addRoomMutation({ centerId, name: newRoomName.trim() });
    toast.success('Room added');
    setNewRoomName('');
  };

  const handleDeleteRoom = async (id: Id<"rooms">) => {
    if (confirm('Delete this room and all its time slots?')) {
      await removeRoomMutation({ id });
      toast.success('Room deleted');
    }
  };

  const openEdit = (center: typeof centers[0]) => {
    setEditCenterId(center._id);
    setFormName(center.name);
    setFormCity(center.city);
    setFormDistrict(center.district);
    setFormRoad(center.road);
  };

  return (
    <>
      {centers.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">No centers yet</p>
            <Button onClick={() => { resetForm(); setAddCenterOpen(true); }} className="rounded-xl gap-1.5">
              <Plus className="w-4 h-4" />
              Add Center
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {centers.map((center: typeof centers[0]) => {
            const centerRooms = rooms.filter((r: typeof rooms[0]) => r.centerId === center._id);
            const isExpanded = expandedCenter === center._id;
            return (
              <Card key={center._id} className="border-border/50">
                <CardContent className="p-0">
                  <div
                    role="button"
                    tabIndex={0}
                    className="w-full p-3.5 flex items-center gap-3 text-left cursor-pointer"
                    onClick={() => setExpandedCenter(isExpanded ? null : center._id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedCenter(isExpanded ? null : center._id); } }}
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground text-sm">{center.name}</p>
                      <p className="text-xs text-muted-foreground">{center.road}, {center.district}, {center.city}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{centerRooms.length} room{centerRooms.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon-xs" onClick={() => openEdit(center)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => handleDeleteCenter(center._id)} className="text-destructive hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3.5 pb-3.5 border-t border-border/50">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-2">Rooms</p>
                      {centerRooms.length > 0 && (
                        <div className="space-y-1 mb-2">
                          {centerRooms.map((room: typeof centerRooms[0]) => (
                            <div key={room._id} className="flex items-center justify-between py-2 px-3 bg-muted rounded-lg">
                              <span className="text-sm text-foreground">{room.name}</span>
                              <button
                                onClick={() => handleDeleteRoom(room._id)}
                                className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Input
                          value={newRoomName}
                          onChange={e => setNewRoomName(e.target.value)}
                          placeholder="Room name"
                          className="flex-1"
                          onKeyDown={e => { if (e.key === 'Enter') handleAddRoom(center._id); }}
                        />
                        <Button onClick={() => handleAddRoom(center._id)} variant="outline" size="sm" className="rounded-xl">Add</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <Button onClick={() => { resetForm(); setAddCenterOpen(true); }} variant="outline" className="w-full rounded-xl gap-1.5 mt-2">
            <Plus className="w-4 h-4" />
            Add Center
          </Button>
        </div>
      )}

      {/* Add Center Dialog */}
      <Dialog open={addCenterOpen} onOpenChange={(open) => { setAddCenterOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>Add Center</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Name *</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Center name" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">City</Label>
              <Input value={formCity} onChange={e => setFormCity(e.target.value)} placeholder="City" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">District</Label>
              <Input value={formDistrict} onChange={e => setFormDistrict(e.target.value)} placeholder="District" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">Road</Label>
              <Input value={formRoad} onChange={e => setFormRoad(e.target.value)} placeholder="Road / Address" className="mt-1" />
            </div>
            <Button onClick={handleAddCenter} className="w-full rounded-xl">Add Center</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Center Dialog */}
      <Dialog open={!!editCenterId} onOpenChange={(open) => { if (!open) { setEditCenterId(null); resetForm(); } }}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>Edit Center</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Name *</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">City</Label>
              <Input value={formCity} onChange={e => setFormCity(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">District</Label>
              <Input value={formDistrict} onChange={e => setFormDistrict(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">Road</Label>
              <Input value={formRoad} onChange={e => setFormRoad(e.target.value)} className="mt-1" />
            </div>
            <Button onClick={handleUpdateCenter} className="w-full rounded-xl">Update Center</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
