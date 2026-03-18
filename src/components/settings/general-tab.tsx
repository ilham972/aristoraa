'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/convex';
import { toast } from 'sonner';

export function GeneralTab() {
  const [allowManualSlot, setAllowManualSlot] = useState(false);

  const settings = useQuery(api.settings.get);
  const saveSettingsMutation = useMutation(api.settings.save);

  useEffect(() => {
    if (settings) {
      setAllowManualSlot(!!settings.allowManualSlotSelection);
    }
  }, [settings]);

  if (!settings) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-20 bg-muted rounded-xl" />
      </div>
    );
  }

  return (
    <Card className="border-border/50 mb-3">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium text-foreground">Manual Slot Selection</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Allow teachers to pick any slot instead of auto-detecting</p>
          </div>
          <button
            onClick={async () => {
              const newVal = !allowManualSlot;
              setAllowManualSlot(newVal);
              await saveSettingsMutation({
                allowManualSlotSelection: newVal,
              });
              toast.success(newVal ? 'Manual slot selection enabled' : 'Manual slot selection disabled');
            }}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${allowManualSlot ? 'bg-primary' : 'bg-muted-foreground/30'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${allowManualSlot ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
