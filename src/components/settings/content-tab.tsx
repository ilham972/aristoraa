'use client';

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, BookOpen, Image as ImageIcon,
  RotateCcw, Pencil, FileUp, FileText,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PaperOverridesEditor } from './paper-overrides-editor';
import { ImageOptimizerCard } from './image-optimizer-card';
import { api } from '@/lib/convex';
import { toast } from 'sonner';
import type { Id } from '@/lib/convex';

type ViewLevel = 'grades' | 'books' | 'pages';
type ContentSource = 'textbooks' | 'past-papers';
type PaperViewLevel = 'grades' | 'papers' | 'pages';

type PastPaperDoc = {
  _id: Id<"pastPapers">;
  grade: number;
  term: number;
  year: number;
  schoolName?: string;
  totalPages: number;
  useAsTrainingSignal: boolean;
  isHoldout: boolean;
  totalMarks?: number;
  uploadedAt: number;
  partOverrides?: Array<{
    partCode: string;
    questionCount?: number;
    marksPerQuestion?: number;
    requiredCount?: number;
  }>;
};

const GRADES = [6, 7, 8, 9, 10, 11];
const PART_LABELS = ['Part 1', 'Part 2', 'Part 3'];
const CURRENT_YEAR = new Date().getFullYear();

export function ContentTab() {
  // === SOURCE TOGGLE ===
  const [contentSource, setContentSource] = useState<ContentSource>('textbooks');

  // === TEXTBOOK STATE ===
  const [viewLevel, setViewLevel] = useState<ViewLevel>('grades');
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [selectedTextbook, setSelectedTextbook] = useState<{
    _id: Id<"textbooks">;
    grade: number;
    part: number;
    totalPages: number;
    startUnit?: number;
    endUnit?: number;
  } | null>(null);

  const [bookFormOpen, setBookFormOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<{
    _id: Id<"textbooks">;
    part: number;
    totalPages: number;
    startUnit?: number;
    endUnit?: number;
  } | null>(null);
  const [formPages, setFormPages] = useState('');
  const [formStartUnit, setFormStartUnit] = useState('');
  const [formEndUnit, setFormEndUnit] = useState('');

  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [capturingPage, setCapturingPage] = useState<number | null>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState({ current: 0, total: 0 });

  // === PAST-PAPER STATE ===
  const [paperViewLevel, setPaperViewLevel] = useState<PaperViewLevel>('grades');
  const [selectedPaperGrade, setSelectedPaperGrade] = useState<number | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<PastPaperDoc | null>(null);

  const [paperFormOpen, setPaperFormOpen] = useState(false);
  const [editingPaper, setEditingPaper] = useState<PastPaperDoc | null>(null);
  const [paperFormTerm, setPaperFormTerm] = useState<1 | 2 | 3>(1);
  const [paperFormYear, setPaperFormYear] = useState('');
  const [paperFormSchool, setPaperFormSchool] = useState('');
  const [paperFormIsOwnPaper, setPaperFormIsOwnPaper] = useState(true);
  const [paperFormTotalPages, setPaperFormTotalPages] = useState('');
  const [paperFormTotalMarks, setPaperFormTotalMarks] = useState('');
  const [paperFormUseAsTraining, setPaperFormUseAsTraining] = useState(true);
  const [paperFormIsHoldout, setPaperFormIsHoldout] = useState(false);

  const [paperCapturingPage, setPaperCapturingPage] = useState<number | null>(null);
  const [paperPreviewPage, setPaperPreviewPage] = useState<number | null>(null);
  const [paperPdfUploading, setPaperPdfUploading] = useState(false);
  const [paperPdfProgress, setPaperPdfProgress] = useState({ current: 0, total: 0 });

  // === REFS ===
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const paperFileInputRef = useRef<HTMLInputElement>(null);
  const paperPdfInputRef = useRef<HTMLInputElement>(null);

  // === TEXTBOOK QUERIES/MUTATIONS ===
  const allTextbooks = useQuery(api.textbooks.list);
  const capturedPageNumbers = useQuery(
    api.textbookPages.getCapturedPageNumbers,
    selectedTextbook ? { textbookId: selectedTextbook._id } : 'skip'
  );
  const createTextbook = useMutation(api.textbooks.create);
  const updateTextbook = useMutation(api.textbooks.update);
  const removeTextbook = useMutation(api.textbooks.remove);
  const generateUploadUrl = useMutation(api.textbookPages.generateUploadUrl);
  const savePage = useMutation(api.textbookPages.savePage);
  const removePage = useMutation(api.textbookPages.removePage);
  const getPageImage = useQuery(
    api.textbookPages.getPageImage,
    selectedTextbook && previewPage !== null
      ? { textbookId: selectedTextbook._id, pageNumber: previewPage }
      : 'skip'
  );

  // === PAST-PAPER QUERIES/MUTATIONS ===
  const allPastPapers = useQuery(api.pastPapers.list);
  const paperCapturedPageNumbers = useQuery(
    api.pastPaperPages.getCapturedPageNumbers,
    selectedPaper ? { pastPaperId: selectedPaper._id } : 'skip'
  );
  const paperPageImage = useQuery(
    api.pastPaperPages.getPageImage,
    selectedPaper && paperPreviewPage !== null
      ? { pastPaperId: selectedPaper._id, pageNumber: paperPreviewPage }
      : 'skip'
  );
  const createPastPaper = useMutation(api.pastPapers.create);
  const updatePastPaper = useMutation(api.pastPapers.update);
  const removePastPaper = useMutation(api.pastPapers.remove);
  const paperGenerateUploadUrl = useMutation(api.pastPaperPages.generateUploadUrl);
  const paperSavePage = useMutation(api.pastPaperPages.savePage);
  const paperRemovePage = useMutation(api.pastPaperPages.removePage);

  // === TEXTBOOK HANDLERS ===
  const handleBack = () => {
    if (viewLevel === 'pages') {
      setViewLevel('books');
      setSelectedTextbook(null);
      setPreviewPage(null);
    } else if (viewLevel === 'books') {
      setViewLevel('grades');
      setSelectedGrade(null);
    }
  };

  const openAddBookForm = () => {
    setEditingBook(null);
    setFormPages('');
    setFormStartUnit('');
    setFormEndUnit('');
    setBookFormOpen(true);
  };

  const openEditBookForm = (book: { _id: Id<"textbooks">; part: number; totalPages: number; startUnit?: number; endUnit?: number }) => {
    setEditingBook(book);
    setFormPages(String(book.totalPages));
    setFormStartUnit(book.startUnit ? String(book.startUnit) : '');
    setFormEndUnit(book.endUnit ? String(book.endUnit) : '');
    setBookFormOpen(true);
  };

  const handleSaveBook = async () => {
    const pages = parseInt(formPages);
    if (isNaN(pages) || pages <= 0) {
      toast.error('Enter a valid page count');
      return;
    }
    if (!selectedGrade) return;

    const startUnit = formStartUnit.trim() ? parseInt(formStartUnit) : undefined;
    const endUnit = formEndUnit.trim() ? parseInt(formEndUnit) : undefined;

    if (startUnit !== undefined && isNaN(startUnit)) {
      toast.error('Enter a valid start unit number');
      return;
    }
    if (endUnit !== undefined && isNaN(endUnit)) {
      toast.error('Enter a valid end unit number');
      return;
    }
    if (startUnit !== undefined && endUnit !== undefined && startUnit > endUnit) {
      toast.error('Start unit must be ≤ end unit');
      return;
    }

    try {
      if (editingBook) {
        await updateTextbook({ id: editingBook._id, totalPages: pages, startUnit, endUnit });
        toast.success(`Part ${editingBook.part} updated`);
      } else {
        const gradeBooks = (allTextbooks || []).filter((t) => t.grade === selectedGrade);
        const nextPart = gradeBooks.length + 1;
        if (nextPart > 3) {
          toast.error('Maximum 3 books per grade');
          return;
        }
        await createTextbook({ grade: selectedGrade, part: nextPart, totalPages: pages, startUnit, endUnit });
        toast.success(`Grade ${selectedGrade} Part ${nextPart} created`);
      }
      setBookFormOpen(false);
      setEditingBook(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save book';
      toast.error(message);
    }
  };

  const handleDeleteBook = async (id: Id<"textbooks">) => {
    if (confirm('Delete this book and all captured pages?')) {
      await removeTextbook({ id });
      toast.success('Book deleted');
    }
  };

  const handlePageTap = useCallback((pageNum: number) => {
    const cap = capturedPageNumbers || [];
    if (cap.includes(pageNum)) {
      setPreviewPage(pageNum);
    } else {
      setCapturingPage(pageNum);
      setTimeout(() => { fileInputRef.current?.click(); }, 50);
    }
  }, [capturedPageNumbers]);

  const handleFileCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTextbook || capturingPage === null) return;
    try {
      toast.loading('Uploading page...', { id: 'upload' });
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!result.ok) throw new Error('Upload failed');
      const { storageId } = await result.json();
      await savePage({ textbookId: selectedTextbook._id, pageNumber: capturingPage, storageId });
      toast.success(`Page ${capturingPage} captured!`, { id: 'upload' });
    } catch {
      toast.error('Failed to upload page', { id: 'upload' });
    } finally {
      setCapturingPage(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [selectedTextbook, capturingPage, generateUploadUrl, savePage]);

  const handleDeletePage = async () => {
    if (!selectedTextbook || previewPage === null) return;
    if (confirm(`Delete captured image for page ${previewPage}?`)) {
      await removePage({ textbookId: selectedTextbook._id, pageNumber: previewPage });
      toast.success('Page deleted');
      setPreviewPage(null);
    }
  };

  const handleRecapture = () => {
    if (previewPage === null) return;
    setCapturingPage(previewPage);
    setPreviewPage(null);
    setTimeout(() => { fileInputRef.current?.click(); }, 50);
  };

  const handlePdfUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTextbook) return;
    if (pdfInputRef.current) pdfInputRef.current.value = '';

    setPdfUploading(true);
    setPdfProgress({ current: 0, total: 0 });

    try {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = Math.min(pdf.numPages, selectedTextbook.totalPages);
      setPdfProgress({ current: 0, total: totalPages });
      toast.loading(`Processing PDF: 0/${totalPages} pages...`, { id: 'pdf-upload' });

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const scale = 2;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
        const blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.85);
        });
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        });
        if (!result.ok) throw new Error(`Upload failed for page ${i}`);
        const { storageId } = await result.json();
        await savePage({ textbookId: selectedTextbook._id, pageNumber: i, storageId });
        setPdfProgress({ current: i, total: totalPages });
        toast.loading(`Processing PDF: ${i}/${totalPages} pages...`, { id: 'pdf-upload' });
      }
      toast.success(`All ${totalPages} pages uploaded!`, { id: 'pdf-upload' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF processing failed';
      toast.error(msg, { id: 'pdf-upload' });
    } finally {
      setPdfUploading(false);
      setPdfProgress({ current: 0, total: 0 });
    }
  }, [selectedTextbook, generateUploadUrl, savePage]);

  // === PAST-PAPER HANDLERS ===
  const handlePaperBack = () => {
    if (paperViewLevel === 'pages') {
      setPaperViewLevel('papers');
      setSelectedPaper(null);
      setPaperPreviewPage(null);
    } else if (paperViewLevel === 'papers') {
      setPaperViewLevel('grades');
      setSelectedPaperGrade(null);
    }
  };

  const openAddPaperForm = () => {
    setEditingPaper(null);
    setPaperFormTerm(1);
    setPaperFormYear('');
    setPaperFormSchool('');
    setPaperFormIsOwnPaper(true);
    setPaperFormTotalPages('');
    setPaperFormTotalMarks('');
    setPaperFormUseAsTraining(true);
    setPaperFormIsHoldout(false);
    setPaperFormOpen(true);
  };

  const openEditPaperForm = (paper: PastPaperDoc) => {
    setEditingPaper(paper);
    setPaperFormTerm(paper.term as 1 | 2 | 3);
    setPaperFormYear(String(paper.year));
    setPaperFormSchool(paper.schoolName ?? '');
    setPaperFormIsOwnPaper(!paper.schoolName);
    setPaperFormTotalPages(String(paper.totalPages));
    setPaperFormTotalMarks(paper.totalMarks ? String(paper.totalMarks) : '');
    setPaperFormUseAsTraining(paper.useAsTrainingSignal);
    setPaperFormIsHoldout(paper.isHoldout);
    setPaperFormOpen(true);
  };

  const handleSavePaper = async () => {
    const totalPages = parseInt(paperFormTotalPages);
    if (isNaN(totalPages) || totalPages < 1) {
      toast.error('Enter a valid page count');
      return;
    }
    const rawMarks = paperFormTotalMarks.trim();
    const totalMarks = rawMarks ? parseInt(rawMarks) : undefined;
    if (totalMarks !== undefined && (isNaN(totalMarks) || totalMarks < 1)) {
      toast.error('Enter a valid total marks');
      return;
    }
    const useAsTrainingSignal = paperFormIsHoldout ? false : paperFormUseAsTraining;

    try {
      if (editingPaper) {
        const patch: {
          id: Id<"pastPapers">;
          totalPages: number;
          useAsTrainingSignal: boolean;
          isHoldout: boolean;
          totalMarks?: number;
          schoolName?: string;
        } = {
          id: editingPaper._id,
          totalPages,
          useAsTrainingSignal,
          isHoldout: paperFormIsHoldout,
        };
        if (totalMarks !== undefined) patch.totalMarks = totalMarks;
        if (!paperFormIsOwnPaper && paperFormSchool.trim()) patch.schoolName = paperFormSchool.trim();
        await updatePastPaper(patch);
        toast.success('Paper updated');
      } else {
        const year = parseInt(paperFormYear);
        if (isNaN(year) || year < 2010 || year > CURRENT_YEAR + 1) {
          toast.error(`Year must be between 2010 and ${CURRENT_YEAR + 1}`);
          return;
        }
        if (!selectedPaperGrade) return;
        if (!paperFormIsOwnPaper && !paperFormSchool.trim()) {
          toast.error('Enter a school name or select "Own paper"');
          return;
        }
        await createPastPaper({
          grade: selectedPaperGrade,
          term: paperFormTerm,
          year,
          schoolName: paperFormIsOwnPaper ? undefined : paperFormSchool.trim(),
          totalPages,
          totalMarks,
          useAsTrainingSignal,
          isHoldout: paperFormIsHoldout,
        });
        toast.success('Paper added');
      }
      setPaperFormOpen(false);
      setEditingPaper(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save paper';
      toast.error(message);
    }
  };

  const handleDeletePaper = async (paper: PastPaperDoc) => {
    const label = paper.schoolName
      ? `Grade ${paper.grade} T${paper.term} ${paper.year} · ${paper.schoolName}`
      : `Grade ${paper.grade} T${paper.term} ${paper.year} · Own paper`;
    if (confirm(`Delete "${label}" and all its captured pages and crops?`)) {
      await removePastPaper({ id: paper._id });
      toast.success('Paper deleted');
    }
  };

  const handlePaperPageTap = useCallback((pageNum: number) => {
    const cap = paperCapturedPageNumbers || [];
    if (cap.includes(pageNum)) {
      setPaperPreviewPage(pageNum);
    } else {
      setPaperCapturingPage(pageNum);
      setTimeout(() => { paperFileInputRef.current?.click(); }, 50);
    }
  }, [paperCapturedPageNumbers]);

  const handlePaperFileCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPaper || paperCapturingPage === null) return;
    try {
      toast.loading('Uploading page...', { id: 'paper-upload' });
      const uploadUrl = await paperGenerateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!result.ok) throw new Error('Upload failed');
      const { storageId } = await result.json();
      await paperSavePage({ pastPaperId: selectedPaper._id, pageNumber: paperCapturingPage, storageId });
      toast.success(`Page ${paperCapturingPage} captured!`, { id: 'paper-upload' });
    } catch {
      toast.error('Failed to upload page', { id: 'paper-upload' });
    } finally {
      setPaperCapturingPage(null);
      if (paperFileInputRef.current) paperFileInputRef.current.value = '';
    }
  }, [selectedPaper, paperCapturingPage, paperGenerateUploadUrl, paperSavePage]);

  const handleDeletePaperPage = async () => {
    if (!selectedPaper || paperPreviewPage === null) return;
    if (confirm(`Delete captured image for page ${paperPreviewPage}?`)) {
      await paperRemovePage({ pastPaperId: selectedPaper._id, pageNumber: paperPreviewPage });
      toast.success('Page deleted');
      setPaperPreviewPage(null);
    }
  };

  const handleRecapturePaperPage = () => {
    if (paperPreviewPage === null) return;
    setPaperCapturingPage(paperPreviewPage);
    setPaperPreviewPage(null);
    setTimeout(() => { paperFileInputRef.current?.click(); }, 50);
  };

  const handlePaperPdfUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPaper) return;
    if (paperPdfInputRef.current) paperPdfInputRef.current.value = '';

    setPaperPdfUploading(true);
    setPaperPdfProgress({ current: 0, total: 0 });

    try {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = Math.min(pdf.numPages, selectedPaper.totalPages);
      setPaperPdfProgress({ current: 0, total: totalPages });
      toast.loading(`Processing PDF: 0/${totalPages} pages...`, { id: 'paper-pdf-upload' });

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const scale = 2;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
        const blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.85);
        });
        const uploadUrl = await paperGenerateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        });
        if (!result.ok) throw new Error(`Upload failed for page ${i}`);
        const { storageId } = await result.json();
        await paperSavePage({ pastPaperId: selectedPaper._id, pageNumber: i, storageId });
        setPaperPdfProgress({ current: i, total: totalPages });
        toast.loading(`Processing PDF: ${i}/${totalPages} pages...`, { id: 'paper-pdf-upload' });
      }
      toast.success(`All ${totalPages} pages uploaded!`, { id: 'paper-pdf-upload' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF processing failed';
      toast.error(msg, { id: 'paper-pdf-upload' });
    } finally {
      setPaperPdfUploading(false);
      setPaperPdfProgress({ current: 0, total: 0 });
    }
  }, [selectedPaper, paperGenerateUploadUrl, paperSavePage]);

  // === LOADING ===
  if (!allTextbooks || allPastPapers === undefined) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-xl" />)}
      </div>
    );
  }

  // === DERIVED VALUES ===
  const textbookBreadcrumb = () => {
    const parts: string[] = [];
    if (selectedGrade !== null) parts.push(`Grade ${selectedGrade}`);
    if (selectedTextbook) parts.push(`Part ${selectedTextbook.part}`);
    return parts.join(' > ');
  };

  const paperBreadcrumb = () => {
    const parts: string[] = [];
    if (selectedPaperGrade !== null) parts.push(`Grade ${selectedPaperGrade}`);
    if (selectedPaper) {
      const label = selectedPaper.schoolName
        ? `${selectedPaper.year} T${selectedPaper.term} · ${selectedPaper.schoolName}`
        : `${selectedPaper.year} T${selectedPaper.term} · Own paper`;
      parts.push(label);
    }
    return parts.join(' > ');
  };

  const gradeBooks = selectedGrade !== null
    ? allTextbooks.filter((t) => t.grade === selectedGrade).sort((a, b) => a.part - b.part)
    : [];

  const gradePapers = selectedPaperGrade !== null
    ? (allPastPapers as PastPaperDoc[])
        .filter((p) => p.grade === selectedPaperGrade)
        .sort((a, b) => b.year - a.year || a.term - b.term || (a.schoolName ?? '').localeCompare(b.schoolName ?? ''))
    : [];

  const captured = new Set(capturedPageNumbers || []);
  const paperCaptured = new Set(paperCapturedPageNumbers || []);

  const paperLabel = (p: PastPaperDoc) =>
    p.schoolName ? `${p.year} · T${p.term} · ${p.schoolName}` : `${p.year} · T${p.term} · Own paper`;

  return (
    <>
      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileCapture} />
      <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={handlePdfUpload} />
      <input ref={paperFileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePaperFileCapture} />
      <input ref={paperPdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={handlePaperPdfUpload} />

      {/* One-tap thumbnail backfill for sheet views (perf phase 6). */}
      <ImageOptimizerCard />

      {/* Source toggle */}
      <div className="flex gap-1 mb-4 p-1 bg-muted rounded-xl">
        <button
          onClick={() => setContentSource('textbooks')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
            contentSource === 'textbooks'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Textbooks
        </button>
        <button
          onClick={() => setContentSource('past-papers')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
            contentSource === 'past-papers'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Past Papers
        </button>
      </div>

      {/* ========== TEXTBOOKS ========== */}
      {contentSource === 'textbooks' && (
        <>
          {viewLevel !== 'grades' && (
            <div className="flex items-center gap-2 mb-3">
              <button className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-muted transition-colors" onClick={handleBack}>
                <ChevronLeft className="w-5 h-5 text-muted-foreground" />
              </button>
              <p className="text-xs text-muted-foreground">{textbookBreadcrumb()}</p>
            </div>
          )}

          {viewLevel === 'grades' && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground mb-2">Select a grade to manage its textbook pages</p>
              {GRADES.map(grade => {
                const books = allTextbooks.filter(t => t.grade === grade);
                const totalPages = books.reduce((s, b) => s + b.totalPages, 0);
                return (
                  <Card
                    key={grade}
                    className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]"
                    onClick={() => { setSelectedGrade(grade); setViewLevel('books'); }}
                  >
                    <CardContent className="p-3.5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                          <BookOpen className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold text-foreground text-sm">Grade {grade}</p>
                          <p className="text-xs text-muted-foreground">
                            {books.length === 0
                              ? 'No books defined'
                              : `${books.length} book${books.length > 1 ? 's' : ''} · ${totalPages} pages`}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {viewLevel === 'books' && selectedGrade !== null && (
            <div className="space-y-1.5">
              {gradeBooks.map(book => (
                <Card
                  key={book._id}
                  className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]"
                  onClick={() => { setSelectedTextbook(book); setViewLevel('pages'); }}
                >
                  <CardContent className="p-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                        <span className="text-sm font-bold text-foreground">{book.part}</span>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-sm">{PART_LABELS[book.part - 1]}</p>
                        <p className="text-xs text-muted-foreground">
                          {book.totalPages} pages
                          {book.startUnit && book.endUnit
                            ? ` · Units ${book.startUnit}–${book.endUnit}`
                            : book.startUnit
                            ? ` · From unit ${book.startUnit}`
                            : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditBookForm(book); }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteBook(book._id); }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}

              {gradeBooks.length < 3 && (
                <Button variant="outline" size="sm" className="w-full rounded-xl mt-2 gap-1.5" onClick={openAddBookForm}>
                  <Plus className="w-3.5 h-3.5" />
                  Add Book (Part {gradeBooks.length + 1})
                </Button>
              )}

              {gradeBooks.length === 0 && (
                <div className="text-center py-8">
                  <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No books defined for Grade {selectedGrade}</p>
                  <p className="text-xs text-muted-foreground mt-1">Add a book to start capturing pages</p>
                </div>
              )}
            </div>
          )}

          {viewLevel === 'pages' && selectedTextbook && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Grade {selectedTextbook.grade} — {PART_LABELS[selectedTextbook.part - 1]}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {captured.size} / {selectedTextbook.totalPages} pages captured
                    {selectedTextbook.startUnit && selectedTextbook.endUnit
                      ? ` · Units ${selectedTextbook.startUnit}–${selectedTextbook.endUnit}`
                      : ''}
                  </p>
                </div>
                <Badge variant={captured.size === selectedTextbook.totalPages ? 'default' : 'secondary'} className="text-xs">
                  {Math.round((captured.size / selectedTextbook.totalPages) * 100)}%
                </Badge>
              </div>

              <div className="w-full h-2 bg-muted rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${(captured.size / selectedTextbook.totalPages) * 100}%` }}
                />
              </div>

              {pdfUploading ? (
                <div className="mb-4 rounded-xl bg-primary/10 border border-primary/20 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-primary">Uploading PDF...</span>
                    <span className="text-xs font-mono text-primary">{pdfProgress.current}/{pdfProgress.total}</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: pdfProgress.total > 0 ? `${(pdfProgress.current / pdfProgress.total) * 100}%` : '0%' }}
                    />
                  </div>
                </div>
              ) : (
                <Button variant="outline" size="sm" className="w-full rounded-xl mb-4 gap-1.5" onClick={() => pdfInputRef.current?.click()}>
                  <FileUp className="w-3.5 h-3.5" />
                  Upload PDF
                </Button>
              )}

              <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
                {Array.from({ length: selectedTextbook.totalPages }, (_, i) => i + 1).map(pageNum => {
                  const isCaptured = captured.has(pageNum);
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageTap(pageNum)}
                      className={`
                        aspect-square rounded-lg flex items-center justify-center text-xs font-mono font-medium
                        transition-all active:scale-95 relative
                        ${isCaptured
                          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                          : 'bg-muted text-muted-foreground border border-border hover:bg-accent hover:text-foreground'
                        }
                      `}
                    >
                      {pageNum}
                      {isCaptured && (
                        <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded bg-muted border border-border" />
                  <span>Not captured</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded bg-emerald-500/20 border border-emerald-500/30 relative">
                    <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                  </div>
                  <span>Captured</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ========== PAST PAPERS ========== */}
      {contentSource === 'past-papers' && (
        <>
          {paperViewLevel !== 'grades' && (
            <div className="flex items-center gap-2 mb-3">
              <button className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-muted transition-colors" onClick={handlePaperBack}>
                <ChevronLeft className="w-5 h-5 text-muted-foreground" />
              </button>
              <p className="text-xs text-muted-foreground">{paperBreadcrumb()}</p>
            </div>
          )}

          {paperViewLevel === 'grades' && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground mb-2">Select a grade to manage its past exam papers</p>
              {GRADES.map(grade => {
                const papers = (allPastPapers as PastPaperDoc[]).filter(p => p.grade === grade);
                return (
                  <Card
                    key={grade}
                    className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]"
                    onClick={() => { setSelectedPaperGrade(grade); setPaperViewLevel('papers'); }}
                  >
                    <CardContent className="p-3.5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                          <FileText className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold text-foreground text-sm">Grade {grade}</p>
                          <p className="text-xs text-muted-foreground">
                            {papers.length === 0 ? 'No papers uploaded' : `${papers.length} paper${papers.length > 1 ? 's' : ''}`}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {paperViewLevel === 'papers' && selectedPaperGrade !== null && (
            <div className="space-y-1.5">
              {gradePapers.map(paper => (
                <Card
                  key={paper._id}
                  className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]"
                  onClick={() => { setSelectedPaper(paper); setPaperViewLevel('pages'); }}
                >
                  <CardContent className="p-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-foreground">T{paper.term}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm truncate">{paperLabel(paper)}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-xs text-muted-foreground">{paper.totalPages} pages</span>
                          {paper.totalMarks && (
                            <span className="text-xs text-muted-foreground">· {paper.totalMarks} marks</span>
                          )}
                          {paper.isHoldout && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">Holdout</Badge>
                          )}
                          {paper.useAsTrainingSignal && !paper.isHoldout && (
                            <Badge className="text-[10px] px-1.5 py-0 h-4 bg-emerald-600">Training</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditPaperForm(paper); }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeletePaper(paper); }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}

              <Button variant="outline" size="sm" className="w-full rounded-xl mt-2 gap-1.5" onClick={openAddPaperForm}>
                <Plus className="w-3.5 h-3.5" />
                Add Paper
              </Button>

              {gradePapers.length === 0 && (
                <div className="text-center py-8">
                  <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No papers for Grade {selectedPaperGrade}</p>
                  <p className="text-xs text-muted-foreground mt-1">Add a past paper to start capturing pages</p>
                </div>
              )}
            </div>
          )}

          {paperViewLevel === 'pages' && selectedPaper && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-foreground truncate">{paperLabel(selectedPaper)}</p>
                  <p className="text-xs text-muted-foreground">
                    {paperCaptured.size} / {selectedPaper.totalPages} pages captured
                  </p>
                </div>
                <Badge variant={paperCaptured.size === selectedPaper.totalPages ? 'default' : 'secondary'} className="text-xs">
                  {Math.round((paperCaptured.size / selectedPaper.totalPages) * 100)}%
                </Badge>
              </div>

              <div className="w-full h-2 bg-muted rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${(paperCaptured.size / selectedPaper.totalPages) * 100}%` }}
                />
              </div>

              {paperPdfUploading ? (
                <div className="mb-4 rounded-xl bg-primary/10 border border-primary/20 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-primary">Uploading PDF...</span>
                    <span className="text-xs font-mono text-primary">{paperPdfProgress.current}/{paperPdfProgress.total}</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: paperPdfProgress.total > 0 ? `${(paperPdfProgress.current / paperPdfProgress.total) * 100}%` : '0%' }}
                    />
                  </div>
                </div>
              ) : (
                <Button variant="outline" size="sm" className="w-full rounded-xl mb-4 gap-1.5" onClick={() => paperPdfInputRef.current?.click()}>
                  <FileUp className="w-3.5 h-3.5" />
                  Upload PDF
                </Button>
              )}

              <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
                {Array.from({ length: selectedPaper.totalPages }, (_, i) => i + 1).map(pageNum => {
                  const isCaptured = paperCaptured.has(pageNum);
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePaperPageTap(pageNum)}
                      className={`
                        aspect-square rounded-lg flex items-center justify-center text-xs font-mono font-medium
                        transition-all active:scale-95 relative
                        ${isCaptured
                          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                          : 'bg-muted text-muted-foreground border border-border hover:bg-accent hover:text-foreground'
                        }
                      `}
                    >
                      {pageNum}
                      {isCaptured && (
                        <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded bg-muted border border-border" />
                  <span>Not captured</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded bg-emerald-500/20 border border-emerald-500/30 relative">
                    <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                  </div>
                  <span>Captured</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ========== ADD/EDIT BOOK DIALOG ========== */}
      <Dialog open={bookFormOpen} onOpenChange={(open) => { if (!open) { setBookFormOpen(false); setEditingBook(null); } }}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editingBook ? `Edit Part ${editingBook.part}` : `Add Book (Part ${gradeBooks.length + 1})`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Total pages</Label>
              <Input
                type="number"
                value={formPages}
                onChange={e => setFormPages(e.target.value)}
                placeholder="e.g., 200"
                className="mt-1 font-mono"
                min={1}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-sm">Start unit #</Label>
                <Input
                  type="number"
                  value={formStartUnit}
                  onChange={e => setFormStartUnit(e.target.value)}
                  placeholder="e.g., 1"
                  className="mt-1 font-mono"
                  min={1}
                />
              </div>
              <div>
                <Label className="text-sm">End unit #</Label>
                <Input
                  type="number"
                  value={formEndUnit}
                  onChange={e => setFormEndUnit(e.target.value)}
                  placeholder="e.g., 15"
                  className="mt-1 font-mono"
                  min={1}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Unit numbers help identify which book to open during class.
            </p>
            <Button onClick={handleSaveBook} className="w-full rounded-xl">
              {editingBook ? 'Save Changes' : 'Create Book'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ========== TEXTBOOK PAGE PREVIEW DIALOG ========== */}
      <Dialog open={previewPage !== null} onOpenChange={(open) => { if (!open) { setPreviewPage(null); } }}>
        <DialogContent className="max-w-sm mx-auto p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle className="text-sm">Page {previewPage}</DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-4">
            {getPageImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getPageImage}
                alt={`Page ${previewPage}`}
                className="w-full rounded-lg border border-border"
              />
            ) : (
              <div className="w-full aspect-[3/4] bg-muted rounded-lg flex items-center justify-center">
                <ImageIcon className="w-8 h-8 text-muted-foreground/40 animate-pulse" />
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <Button variant="outline" size="sm" className="flex-1 rounded-xl gap-1.5" onClick={handleRecapture}>
                <RotateCcw className="w-3.5 h-3.5" />
                Re-capture
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 rounded-xl gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleDeletePage}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ========== ADD/EDIT PAPER DIALOG ========== */}
      <Dialog open={paperFormOpen} onOpenChange={(open) => { if (!open) { setPaperFormOpen(false); setEditingPaper(null); } }}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editingPaper ? 'Edit Paper' : `Add Paper — Grade ${selectedPaperGrade}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Term (read-only in edit) */}
            <div>
              <Label className="text-sm">Term</Label>
              {editingPaper ? (
                <p className="mt-1 text-sm font-mono font-medium text-foreground">T{editingPaper.term}</p>
              ) : (
                <div className="flex gap-1 mt-1 p-1 bg-muted rounded-lg">
                  {([1, 2, 3] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setPaperFormTerm(t)}
                      className={`flex-1 py-1 text-xs font-medium rounded transition-all ${
                        paperFormTerm === t
                          ? 'bg-background shadow-sm text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      T{t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Year (read-only in edit) */}
            <div>
              <Label className="text-sm">Year</Label>
              {editingPaper ? (
                <p className="mt-1 text-sm font-mono font-medium text-foreground">{editingPaper.year}</p>
              ) : (
                <Input
                  type="number"
                  value={paperFormYear}
                  onChange={e => setPaperFormYear(e.target.value)}
                  placeholder={`e.g., ${CURRENT_YEAR - 2}`}
                  className="mt-1 font-mono"
                  min={2010}
                  max={CURRENT_YEAR + 1}
                />
              )}
            </div>

            {/* School */}
            <div>
              <Label className="text-sm">Source</Label>
              <label className="flex items-center gap-2 mt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={paperFormIsOwnPaper}
                  onChange={e => {
                    setPaperFormIsOwnPaper(e.target.checked);
                    if (e.target.checked) setPaperFormSchool('');
                  }}
                  className="rounded"
                  disabled={!!editingPaper}
                />
                <span className="text-sm text-foreground">Own paper (our centre)</span>
              </label>
              {!paperFormIsOwnPaper && (
                <Input
                  value={paperFormSchool}
                  onChange={e => setPaperFormSchool(e.target.value)}
                  placeholder="e.g., Western Province"
                  className="mt-1.5"
                />
              )}
            </div>

            {/* Total pages */}
            <div>
              <Label className="text-sm">Total pages</Label>
              <Input
                type="number"
                value={paperFormTotalPages}
                onChange={e => setPaperFormTotalPages(e.target.value)}
                placeholder="e.g., 8"
                className="mt-1 font-mono"
                min={1}
              />
            </div>

            {/* Total marks (optional) */}
            <div>
              <Label className="text-sm">Total marks <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                type="number"
                value={paperFormTotalMarks}
                onChange={e => setPaperFormTotalMarks(e.target.value)}
                placeholder="e.g., 100"
                className="mt-1 font-mono"
                min={1}
              />
            </div>

            {/* Flags */}
            <div className="space-y-2 pt-1">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={paperFormIsHoldout}
                  onChange={e => {
                    setPaperFormIsHoldout(e.target.checked);
                    if (e.target.checked) setPaperFormUseAsTraining(false);
                  }}
                  className="rounded mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">Holdout paper</p>
                  <p className="text-[11px] text-destructive">Current term's own paper — never feeds the algorithm</p>
                </div>
              </label>

              <label className={`flex items-start gap-2 ${paperFormIsHoldout ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={paperFormUseAsTraining && !paperFormIsHoldout}
                  onChange={e => { if (!paperFormIsHoldout) setPaperFormUseAsTraining(e.target.checked); }}
                  disabled={paperFormIsHoldout}
                  className="rounded mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">Use as training signal</p>
                  <p className="text-[11px] text-muted-foreground">Feeds the importance model (old papers and other schools)</p>
                </div>
              </label>
            </div>

            {/* Per-paper structure overrides — G6-G9 only, editing mode only */}
            {editingPaper && editingPaper.grade >= 6 && editingPaper.grade <= 9 && (
              <PaperOverridesEditor
                paperId={editingPaper._id}
                grade={editingPaper.grade}
                initialOverrides={editingPaper.partOverrides}
              />
            )}

            <Button onClick={handleSavePaper} className="w-full rounded-xl">
              {editingPaper ? 'Save Changes' : 'Add Paper'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ========== PAST-PAPER PAGE PREVIEW DIALOG ========== */}
      <Dialog open={paperPreviewPage !== null} onOpenChange={(open) => { if (!open) { setPaperPreviewPage(null); } }}>
        <DialogContent className="max-w-sm mx-auto p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle className="text-sm">Page {paperPreviewPage}</DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-4">
            {paperPageImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={paperPageImage}
                alt={`Page ${paperPreviewPage}`}
                className="w-full rounded-lg border border-border"
              />
            ) : (
              <div className="w-full aspect-[3/4] bg-muted rounded-lg flex items-center justify-center">
                <ImageIcon className="w-8 h-8 text-muted-foreground/40 animate-pulse" />
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <Button variant="outline" size="sm" className="flex-1 rounded-xl gap-1.5" onClick={handleRecapturePaperPage}>
                <RotateCcw className="w-3.5 h-3.5" />
                Re-capture
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 rounded-xl gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleDeletePaperPage}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
