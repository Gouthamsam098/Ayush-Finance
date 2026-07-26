import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useData } from '@/mock/DataContext';
import type { RootState } from '@/store';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/PageHeader';
import { fmtDate, todayISO, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { config } from '@/lib/config';
import { documentApi, type DocumentType, type CustomerDocument } from '@/services/documentApi';
import { ApiError } from '@/lib/api';
import {
  Plus, ChevronRight, Eye, Trash2, Download, UploadCloud, FileText,
  Image as ImageIcon, Search, FolderOpen, Files, HardDrive, Loader2, User,
} from 'lucide-react';

/** Friendly labels for the backend's document type codes. */
const TYPE_LABEL: Record<string, string> = {
  AADHAAR: 'Aadhaar Card', PAN: 'PAN Card', LICENSE: 'Driving License',
  RC: 'RC (Registration)', PROPERTY: 'Property Document', PHOTO: 'Photo', OTHER: 'Other Document',
};
const label = (t: string) => TYPE_LABEL[t] ?? t;

const UPLOAD_TYPES: DocumentType[] = ['AADHAAR', 'PAN', 'LICENSE', 'RC', 'PROPERTY', 'PHOTO', 'OTHER'];

/** Normalized document row rendered by the page — unified across API + mock. */
interface DocRow {
  id: number;
  customerId: number;
  type: string;
  fileName: string;
  sizeLabel: string;
  mime: string | null;
  date: string;        // YYYY-MM-DD
  dataUrl?: string | null; // mock only — inline preview/download source
}

const fmtBytes = (n: number): string => {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

export default function Documents() {
  const d = useData();
  const toast = useToast();
  const accessToken = useSelector((s: RootState) => s.auth.accessToken);
  const fileRef = useRef<HTMLInputElement>(null);

  // Upload dialog
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [docType, setDocType] = useState<DocumentType>('AADHAAR');
  const [file, setFile] = useState<{ raw: File; name: string; size: string; dataUrl: string; mime: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const [viewer, setViewer] = useState<DocRow | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [busyDoc, setBusyDoc] = useState<number | null>(null);

  // API-mode document store: docs keyed by customerId, fetched from the backend.
  const [apiDocs, setApiDocs] = useState<Record<number, CustomerDocument[]>>({});
  const [loading, setLoading] = useState(false);

  const custName = (id: number) => d.customers.find((c) => c.id === id)?.name ?? 'Unknown';

  // Fetch every customer's documents from the backend (API mode). Keyed off the
  // access token + the loaded customer list so it runs after login and once the
  // customers exist. Mock mode reads d.documents instead.
  const reloadApiDocs = useCallback(async () => {
    if (!config.useApi || !accessToken || d.customers.length === 0) return;
    setLoading(true);
    try {
      const entries = await Promise.all(
        d.customers.map(async (c) => [c.id, await documentApi.list(c.id).catch(() => [])] as const),
      );
      const map: Record<number, CustomerDocument[]> = {};
      for (const [id, docs] of entries) if (docs.length) map[id] = docs;
      setApiDocs(map);
    } finally {
      setLoading(false);
    }
  }, [accessToken, d.customers]);

  useEffect(() => { reloadApiDocs(); }, [reloadApiDocs]);

  // Unified rows grouped by customer — from the backend in API mode, from the
  // in-memory mock otherwise.
  const grouped = useMemo(() => {
    const map = new Map<number, DocRow[]>();
    if (config.useApi) {
      for (const c of d.customers) {
        const docs = apiDocs[c.id];
        if (!docs?.length) continue;
        map.set(c.id, docs.map((x) => ({
          id: x.id, customerId: c.id, type: x.type, fileName: x.file_name,
          sizeLabel: fmtBytes(x.size_bytes), mime: x.mime_type, date: (x.created_at ?? '').slice(0, 10),
        })));
      }
    } else {
      for (const doc of d.documents) {
        const arr = map.get(doc.customerId) ?? [];
        arr.push({ id: doc.id, customerId: doc.customerId, type: doc.type, fileName: doc.fileName, sizeLabel: doc.size, mime: doc.mime, date: doc.date, dataUrl: doc.dataUrl });
        map.set(doc.customerId, arr);
      }
    }
    return map;
  }, [apiDocs, d.documents, d.customers]);

  // Search filter (customer name/code or document type).
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const rows = [...grouped.entries()];
    if (!q) return rows;
    return rows.filter(([cid, docs]) => {
      const c = d.customers.find((x) => x.id === cid);
      return (c?.name.toLowerCase().includes(q)) || (c?.code?.toLowerCase().includes(q)) ||
        docs.some((doc) => label(doc.type).toLowerCase().includes(q) || doc.fileName.toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, q, d.customers]);

  const totalDocs = useMemo(() => [...grouped.values()].reduce((s, arr) => s + arr.length, 0), [grouped]);

  // ── upload ──
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(f.type)) { toast('Only JPG, PNG or PDF', 'error'); return; }
    if (f.size > 5 * 1024 * 1024) { toast('Max 5 MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => setFile({ raw: f, name: f.name, size: (f.size / 1024 / 1024).toFixed(2) + ' MB', dataUrl: reader.result as string, mime: f.type });
    reader.readAsDataURL(f);
  };

  const resetUpload = () => { setOpen(false); setFile(null); setCustomerId(''); setDocType('AADHAAR'); if (fileRef.current) fileRef.current.value = ''; };

  const save = async () => {
    if (!customerId) { toast('Select a customer', 'error'); return; }
    if (!file) { toast('Choose a file', 'error'); return; }
    const custId = Number(customerId);
    setUploading(true);
    try {
      if (config.useApi) {
        await documentApi.upload(custId, docType, file.raw);
        await reloadApiDocs();
      } else {
        d.addDocument({ customerId: custId, type: docType, fileName: file.name, size: file.size, dataUrl: file.dataUrl, mime: file.mime, date: todayISO() });
      }
      setExpanded((s) => ({ ...s, [custId]: true }));
      toast('Document uploaded');
      resetUpload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Failed to upload document', 'error');
    } finally {
      setUploading(false);
    }
  };

  // ── download ──
  const download = async (doc: DocRow) => {
    setBusyDoc(doc.id);
    try {
      if (config.useApi) {
        await documentApi.download(doc.customerId, doc.id, doc.fileName);
      } else if (doc.dataUrl) {
        const a = document.createElement('a');
        a.href = doc.dataUrl; a.download = doc.fileName; a.click();
      } else {
        toast('No file attached to this sample record', 'info');
        return;
      }
      toast('Download started');
    } catch {
      toast('Download failed', 'error');
    } finally {
      setBusyDoc(null);
    }
  };

  // ── delete ──
  const remove = async (doc: DocRow) => {
    setBusyDoc(doc.id);
    try {
      if (config.useApi) {
        await documentApi.remove(doc.customerId, doc.id);
        setApiDocs((s) => ({ ...s, [doc.customerId]: (s[doc.customerId] ?? []).filter((x) => x.id !== doc.id) }));
      } else {
        d.deleteDocument(doc.id);
      }
      toast('Document removed', 'info');
    } catch {
      toast('Failed to remove document', 'error');
    } finally {
      setBusyDoc(null);
    }
  };

  // ── viewer (fetch blob in API mode so the auth-protected file previews) ──
  const openViewer = async (doc: DocRow) => {
    setViewer(doc);
    setViewerUrl(null);
    if (config.useApi) {
      try {
        const blob = await documentApi.fetchBlob(doc.customerId, doc.id);
        setViewerUrl(URL.createObjectURL(blob));
      } catch { /* viewer shows a fallback */ }
    } else if (doc.dataUrl) {
      setViewerUrl(doc.dataUrl);
    }
  };
  const closeViewer = () => { if (viewerUrl?.startsWith('blob:')) URL.revokeObjectURL(viewerUrl); setViewer(null); setViewerUrl(null); };

  return (
    <div className="space-y-5 p-3.5 sm:p-5">
      <PageHeader
        title="Document Vault"
        subtitle={
          loading
            ? 'Loading customer files…'
            : totalDocs === 0
              ? 'KYC & supporting files — upload or add them from a customer profile'
              : `${totalDocs} ${totalDocs === 1 ? 'file' : 'files'} across ${grouped.size} ${grouped.size === 1 ? 'customer' : 'customers'} · view & download anytime`
        }
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Upload Document</Button>}
      />

      {/* KPI band */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-3">
        <StatCard label="Total documents" value={String(totalDocs)} accent="#6366f1" icon={<Files size={16} />} />
        <StatCard label="Customers with files" value={String(grouped.size)} accent="#8b5cf6" icon={<User size={16} />} />
        <StatCard label="Customers" value={String(d.customers.length)} accent="#10b981" icon={<FolderOpen size={16} />} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px] text-muted">
          {loading ? 'Loading documents…' : <><span className="font-semibold text-ink">{filtered.length}</span> {filtered.length === 1 ? 'customer' : 'customers'} · <span className="font-semibold text-ink">{totalDocs}</span> files</>}
        </div>
        <div className="flex w-full items-center gap-2 rounded-[11px] border-[0.5px] border-slate-200/80 bg-white px-3.5 py-[9px] focus-within:border-blue-400 sm:w-72 dark:border-white/[.08] dark:bg-surface">
          <Search size={16} className="shrink-0 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customer or document…" className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted" />
        </div>
      </div>

      {/* Customer groups */}
      <div className="space-y-3">
        {loading && filtered.length === 0 ? (
          <div className="flex items-center justify-center gap-2 rounded-[16px] border-[0.5px] border-slate-200/80 bg-white py-16 text-muted dark:border-white/[.08] dark:bg-surface">
            <Loader2 size={18} className="animate-spin" /> Loading documents…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-[16px] border-[0.5px] border-slate-200/80 bg-white py-16 text-center dark:border-white/[.08] dark:bg-surface">
            <FolderOpen size={30} className="text-slate-300 dark:text-white/20" />
            <p className="text-sm font-medium text-muted">{q ? 'No documents match your search.' : 'No documents uploaded yet.'}</p>
            <p className="text-[12px] text-muted/70">{q ? 'Try a different name or type.' : 'Documents added on the customer form appear here automatically.'}</p>
          </div>
        ) : (
          filtered.map(([cid, docs]) => {
            const isOpen = expanded[cid] ?? false;
            const c = d.customers.find((x) => x.id === cid);
            return (
              <div key={cid} className="overflow-hidden rounded-[16px] border-[0.5px] border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(30,39,64,.04)] transition-shadow hover:shadow-[0_6px_20px_-12px_rgba(30,39,64,.18)] dark:border-white/[.08] dark:bg-surface">
                <button
                  onClick={() => setExpanded((s) => ({ ...s, [cid]: !s[cid] }))}
                  className="group flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5"
                >
                  <ChevronRight size={16} className={cn('shrink-0 text-blue-500 transition-transform', isOpen && 'rotate-90')} />
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 text-[13px] font-bold text-white shadow-sm">{initials(custName(cid))}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-ink">{custName(cid)}</span>
                      {c?.code && <span className="hidden shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-muted sm:inline dark:bg-white/[.06]">{c.code}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {docs.slice(0, 4).map((x) => (
                        <span key={x.id} className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10.5px] font-medium text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">{label(x.type)}</span>
                      ))}
                      {docs.length > 4 && <span className="text-[10.5px] text-muted">+{docs.length - 4} more</span>}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-bold text-ink/70 dark:bg-white/[.06]">{docs.length}</span>
                </button>

                {isOpen && (
                  <div className="space-y-2 border-t border-slate-100 px-4 pb-4 pt-3 sm:px-5 dark:border-white/[.06]">
                    {docs.map((doc) => {
                      const isImg = doc.mime?.startsWith('image');
                      const busy = busyDoc === doc.id;
                      return (
                        <div key={doc.id} className="flex items-center gap-3 rounded-xl border-[0.5px] border-slate-200/70 bg-slate-50/50 px-3 py-2.5 dark:border-white/[.06] dark:bg-white/[.02]">
                          <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg', isImg ? 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' : 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300')}>
                            {isImg ? <ImageIcon size={17} /> : <FileText size={17} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13.5px] font-semibold text-ink">{label(doc.type)}</div>
                            <div className="truncate text-[12px] text-muted">{doc.fileName} · {doc.sizeLabel}{doc.date ? ` · ${fmtDate(doc.date)}` : ''}</div>
                          </div>
                          <button onClick={() => openViewer(doc)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-500/15" title="View"><Eye size={16} /></button>
                          <button onClick={() => download(doc)} disabled={busy} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-emerald-500/15" title="Download">
                            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                          </button>
                          <button onClick={() => remove(doc)} disabled={busy} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/15" title="Delete"><Trash2 size={16} /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Upload dialog */}
      <Dialog
        open={open}
        onClose={resetUpload}
        title="Upload document"
        subtitle="Attach a KYC or supporting file to a customer"
        footer={<><Button variant="ghost" onClick={resetUpload}>Cancel</Button><Button onClick={save} loading={uploading}>Upload &amp; save</Button></>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} options={[{ value: '', label: 'Select…' }, ...d.customers.map((c) => ({ value: String(c.id), label: `${c.name}${c.code ? ` (${c.code})` : ''}` }))]} />
            <Select label="Document type" value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)} options={UPLOAD_TYPES.map((t) => ({ value: t, label: label(t) }))} />
          </div>
          <div
            onClick={() => fileRef.current?.click()}
            className={cn('cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors',
              file ? 'border-emerald-400 bg-emerald-50/60 dark:border-emerald-400/50 dark:bg-emerald-500/10' : 'border-slate-300 hover:border-blue-400 dark:border-white/15')}
          >
            {file ? (
              <><FileText className="mx-auto mb-2 text-emerald-600 dark:text-emerald-400" /><div className="text-sm font-semibold text-ink">{file.name}</div><div className="text-xs text-muted">{file.size} · click to change</div></>
            ) : (
              <><UploadCloud className="mx-auto mb-2 text-muted" /><div className="text-sm font-semibold text-ink">Click to choose a file</div><div className="text-xs text-muted">JPG, PNG or PDF · max 5 MB</div></>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={onPick} />
          </div>
        </div>
      </Dialog>

      {/* Viewer */}
      <Dialog
        open={!!viewer}
        onClose={closeViewer}
        title={viewer ? label(viewer.type) : ''}
        subtitle={viewer ? `${custName(viewer.customerId)} · ${viewer.fileName}` : ''}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={closeViewer}>Close</Button>
            {viewer && <Button onClick={() => download(viewer)}><Download size={15} /> Download</Button>}
          </>
        }
      >
        {viewer && (
          <div className="grid min-h-[280px] place-items-center rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
            {viewerUrl ? (
              viewer.mime?.startsWith('image')
                ? <img src={viewerUrl} alt={viewer.fileName} className="max-h-[60vh] rounded-lg" />
                : <iframe src={viewerUrl} title={viewer.fileName} className="h-[60vh] w-full rounded-lg bg-white" />
            ) : (
              <div className="text-center">
                <Loader2 size={28} className="mx-auto mb-3 animate-spin text-muted" />
                <div className="text-sm text-muted">Loading preview…</div>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
