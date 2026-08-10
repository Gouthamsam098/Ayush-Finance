import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { PageHeader, HeaderPrimaryButton } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import { fmtDate } from '@/lib/format';
import { ApiError } from '@/lib/api';
import { userApi, MODULES, type ManagedUser, type UserRole, type Access, type Permissions } from '@/services/userApi';
import {
  UserPlus, Trash2, Settings as SettingsIcon, Pencil, Plus, Users as UsersIcon, Loader2, ShieldCheck,
  LayoutDashboard, FileText, Receipt, Wallet, FolderOpen,
} from 'lucide-react';

const MODULE_ICON: Record<string, React.ReactNode> = {
  Dashboard: <LayoutDashboard size={15} />,
  Customers: <UsersIcon size={15} />,
  Loans: <FileText size={15} />,
  Collections: <Receipt size={15} />,
  Expenses: <Wallet size={15} />,
  Documents: <FolderOpen size={15} />,
  Settings: <SettingsIcon size={15} />,
};
const ACCESS_OPTS: Access[] = ['none', 'view', 'edit'];
const ACCESS_LABEL: Record<Access, string> = { none: 'No access', view: 'View', edit: 'Edit' };

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      role="switch" aria-checked={on} disabled={disabled}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200',
        on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className={cn('inline-block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-transform duration-200', on ? 'translate-x-[22px]' : 'translate-x-[3px]')} />
    </button>
  );
}

const ROLE_PILL: Record<UserRole, string> = {
  ADMIN: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  VIEWER: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
};
const roleLabel = (r: UserRole) => (r === 'ADMIN' ? 'Admin' : 'Viewer');

interface FormState { id?: number; email: string; fullName: string; password: string; confirm: string; role: UserRole; permissions: Permissions; }
const emptyPerms = (): Permissions => Object.fromEntries(MODULES.map((m) => [m, 'none' as Access]));
const blankForm = (): FormState => ({ email: '', fullName: '', password: '', confirm: '', role: 'VIEWER', permissions: emptyPerms() });

