import { useState } from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/PageHeader';
import { EXPENSE_CATEGORIES } from '@/mock/DataContext';
import { ShieldCheck, UserPlus, Trash2 } from 'lucide-react';

interface AppUser { id: string; username: string; role: string; status: 'Active' | 'Pending' | 'Disabled'; }

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} role="switch" aria-checked={on}
      className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-success' : 'bg-slate-300 dark:bg-slate-700'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function Settings() {
  const toast = useToast();
  const [company, setCompany] = useState('Anush Capitals');
  const [tagline, setTagline] = useState('Microfinance & Lending');
  const [monthlyCycle, setMonthlyCycle] = useState('30');
  const [gaEnabled, setGaEnabled] = useState(true);

  const [users, setUsers] = useState<AppUser[]>([
    { id: 'u1', username: 'admin', role: 'Owner', status: 'Active' },
    { id: 'u2', username: 'priya.manager', role: 'Manager', status: 'Active' },
  ]);
  const [newUser, setNewUser] = useState('');
  const [newRole, setNewRole] = useState('Staff');

  const grant = () => {
    if (!newUser.trim()) { toast('Enter a username', 'error'); return; }
    setUsers((s) => [...s, { id: Math.random().toString(36).slice(2, 8), username: newUser.trim(), role: newRole, status: 'Pending' }]);
    setNewUser('');
    toast('Access request created (pending approval)');
  };
  const setStatus = (id: string, status: AppUser['status']) => setUsers((s) => s.map((u) => (u.id === id ? { ...u, status } : u)));

  return (
    <div className="space-y-5 p-3.5 sm:p-5">
      <PageHeader title="Settings" subtitle="Company profile, security and user access" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card tilt tiltMax={5} className="anim-pop">
          <CardHeader><CardTitle>Company</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <Input label="Company name" value={company} onChange={(e) => setCompany(e.target.value)} />
            <Input label="Tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} />
            <Button onClick={() => toast('Company settings saved')}>Save</Button>
          </CardBody>
        </Card>

        <Card tilt tiltMax={5} className="anim-pop" style={{ animationDelay: '70ms' }}>
          <CardHeader><CardTitle>Interest rules</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <Input label="Monthly cycle (days)" type="number" value={monthlyCycle} onChange={(e) => setMonthlyCycle(e.target.value)} />
            <p className="text-xs text-muted">Interest amount = principal × rate ÷ 100, calculated automatically on every loan. Daily loans run a fixed 100-day term.</p>
            <Button variant="ghost" onClick={() => toast('Rules saved')}>Save rules</Button>
          </CardBody>
        </Card>

        {/* Security / Google Authenticator */}
        <Card className="anim-pop lg:col-span-2" style={{ animationDelay: '140ms' }}>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck size={17} className="text-primary" /> Security</CardTitle></CardHeader>
          <CardBody>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <div>
                <div className="text-sm font-semibold">Google Authenticator (2FA)</div>
                <div className="text-xs text-muted">Require a time-based OTP at login. Integration will be wired to the backend later.</div>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={gaEnabled ? 'ok' : 'neutral'}>{gaEnabled ? 'Enabled' : 'Disabled'}</Badge>
                <Toggle on={gaEnabled} onChange={(v) => { setGaEnabled(v); toast(v ? 'Google Authenticator enabled' : 'Google Authenticator disabled', 'info'); }} />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* User access */}
        <Card className="anim-pop lg:col-span-2" style={{ animationDelay: '210ms' }}>
          <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus size={17} className="text-primary" /> User Access</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
              <Input label="Grant access to username" value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="e.g. ramesh.staff" />
              <Select label="Role" value={newRole} onChange={(e) => setNewRole(e.target.value)} options={['Manager', 'Staff', 'Viewer'].map((r) => ({ value: r, label: r }))} />
              <Button onClick={grant}><UserPlus size={15} /> Grant access</Button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-white/[.06]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800"><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">Username</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-slate-100 dark:border-white/[.06]">
                      <td className="px-4 py-3 font-medium">{u.username}</td>
                      <td className="px-4 py-3 text-muted">{u.role}</td>
                      <td className="px-4 py-3"><Badge tone={u.status === 'Active' ? 'ok' : u.status === 'Pending' ? 'warn' : 'neutral'}>{u.status}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {u.status === 'Pending' && <Button variant="success" className="!px-3 !py-1.5 text-xs" onClick={() => { setStatus(u.id, 'Active'); toast(`${u.username} approved`); }}>Approve</Button>}
                          {u.role !== 'Owner' && (
                            u.status === 'Disabled'
                              ? <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setStatus(u.id, 'Active')}>Enable</Button>
                              : <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => { setStatus(u.id, 'Disabled'); toast(`${u.username} disabled`, 'info'); }}>Disable</Button>
                          )}
                          {u.role !== 'Owner' && <button onClick={() => { setUsers((s) => s.filter((x) => x.id !== u.id)); toast('User removed', 'info'); }} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger-50 hover:text-danger"><Trash2 size={15} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card className="anim-pop lg:col-span-2" style={{ animationDelay: '280ms' }}>
          <CardHeader><CardTitle>Expense categories</CardTitle></CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            {EXPENSE_CATEGORIES.map((c) => <Badge key={c} tone="neutral">{c}</Badge>)}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
