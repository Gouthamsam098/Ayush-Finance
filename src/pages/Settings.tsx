import { useState } from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { PageHeader, HeaderPrimaryButton } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import {
  ShieldCheck, UserPlus, Trash2, LayoutDashboard, Users, FileText,
  Receipt, Wallet, FolderOpen, Settings as SettingsIcon, Eye, Pencil,
  Check, Plus, Mail,
} from 'lucide-react';

type AccessLevel = 'none' | 'view' | 'edit';
interface ModuleAccess { module: string; access: AccessLevel; }
interface AppUser {
  id: string; email: string; username: string; password?: string; role: string; status: 'Active' | 'Pending' | 'Disabled';
  moduleAccess: ModuleAccess[];
}

const MODULE_ICONS: Record<string, React.ReactNode> = {
  Dashboard:   <LayoutDashboard size={15} />,
  Customers:   <Users size={15} />,
  Loans:       <FileText size={15} />,
  Collections: <Receipt size={15} />,
  Expenses:    <Wallet size={15} />,
  Documents:   <FolderOpen size={15} />,
  Settings:    <SettingsIcon size={15} />,
};

const MODULES = Object.keys(MODULE_ICONS);

const defaultAccess = (): ModuleAccess[] => MODULES.map((m) => ({ module: m, access: 'none' as AccessLevel }));

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200',
        on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
      )}
    >
      <span
        className={cn(
          'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-transform duration-200',
          on ? 'translate-x-[22px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

export default function Settings() {
  const toast = useToast();
  const [gaEnabled, setGaEnabled] = useState(true);

  const [users, setUsers] = useState<AppUser[]>([
    { id: 'u1', email: 'admin@anush.com', username: 'admin', role: 'Admin', status: 'Active', moduleAccess: defaultAccess().map((m) => ({ ...m, access: 'edit' as AccessLevel })) },
    { id: 'u2', email: 'priya@anush.com', username: 'priya.manager', role: 'Viewer', status: 'Active', moduleAccess: defaultAccess().map((m) => ({ ...m, access: 'view' as AccessLevel })) },
  ]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteConfirmPassword, setInviteConfirmPassword] = useState('');
  const [inviteRole, setInviteRole] = useState('Viewer');
  const [inviteAccess, setInviteAccess] = useState<ModuleAccess[]>(defaultAccess());

  const resetInviteForm = () => {
    setInviteEmail('');
    setInviteUsername('');
    setInvitePassword('');
    setInviteConfirmPassword('');
    setInviteRole('Viewer');
    setInviteAccess(defaultAccess());
  };

  const isViewer = inviteRole === 'Viewer';

  const toggleModule = (module: string) => {
    setInviteAccess((prev) =>
      prev.map((a) =>
        a.module === module
          ? { ...a, access: a.access === 'edit' ? 'view' : 'edit' as AccessLevel }
          : a,
      ),
    );
  };

  const inviteUser = () => {
    if (!inviteEmail.trim() || !inviteUsername.trim()) {
      toast('Enter email and username', 'error');
      return;
    }
    if (!invitePassword) {
      toast('Password is required', 'error');
      return;
    }
    if (invitePassword.length < 8) {
      toast('Password must be at least 8 characters', 'error');
      return;
    }
    if (invitePassword !== inviteConfirmPassword) {
      toast('Passwords do not match', 'error');
      return;
    }
    const checkedModules = inviteAccess.filter((a) => a.access === 'edit');
    const access = isViewer
      ? defaultAccess().map((m) => {
          const found = checkedModules.find((c) => c.module === m.module);
          return { ...m, access: found ? ('edit' as AccessLevel) : ('view' as AccessLevel) };
        })
      : defaultAccess().map((m) => ({ ...m, access: 'edit' as AccessLevel }));
    setUsers((s) => [...s, {
      id: Math.random().toString(36).slice(2, 8),
      email: inviteEmail.trim(),
      username: inviteUsername.trim(),
      password: invitePassword,
      role: inviteRole,
      status: 'Pending',
      moduleAccess: access,
    }]);
    toast('User invited successfully');
    setInviteOpen(false);
    resetInviteForm();
  };

  const toggleStatus = (id: string) =>
    setUsers((s) => s.map((u) => (u.id === id ? { ...u, status: u.status === 'Disabled' ? 'Active' : 'Disabled' } : u)));

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        icon={<SettingsIcon size={20} />}
        title="Settings"
        subtitle="Security and user access"
        actions={<HeaderPrimaryButton beam icon={<Plus size={14} />} onClick={() => setInviteOpen(true)}>Invite User</HeaderPrimaryButton>}
      />

      <div className="flex flex-1 flex-col gap-5 p-3.5 sm:px-5">
        <div className="grid grid-cols-1 gap-5">
        <Card className="anim-pop">
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck size={17} className="text-primary" /> Security</CardTitle></CardHeader>
          <CardBody>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <div>
                <div className="text-sm font-semibold">Google Authenticator (2FA)</div>
                <div className="text-xs text-muted">Require a time-based OTP at login.</div>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={gaEnabled ? 'ok' : 'neutral'}>{gaEnabled ? 'Enabled' : 'Disabled'}</Badge>
                <Toggle on={gaEnabled} onChange={(v) => { setGaEnabled(v); toast(v ? 'Google Authenticator enabled' : 'Google Authenticator disabled', 'info'); }} />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className="anim-pop" style={{ animationDelay: '70ms' }}>
          <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus size={17} className="text-primary" /> User Management</CardTitle></CardHeader>
          <CardBody className="space-y-4">

            <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-white/[.06]">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8]">
                  <tr className="text-left text-[12px] font-bold uppercase tracking-[0.08em] text-white">
                    <th className="px-5 py-3.5">User</th>
                    <th className="px-5 py-3.5">Email</th>
                    <th className="px-5 py-3.5">Role</th>
                    <th className="px-5 py-3.5">Permissions</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-center">Active</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[.05]">
                  {users.map((u) => {
                    const viewCount = u.moduleAccess.filter((a) => a.access === 'view').length;
                    const editCount = u.moduleAccess.filter((a) => a.access === 'edit').length;
                    return (
                      <tr key={u.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[.02]">
                        <td className="px-5 py-4 font-semibold text-[15px] text-ink">{u.username}</td>
                        <td className="px-5 py-4 text-[13px] text-muted">{u.email}</td>
                        <td className="px-5 py-4">
                          <span className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold',
                            u.role === 'Admin' && 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
                            u.role === 'Viewer' && 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
                          )}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
                            {u.role}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          {u.role === 'Viewer' ? (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                                <Pencil size={10} /> {editCount}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                                <Eye size={10} /> {viewCount}
                              </span>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[12px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Full access
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <Badge tone={u.status === 'Active' ? 'ok' : u.status === 'Pending' ? 'warn' : 'neutral'}>{u.status}</Badge>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-center">
                            {u.status === 'Pending' ? (
                              <Button variant="success" className="!px-3 !py-1.5 text-xs" onClick={() => { toggleStatus(u.id); toast(`${u.username} approved`); }}>Approve</Button>
                            ) : u.role !== 'Admin' ? (
                              <Toggle on={u.status === 'Active'} onChange={() => { toggleStatus(u.id); toast(`${u.username} ${u.status === 'Active' ? 'disabled' : 'enabled'}`, 'info'); }} />
                            ) : null}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end">
                            {u.role !== 'Admin' && (
                              <button
                                onClick={() => { setUsers((s) => s.filter((x) => x.id !== u.id)); toast('User removed', 'info'); }}
                                className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15 dark:hover:text-red-400"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
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
      </div>

      <Dialog
        open={inviteOpen}
        onClose={() => { setInviteOpen(false); resetInviteForm(); }}
        title="Invite User"
        subtitle="Add a new user and assign their role"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setInviteOpen(false); resetInviteForm(); }}>Cancel</Button>
            <Button onClick={inviteUser}><UserPlus size={15} /> Add User</Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Email Address *" type="email" placeholder="user@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            <Input label="Username *" placeholder="e.g. ramesh.staff" value={inviteUsername} onChange={(e) => setInviteUsername(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Password *" type="password" placeholder="Min 8 characters" value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} />
            <Input label="Confirm Password *" type="password" placeholder="Re-enter password" value={inviteConfirmPassword} onChange={(e) => setInviteConfirmPassword(e.target.value)} />
          </div>
          <Select label="Role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} options={['Admin', 'Viewer'].map((r) => ({ value: r, label: r }))} />
          <p className="text-[12px] text-muted -mt-3">
            {inviteRole === 'Admin' ? 'Admin has full edit access to all modules.' : 'Viewer can be assigned specific module permissions below.'}
          </p>

          {isViewer && (
            <div className="overflow-hidden rounded-2xl border-[0.5px] border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,.04)] dark:border-white/[.08] dark:bg-surface2">
              <div className="relative overflow-hidden bg-gradient-to-r from-violet-700 via-violet-600 to-purple-600 px-5 py-4">
                <span className="pointer-events-none absolute -right-8 -top-10 h-20 w-20 rounded-full bg-white/10 blur-xl" />
                <div className="relative flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20">
                    <Eye size={16} className="text-white" />
                  </span>
                  <div>
                    <div className="text-[14px] font-bold tracking-tight text-white">Module Permissions</div>
                    <div className="text-[11px] text-white/65">Check modules to grant edit access — unchecked get view-only</div>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-white/[.05]">
                {inviteAccess.map((a) => (
                  <label key={a.module} className="flex cursor-pointer items-center gap-4 px-5 py-3.5 transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[.02]">
                    <input
                      type="checkbox"
                      checked={a.access === 'edit'}
                      onChange={() => toggleModule(a.module)}
                      className="h-4 w-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-800"
                    />
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[.06] dark:text-slate-400">
                      {MODULE_ICONS[a.module]}
                    </span>
                    <span className="flex-1 text-[13.5px] font-medium text-ink">{a.module}</span>
                    <span className={cn(
                      'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                      a.access === 'edit'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-white/[.06] dark:text-slate-400',
                    )}>
                      {a.access === 'edit' ? 'Edit' : 'View only'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
