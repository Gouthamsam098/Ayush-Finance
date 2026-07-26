import { useState } from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import {
  ShieldCheck, UserPlus, Trash2, LayoutDashboard, Users, FileText,
  Receipt, Wallet, FolderOpen, Settings as SettingsIcon, Eye, Pencil,
} from 'lucide-react';

type AccessLevel = 'none' | 'view' | 'edit';
interface ModuleAccess { module: string; access: AccessLevel; }
interface AppUser {
  id: string; username: string; role: string; status: 'Active' | 'Pending' | 'Disabled';
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
    { id: 'u1', username: 'admin', role: 'Owner', status: 'Active', moduleAccess: defaultAccess().map((m) => ({ ...m, access: 'edit' as AccessLevel })) },
    { id: 'u2', username: 'priya.manager', role: 'Manager', status: 'Active', moduleAccess: defaultAccess().map((m) => ({ ...m, access: 'edit' as AccessLevel })) },
  ]);
  const [newUser, setNewUser] = useState('');
  const [newRole, setNewRole] = useState('Staff');
  const [newAccess, setNewAccess] = useState<ModuleAccess[]>(defaultAccess());

  const isViewer = newRole === 'Viewer';

  const setAccess = (module: string, level: AccessLevel) => {
    setNewAccess((prev) => prev.map((a) => (a.module === module ? { ...a, access: level } : a)));
  };

  const grant = () => {
    if (!newUser.trim()) { toast('Enter a username', 'error'); return; }
    setUsers((s) => [...s, {
      id: Math.random().toString(36).slice(2, 8),
      username: newUser.trim(),
      role: newRole,
      status: 'Pending',
      moduleAccess: isViewer ? newAccess : defaultAccess().map((m) => ({ ...m, access: 'edit' as AccessLevel })),
    }]);
    setNewUser('');
    setNewAccess(defaultAccess());
    toast('Access request created (pending approval)');
  };

  const toggleStatus = (id: string) =>
    setUsers((s) => s.map((u) => (u.id === id ? { ...u, status: u.status === 'Disabled' ? 'Active' : 'Disabled' } : u)));

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        icon={<SettingsIcon size={20} />}
        title="Settings"
        subtitle="Security and user access"
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
          <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus size={17} className="text-primary" /> User Access</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
              <Input label="Grant access to username" value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="e.g. ramesh.staff" />
              <Select label="Role" value={newRole} onChange={(e) => setNewRole(e.target.value)} options={['Manager', 'Staff', 'Viewer'].map((r) => ({ value: r, label: r }))} />
              <Button onClick={grant}><UserPlus size={15} /> Grant access</Button>
            </div>

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
                      <div className="text-[11px] text-white/65">Configure what this Viewer can access</div>
                    </div>
                    <div className="ml-auto flex items-center gap-3 text-[11px] font-semibold text-white/70">
                      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-white/50" /> View</span>
                      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-white" /> Edit</span>
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-white/[.05]">
                  {newAccess.map((a) => (
                    <div key={a.module} className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[.02]">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[.06] dark:text-slate-400">
                        {MODULE_ICONS[a.module]}
                      </span>
                      <span className="flex-1 text-[13.5px] font-medium text-ink">{a.module}</span>
                      <div className="flex items-center gap-5">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <Toggle
                            on={a.access === 'view' || a.access === 'edit'}
                            onChange={() => setAccess(a.module, a.access === 'none' ? 'view' : a.access === 'view' ? 'none' : 'view')}
                          />
                          <span className="text-[12px] font-medium text-muted">View</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <Toggle
                            on={a.access === 'edit'}
                            onChange={() => setAccess(a.module, a.access === 'edit' ? 'view' : 'edit')}
                          />
                          <span className="text-[12px] font-medium text-muted">Edit</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-white/[.06]">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-gradient-to-r from-blue-800 via-blue-700 to-blue-600">
                  <tr className="text-left text-[12px] font-bold uppercase tracking-[0.08em] text-white">
                    <th className="px-5 py-3.5">Username</th>
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
                        <td className="px-5 py-4">
                          <span className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold',
                            u.role === 'Owner' && 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
                            u.role === 'Manager' && 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
                            u.role === 'Staff' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
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
                            ) : u.role !== 'Owner' ? (
                              <Toggle on={u.status === 'Active'} onChange={() => { toggleStatus(u.id); toast(`${u.username} ${u.status === 'Active' ? 'disabled' : 'enabled'}`, 'info'); }} />
                            ) : null}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end">
                            {u.role !== 'Owner' && (
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
    </div>
  );
}
