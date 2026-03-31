'use client';

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { ChevronLeft, ChevronRight, Plus, Trash2, BookOpen, Camera, Image as ImageIcon, X, RotateCcw, Pencil } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/convex';
import { toast } from 'sonner';
import type { Id } from '@/lib/convex';

type ViewLevel = 'grades' | 'books' | 'pages';

const GRADES = [6, 7, 8, 9, 10, 11];
const PART_LABELS = ['Part 1', 'Part 2', 'Part 3'];

export function ContentTab() {
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

  // Add/Edit book form
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

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState<number | null>(null);

  const [capturingPage, setCapturingPage] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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
        // Update existing book
        await updateTextbook({
          id: editingBook._id,
          totalPages: pages,
          startUnit,
          endUnit,
        });
        toast.success(`Part ${editingBook.part} updated`);
      } else {
        // Create new book
        const gradeBooks = (allTextbooks || []).filter((t) => t.grade === selectedGrade);
        const nextPart = gradeBooks.length + 1;
        if (nextPart > 3) {
          toast.error('Maximum 3 books per grade');
          return;
        }
        await createTextbook({
          grade: selectedGrade,
          part: nextPart,
          totalPages: pages,
          startUnit,
          endUnit,
        });
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
    const captured = capturedPageNumbers || [];
    if (captured.includes(pageNum)) {
      // Show preview
      setPreviewPage(pageNum);
      setPreviewUrl(null); // Will be loaded by the query
    } else {
      // Open camera to capture
      setCapturingPage(pageNum);
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 50);
    }
  }, [capturedPageNumbers]);

  const handleFileCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTextbook || capturingPage === null) return;

    try {
      toast.loading('Uploading page...', { id: 'upload' });

      // Get upload URL from Convex
      const uploadUrl = await generateUploadUrl();

      // Upload the file
      const result = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!result.ok) throw new Error('Upload failed');

      const { storageId } = await result.json();

      // Save the page reference
      await savePage({
        textbookId: selectedTextbook._id,
        pageNumber: capturingPage,
        storageId,
      });

      toast.success(`Page ${capturingPage} captured!`, { id: 'upload' });
    } catch {
      toast.error('Failed to upload page', { id: 'upload' });
    } finally {
      setCapturingPage(null);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [selectedTextbook, capturingPage, generateUploadUrl, savePage]);

  const handleDeletePage = async () => {
    if (!selectedTextbook || previewPage === null) return;
    if (confirm(`Delete captured image for page ${previewPage}?`)) {
      await removePage({ textbookId: selectedTextbook._id, pageNumber: previewPage });
      toast.success('Page deleted');
      setPreviewPage(null);
      setPreviewUrl(null);
    }
  };

  const handleRecapture = () => {
    if (previewPage === null) return;
    setCapturingPage(previewPage);
    setPreviewPage(null);
    setPreviewUrl(null);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 50);
  };

  if (!allTextbooks) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-xl" />)}
      </div>
    );
  }

  const breadcrumb = () => {
    const parts: string[] = [];
    if (selectedGrade !== null) parts.push(`Grade ${selectedGrade}`);
    if (selectedTextbook) parts.push(`Part ${selectedTextbook.part}`);
    return parts.join(' > ');
  };

  const gradeBooks = selectedGrade !== null
    ? allTextbooks.filter((t) => t.grade === selectedGrade).sort((a, b) => a.part - b.part)
    : [];

  const captured = new Set(capturedPageNumbers || []);

  return (
    <>
      {/* Hidden file input for camera */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileCapture}
      />

      {viewLevel !== 'grades' && (
        <div className="flex items-center gap-2 mb-3">
          <button className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-muted transition-colors" onClick={handleBack}>
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <p className="text-xs text-muted-foreground">{breadcrumb()}</p>
        </div>
      )}

      {/* GRADE LIST */}
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

      {/* BOOK LIST */}
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
            <Button
              variant="outline"
              size="sm"
              className="w-full rounded-xl mt-2 gap-1.5"
              onClick={openAddBookForm}
            >
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

      {/* PAGE GRID */}
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

          {/* Progress bar */}
          <div className="w-full h-2 bg-muted rounded-full mb-4 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${(captured.size / selectedTextbook.totalPages) * 100}%` }}
            />
          </div>

          {/* Grid of page boxes */}
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

      {/* ADD/EDIT BOOK DIALOG */}
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
              Unit numbers help identify which book to open during class. e.g., if Part 1 covers units 1–15, a student working on unit 10 knows to open Part 1.
            </p>
            <Button onClick={handleSaveBook} className="w-full rounded-xl">
              {editingBook ? 'Save Changes' : 'Create Book'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* PAGE PREVIEW DIALOG */}
      <Dialog open={previewPage !== null} onOpenChange={(open) => { if (!open) { setPreviewPage(null); setPreviewUrl(null); } }}>
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
              <Button
                variant="outline"
                size="sm"
                className="flex-1 rounded-xl gap-1.5"
                onClick={handleRecapture}
              >
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
    </>
  );
}
