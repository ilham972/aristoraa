'use client';

// Phase 4 (§4.4) — parent share. One tap renders a PNG of the student's own
// track as a simple railway: their position ("You are here"), stations cleared,
// the target exam, and any promotion history — Aristora brand, dark-navy/teal.
// Reuses the /leaderboard canvas pattern. Sized for a phone screen / WhatsApp.

import { useCallback } from 'react';
import { useQuery } from 'convex/react';
import { Share2 } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { findUnit } from '@/lib/curriculum-data';
import { toast } from 'sonner';

const BRAND = 'Aristora';

type ShareData = {
  hasTrack: boolean;
  trackName: string | null;
  targetGrade: number | null;
  targetTerm: number | null;
  orderedUnitIds: string[];
  clearedUnitIds: string[];
  currentUnitId: string | null;
  clearedUnits: number;
  totalUnits: number;
  isComplete: boolean;
  nextExamDate: string | null;
  promotions: Array<{ at: number; fromTrackName: string | null; toTrackName: string }>;
};

export function ParentShareButton({
  studentId,
  studentName,
}: {
  studentId: Id<'students'>;
  studentName: string;
}) {
  const data = useQuery(api.learningEngine.map.studentShareData, { studentId }) as
    | ShareData
    | null
    | undefined;

  const onShare = useCallback(() => {
    if (!data || !data.hasTrack) return;
    drawParentPng(data, studentName);
  }, [data, studentName]);

  const disabled = data === undefined || data === null || !data.hasTrack;

  return (
    <button
      onClick={onShare}
      disabled={disabled}
      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
    >
      <Share2 className="w-4 h-4" />
      {data === undefined
        ? 'Loading…'
        : data && !data.hasTrack
        ? 'No track to share'
        : 'Share for parent (PNG)'}
    </button>
  );
}

function drawParentPng(data: ShareData, studentName: string) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = 800;
  const promoCount = Math.min(data.promotions.length, 4);
  const height = 430 + promoCount * 26;
  canvas.width = width;
  canvas.height = height;

  // Background + teal top rule.
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#0B1120');
  grad.addColorStop(1, '#131D2E');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#14B8A6';
  ctx.fillRect(0, 0, width, 4);

  // Brand + title.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText(BRAND, width / 2, 48);
  ctx.fillStyle = '#14B8A6';
  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.fillText(`${studentName}’s Learning Journey`, width / 2, 84);
  if (data.trackName) {
    ctx.fillStyle = '#7B8FA3';
    ctx.font = '15px Arial, sans-serif';
    ctx.fillText(data.trackName, width / 2, 110);
  }

  // Railway line.
  const stations = data.orderedUnitIds;
  const n = Math.max(stations.length, 1);
  const x0 = 80;
  const x1 = width - 80;
  const lineY = 200;
  const gap = n > 1 ? (x1 - x0) / (n - 1) : 0;
  const clearedSet = new Set(data.clearedUnitIds);
  const curIdx = data.isComplete
    ? n - 1
    : data.currentUnitId
    ? stations.indexOf(data.currentUnitId)
    : -1;
  const r = Math.max(5, Math.min(11, gap * 0.32));

  // Base (muted) line then traveled (teal) portion.
  ctx.strokeStyle = 'rgba(123,143,163,0.4)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, lineY);
  ctx.lineTo(stations.length > 1 ? x1 : x0 + 1, lineY);
  ctx.stroke();
  if (curIdx >= 0) {
    ctx.strokeStyle = '#14B8A6';
    ctx.beginPath();
    ctx.moveTo(x0, lineY);
    ctx.lineTo(x0 + curIdx * gap, lineY);
    ctx.stroke();
  }

  // Stations.
  stations.forEach((uid, i) => {
    const x = x0 + i * gap;
    const cleared = clearedSet.has(uid);
    const current = uid === data.currentUnitId;
    ctx.beginPath();
    ctx.arc(x, lineY, r, 0, Math.PI * 2);
    if (cleared) {
      ctx.fillStyle = '#14B8A6';
      ctx.fill();
    } else if (current) {
      ctx.fillStyle = '#0B1120';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#14B8A6';
      ctx.stroke();
    } else {
      ctx.fillStyle = '#131D2E';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#475569';
      ctx.stroke();
    }
  });

  // "You are here" marker.
  if (curIdx >= 0) {
    const x = x0 + curIdx * gap;
    ctx.fillStyle = '#14B8A6';
    ctx.font = 'bold 13px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('▲', x, lineY + 28);
    ctx.fillText(data.isComplete ? 'Completed!' : 'You are here', x, lineY + 46);
    const cur = data.currentUnitId ? findUnit(data.currentUnitId) : null;
    if (cur && !data.isComplete) {
      ctx.fillStyle = '#E8EDF2';
      ctx.font = '13px Arial, sans-serif';
      const name = cur.unit.name.length > 60 ? cur.unit.name.slice(0, 57) + '…' : cur.unit.name;
      ctx.fillText(name, width / 2, lineY + 72);
    }
  }

  // Progress + target exam.
  let y = lineY + 110;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 20px Arial, sans-serif';
  ctx.fillText(`${data.clearedUnits} / ${data.totalUnits} stations cleared`, width / 2, y);
  y += 32;
  if (data.targetGrade != null && data.targetTerm != null) {
    ctx.fillStyle = '#7B8FA3';
    ctx.font = '15px Arial, sans-serif';
    const examTxt =
      `Target: Grade ${data.targetGrade} · Term ${data.targetTerm} exam` +
      (data.nextExamDate ? ` — ${data.nextExamDate}` : '');
    ctx.fillText(examTxt, width / 2, y);
    y += 30;
  }

  // Promotion history.
  if (promoCount > 0) {
    ctx.fillStyle = '#FBBF24';
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillText('Promotions', width / 2, y);
    y += 24;
    ctx.font = '13px Arial, sans-serif';
    ctx.fillStyle = '#E8EDF2';
    data.promotions.slice(-promoCount).forEach((p) => {
      const d = new Date(p.at).toLocaleDateString();
      const from = p.fromTrackName ? `${p.fromTrackName} → ` : '';
      ctx.fillText(`${from}${p.toTrackName} · ${d}`, width / 2, y);
      y += 24;
    });
  }

  // Footer.
  ctx.fillStyle = '#7B8FA3';
  ctx.font = '11px Arial, sans-serif';
  ctx.fillText(`Generated ${new Date().toLocaleDateString()}`, width / 2, height - 16);

  const safe = studentName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const link = document.createElement('a');
  link.download = `journey-${safe}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  toast.success('Parent card downloaded!');
}
