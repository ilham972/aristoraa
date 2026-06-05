'use client';

import { useQuery, useMutation } from 'convex/react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { toast } from 'sonner';

export function TrackPicker({
  studentId,
  trackId,
}: {
  studentId: Id<'students'>;
  trackId?: Id<'tracks'> | null;
}) {
  const tracks = useQuery(api.learningEngine.tracks.listTracks);
  const setStudentTrack = useMutation(api.learningEngine.tracks.setStudentTrack);

  return (
    <select
      value={trackId ?? ''}
      onChange={async (e) => {
        const v = e.target.value;
        try {
          await setStudentTrack({
            studentId,
            trackId: v ? (v as Id<'tracks'>) : null,
          });
          toast.success('Track updated');
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed');
        }
      }}
      className="px-2 py-1 rounded-md bg-muted text-xs border border-border max-w-[10rem]"
    >
      <option value="">No track (legacy)</option>
      {tracks?.map((t) => (
        <option key={t._id} value={t._id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
