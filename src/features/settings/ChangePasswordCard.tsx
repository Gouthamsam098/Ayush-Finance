import { useState } from 'react';
import { Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { config } from '@/lib/config';
import { authApi } from '@/services/authApi';
import {
  PASSWORD_MIN_CHARS, passwordChangeServerErrors, validatePasswordChange, type PasswordChangeErrors,
} from '@/lib/passwordRules';

type Field = keyof PasswordChangeErrors;

/**
 * The signed-in user changes their own password: current + new + confirm.
 * The server re-checks the current password, so an unattended session is not
 * enough to change it. Rules mirror the server (domain.PasswordChangeInput).
 */
export function ChangePasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<PasswordChangeErrors>({});
  const [saving, setSaving] = useState(false);

  const clear = (f: Field) => setErrors((e) => (e[f] ? { ...e, [f]: undefined } : e));

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    const e = validatePasswordChange(current, next, confirm);
    setErrors(e);
    if (Object.keys(e).length) return;
    if (!config.useApi) {
      toast('Password changes need the server — connect the app to the backend first.', 'info');
      return;
    }
    setSaving(true);
    try {
      await authApi.changePassword(current, next);
      setCurrent(''); setNext(''); setConfirm(''); setErrors({});
      toast('Password updated — use the new one the next time you sign in');
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(passwordChangeServerErrors(err.fields));
        toast(err.message, 'error');
      } else {
        toast('Could not update the password. Check your connection and try again.', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 p-4 sm:p-5">
      <p className="text-[12.5px] leading-relaxed text-muted">
        Enter your current password, then choose a new one (at least {PASSWORD_MIN_CHARS} characters).
        Other people&apos;s passwords are reset from User management below.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input
          revealPassword
          label="Current password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => { setCurrent(e.target.value); clear('current'); }}
          error={errors.current}
          disabled={saving}
        />
        <Input
          revealPassword
          label="New password"
          autoComplete="new-password"
          placeholder={`Min ${PASSWORD_MIN_CHARS} characters`}
          value={next}
          onChange={(e) => { setNext(e.target.value); clear('next'); }}
          error={errors.next}
          disabled={saving}
        />
        <Input
          revealPassword
          label="Confirm new password"
          autoComplete="new-password"
          placeholder="Re-enter new password"
          value={confirm}
          onChange={(e) => { setConfirm(e.target.value); clear('confirm'); }}
          error={errors.confirm}
          disabled={saving}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          <Lock size={15} /> Update password
        </Button>
      </div>
    </form>
  );
}
