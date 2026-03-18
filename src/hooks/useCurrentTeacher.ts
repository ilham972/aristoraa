'use client';

import { useQuery } from 'convex/react';
import { api } from '@/lib/convex';

export function useCurrentTeacher() {
  const teacher = useQuery(api.teachers.getCurrent);
  const isLoading = teacher === undefined;

  return {
    teacher,
    role: teacher?.role ?? null,
    isLoading,
  };
}