export default function Settings() {
  const toast = useToast();
  const me = useSelector((s: RootState) => s.auth.user);

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<ManagedUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await userApi.list()); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Failed to load users', 'error'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const adminCount = useMemo(() => users.filter((u) => u.role === 'ADMIN' && u.isActive).length, [users]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const openCreate = () => setForm(blankForm());
  const openEdit = (u: ManagedUser) => setForm({ id: u.id, email: u.email, fullName: u.fullName, password: '', confirm: '', role: u.role, permissions: { ...emptyPerms(), ...u.permissions } });
  const setPerm = (module: string, access: Access) => setForm((f) => (f ? { ...f, permissions: { ...f.permissions, [module]: access } } : f));

  const save = async () => {
    if (!form) return;
    if (!form.email.trim() || !form.fullName.trim()) { toast('Email and name are required', 'error'); return; }
    const creating = form.id == null;
    if (creating || form.password) {
      if (form.password.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
      if (form.password !== form.confirm) { toast('Passwords do not match', 'error'); return; }
    }
    setSaving(true);
    try {
      if (creating) {
        await userApi.create({ email: form.email.trim(), fullName: form.fullName.trim(), password: form.password, role: form.role, permissions: form.permissions });
        toast('User created');
      } else {
        const existing = users.find((u) => u.id === form.id)!;
        await userApi.update(form.id!, { email: form.email.trim(), fullName: form.fullName.trim(), role: form.role, permissions: form.permissions, isActive: existing.isActive, password: form.password || undefined });
        toast('User updated');
      }
      setForm(null);
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Failed to save user', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: ManagedUser) => {
    setBusyId(u.id);
    try { await userApi.setActive(u.id, u, !u.isActive); toast(`${u.fullName} ${u.isActive ? 'disabled' : 'enabled'}`, 'info'); await load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Failed to update', 'error'); }
    finally { setBusyId(null); }
  };

  const doDelete = async (u: ManagedUser) => {
    setBusyId(u.id);
    try { await userApi.remove(u.id); toast('User removed', 'info'); setConfirmDel(null); await load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Failed to remove', 'error'); }
    finally { setBusyId(null); }
  };

  // Settings is ADMIN-only. The backend guards /users regardless; this stops a
  // non-admin who deep-links to /settings from seeing a broken page of 403s.
  if (me && me.role !== 'ADMIN') {
    return (
      <div className="flex min-h-full flex-col">
        <PageHeader icon={<SettingsIcon size={20} />} title="Settings" subtitle="User access & roles" />
        <div className="grid flex-1 place-items-center p-8">
          <div className="anim-pop flex max-w-sm flex-col items-center gap-3 rounded-card border border-slate-200/90 bg-white px-8 py-12 text-center shadow-card dark:border-white/[.07] dark:bg-surface">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"><ShieldCheck size={26} /></div>
            <div className="font-display text-lg font-bold">Admins only</div>
            <p className="text-sm text-muted">User management is restricted to administrator accounts. Ask an admin if you need access changed.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        icon={<SettingsIcon size={20} />}
        title="Settings"
        subtitle="User access & roles"
        actions={<HeaderPrimaryButton beam icon={<Plus size={14} />} onClick={openCreate}>Add User</HeaderPrimaryButton>}
      />

      <div className="flex flex-1 flex-col gap-5 p-3.5 sm:px-5">
        <Card className="anim-pop">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus size={17} className="text-primary" /> User Management</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <ShieldCheck size={15} className="text-emerald-500" />
              {loading ? 'Loading users…' : <><span className="font-semibold text-ink">{users.length}</span> user{users.length === 1 ? '' : 's'} · <span className="font-semibold text-ink">{adminCount}</span> admin{adminCount === 1 ? '' : 's'}</>}
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-white/[.06]">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8]">
                  <tr className="text-left text-[12px] font-bold uppercase tracking-[0.08em] text-white">
                    <th className="px-5 py-3.5">User</th>
                    <th className="px-5 py-3.5">Email</th>
                    <th className="px-5 py-3.5">Role</th>
                    <th className="px-5 py-3.5">Last Login</th>
                    <th className="px-5 py-3.5 text-center">Active</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[.05]">
                  {loading ? (
                    <tr><td colSpan={6} className="px-5 py-12 text-center text-muted"><Loader2 size={18} className="mx-auto animate-spin" /></td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-12 text-center">
                      <UsersIcon size={26} className="mx-auto mb-2 text-slate-300 dark:text-white/20" />
                      <div className="text-[13.5px] font-medium text-ink">No users yet</div>
                      <div className="text-[12px] text-muted">Add your first team member.</div>
                    </td></tr>
                  ) : users.map((u) => {
                    const isSelf = me?.id === u.id;
                    const isLastAdmin = u.role === 'ADMIN' && u.isActive && adminCount === 1;
                    const guarded = isSelf || isLastAdmin; // can't disable/delete
                    return (
                      <tr key={u.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[.02]">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2.5">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-[11px] font-bold text-white">{u.fullName.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>
                            <span className="font-semibold text-[14.5px] text-ink">{u.fullName}{isSelf && <span className="ml-1.5 text-[11px] font-medium text-muted">(you)</span>}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-[13px] text-muted">{u.email}</td>
                        <td className="px-5 py-4">
                          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold', ROLE_PILL[u.role])}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />{roleLabel(u.role)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-[13px] text-muted">{u.lastLoginAt ? fmtDate(u.lastLoginAt.slice(0, 10)) : '—'}</td>
                        <td className="px-5 py-4">
                          <div className="flex justify-center">
                            {busyId === u.id ? <Loader2 size={16} className="animate-spin text-muted" />
                              : <Toggle on={u.isActive} disabled={guarded} onChange={() => toggleActive(u)} />}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => openEdit(u)} title="Edit" className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-500/15"><Pencil size={15} /></button>
                            <button onClick={() => setConfirmDel(u)} disabled={guarded} title={guarded ? 'Protected account' : 'Remove'} className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-500/15"><Trash2 size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Add / Edit user — wide: the per-module permission matrix needs the room */}
      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        wide
        title={form?.id ? 'Edit user' : 'Add user'}
        subtitle={form?.id ? 'Update details, role or password' : 'Create a new account and assign a role'}
        footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button onClick={save} loading={saving}><UserPlus size={15} /> {form?.id ? 'Save changes' : 'Add user'}</Button></>}
      >
        {form && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Full name *" placeholder="e.g. Ramesh Kumar" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
              <Input label="Email *" type="email" placeholder="user@example.com" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label={form.id ? 'New password' : 'Password *'} type="password" placeholder={form.id ? 'Leave blank to keep' : 'Min 8 characters'} value={form.password} onChange={(e) => set('password', e.target.value)} />
              <Input label={form.id ? 'Confirm new password' : 'Confirm password *'} type="password" placeholder="Re-enter password" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} />
            </div>
            <Select label="Role" value={form.role} onChange={(e) => set('role', e.target.value as UserRole)} options={[{ value: 'VIEWER', label: 'Viewer — customise module access' }, { value: 'ADMIN', label: 'Admin — full access + user management' }]} />
            {form.id === me?.id && <p className="text-[12px] text-amber-600 dark:text-amber-400">You cannot change your own role or disable yourself.</p>}

            {form.role === 'ADMIN' ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-[12.5px] text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/[.08] dark:text-emerald-300">
                Admins have full edit access to every module.
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border-[0.5px] border-slate-200/80 dark:border-white/[.08]">
                <div className="flex items-center justify-between bg-gradient-to-r from-violet-700 to-purple-600 px-4 py-2.5">
                  <span className="text-[13px] font-bold text-white">Module Access</span>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => setForm((f) => f && ({ ...f, permissions: Object.fromEntries(MODULES.map((m) => [m, 'view' as Access])) }))} className="rounded-md bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-white/25">All view</button>
                    <button type="button" onClick={() => setForm((f) => f && ({ ...f, permissions: emptyPerms() }))} className="rounded-md bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-white/25">Clear</button>
                  </div>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-white/[.05]">
                  {MODULES.map((m) => (
                    <div key={m} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[.06] dark:text-slate-400">{MODULE_ICON[m]}</span>
                      <span className="flex-1 text-[13.5px] font-medium text-ink">{m}</span>
                      <div className="flex rounded-lg border-[0.5px] border-slate-200 p-0.5 dark:border-white/[.1]">
                        {ACCESS_OPTS.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => setPerm(m, a)}
                            className={cn(
                              'rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
                              form.permissions[m] === a
                                ? a === 'edit' ? 'bg-emerald-500 text-white' : a === 'view' ? 'bg-blue-500 text-white' : 'bg-slate-400 text-white dark:bg-slate-500'
                                : 'text-muted hover:text-ink',
                            )}
                          >
                            {ACCESS_LABEL[a]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title="Remove user?"
        subtitle={confirmDel ? `${confirmDel.fullName} · ${confirmDel.email}` : ''}
        footer={<><Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button><Button variant="danger" loading={busyId === confirmDel?.id} onClick={() => confirmDel && doDelete(confirmDel)}>Remove</Button></>}
      >
        <p className="text-sm text-muted">This user will lose access immediately. This can’t be undone from the UI.</p>
      </Dialog>
    </div>
  );
}
