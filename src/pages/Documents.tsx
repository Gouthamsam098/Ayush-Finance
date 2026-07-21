import { useMemo, useRef, useState } from 'react';
import { useData, type DocItem } from '@/mock/DataContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/PageHeader';
import { fmtDate, todayISO, initials } from '@/lib/format';
import { Plus, ChevronRight, Eye, Trash2, UploadCloud, FileText, Image as ImageIcon } from 'lucide-react';

const DOC_TYPES = ['Aadhaar', 'PAN', 'Cheque', 'Passport', 'RC', 'Insurance', 'Property Doc', 'Vehicle Photo', 'Customer Photo', 'Other'];

export default function Documents() {
  const d = useData();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [docType, setDocType] = useState('Aadhaar');
  const [file, setFile] = useState<{ name: string; size: string; dataUrl: string; mime: string } | null>(null);
  const [viewer, setViewer] = useState<DocItem | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const grouped = useMemo(() => {
    const map = new Map<number, DocItem[]>();
    d.documents.forEach((doc) => {
      const arr = map.get(doc.customerId) ?? [];
      arr.push(doc); map.set(doc.customerId, arr);
    });
    return map;
  }, [d.documents]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(f.type)) { toast('Only JPG, PNG or PDF', 'error'); return; }
    if (f.size > 5 * 1024 * 1024) { toast('Max 5 MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => setFile({ name: f.name, size: (f.size / 1024 / 1024).toFixed(2) + ' MB', dataUrl: reader.result as string, mime: f.type });
    reader.readAsDataURL(f);
  };

  const save = () => {
    if (!customerId) { toast('Select a customer', 'error'); return; }
    if (!file) { toast('Choose a file', 'error'); return; }
    const custId = Number(customerId);
    d.addDocument({ customerId: custId, type: docType, fileName: file.name, size: file.size, dataUrl: file.dataUrl, mime: file.mime, date: todayISO() });
    setExpanded((s) => ({ ...s, [custId]: true }));
    toast('Document uploaded');
    setOpen(false); setFile(null); setCustomerId(''); if (fileRef.current) fileRef.current.value = '';
  };

  const custName = (id: number) => d.customers.find((c) => c.id === id)?.name ?? 'Unknown';

  return (
    <div className="space-y-5 p-3.5 sm:p-5">
      <PageHeader title="Documents" subtitle={`${d.documents.length} files · grouped by customer`}
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Upload Document</Button>} />

      <div className="space-y-3">
        {[...grouped.entries()].map(([cid, docs], gi) => {
          const isOpen = expanded[cid];
          return (
            <Card key={cid} className="anim-pop overflow-hidden" style={{ animationDelay: `${Math.min(gi * 60, 400)}ms` }}>
              <button onClick={() => setExpanded((s) => ({ ...s, [cid]: !s[cid] }))} className="group flex w-full items-center gap-3 px-5 py-4 text-left">
                <ChevronRight size={16} className={`text-primary transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-blue-400 to-primary text-xs font-bold text-white shadow-soft transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">{initials(custName(cid))}</div>
                <div className="flex-1"><div className="font-semibold">{custName(cid)}</div><div className="text-xs text-muted">{docs.map((x) => x.type).join(' · ')}</div></div>
                <Badge tone="info">{docs.length} docs</Badge>
              </button>
              {isOpen && (
                <div className="space-y-2 px-5 pb-4">
                  {docs.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-3 rounded-xl border border-slate-100 dark:border-white/[.06] px-3 py-2.5">
                      <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 dark:bg-slate-800 text-muted">
                        {doc.mime?.startsWith('image') ? <ImageIcon size={16} /> : <FileText size={16} />}
                      </div>
                      <div className="min-w-0 flex-1"><div className="text-sm font-medium">{doc.type}</div><div className="truncate text-xs text-muted">{doc.fileName} · {doc.size} · {fmtDate(doc.date)}</div></div>
                      <button onClick={() => setViewer(doc)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary" title="View"><Eye size={15} /></button>
                      <button onClick={() => { d.deleteDocument(doc.id); toast('Document removed', 'info'); }} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger-50 hover:text-danger" title="Delete"><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
        {grouped.size === 0 && <Card className="p-10 text-center text-muted">No documents uploaded yet.</Card>}
      </div>

      {/* Upload */}
      <Dialog open={open} onClose={() => setOpen(false)} title="Upload document"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Upload &amp; save</Button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} options={[{ value: '', label: 'Select…' }, ...d.customers.map((c) => ({ value: String(c.id), label: c.name }))]} />
            <Select label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)} options={DOC_TYPES.map((t) => ({ value: t, label: t }))} />
          </div>
          <div onClick={() => fileRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${file ? 'border-success bg-success-50 dark:bg-success/10' : 'border-slate-300 dark:border-slate-700 hover:border-primary'}`}>
            {file ? (
              <><div className="text-sm font-semibold">{file.name}</div><div className="text-xs text-muted">{file.size} · click to change</div></>
            ) : (
              <><UploadCloud className="mx-auto mb-2 text-muted" /><div className="text-sm font-semibold">Click to choose a file</div><div className="text-xs text-muted">JPG, PNG or PDF · max 5 MB</div></>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={onPick} />
          </div>
        </div>
      </Dialog>

      {/* Viewer */}
      <Dialog open={!!viewer} onClose={() => setViewer(null)} title={viewer ? `${viewer.type}` : ''} subtitle={viewer ? `${custName(viewer.customerId)} · ${viewer.fileName}` : ''} wide
        footer={viewer?.dataUrl ? <a href={viewer.dataUrl} download={viewer.fileName}><Button>Download</Button></a> : <Button variant="ghost" onClick={() => setViewer(null)}>Close</Button>}>
        {viewer && (
          <div className="grid min-h-[280px] place-items-center rounded-xl bg-slate-50 dark:bg-slate-800 p-4">
            {viewer.dataUrl ? (
              viewer.mime?.startsWith('image')
                ? <img src={viewer.dataUrl} alt={viewer.fileName} className="max-h-[60vh] rounded-lg" />
                : <iframe src={viewer.dataUrl} title={viewer.fileName} className="h-[60vh] w-full rounded-lg bg-white" />
            ) : (
              <div className="text-center"><FileText size={48} className="mx-auto mb-3 text-muted" /><div className="font-semibold">{viewer.fileName}</div><p className="mx-auto mt-2 max-w-xs text-sm text-muted">Sample seed record — upload a new document to preview the actual file inline.</p></div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
