import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileText, Link2, Sparkles, Zap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import type { User } from '../types';
import { Alert, Button, Field, Input, LogoMark } from '../ui';

export function Login({ setup }: { setup: boolean }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ user: User }>(setup ? '/auth/setup' : '/auth/login', setup ? { email, name, password } : { email, password });
      qc.setQueryData(['me'], r.user);
      qc.invalidateQueries({ queryKey: ['auth-status'] });
    } catch (err) {
      const details = err instanceof ApiError && Array.isArray(err.details) ? (err.details as Array<{ message: string }>)[0]?.message : '';
      setError(details || (err instanceof Error ? err.message : 'Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth-form" onSubmit={submit}>
        <div className="logo" style={{ padding: 0 }}>
          <LogoMark size={32} /> Multiplier
        </div>
        <h1>{setup ? 'Create your workspace' : 'Welcome back'}</h1>
        <p className="muted" style={{ marginBottom: 24 }}>
          {setup ? 'You’re the first one here. Set up the owner account to get started.' : 'Sign in to build personalised pages and PDFs.'}
        </p>
        <div className="col" style={{ gap: 14, maxWidth: 380 }}>
          {setup ? (
            <Field label="Your name">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Alex Morgan" />
            </Field>
          ) : null}
          <Field label="Work email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" autoFocus />
          </Field>
          <Field label="Password" hint={setup ? 'At least 10 characters.' : undefined}>
            <Input type="password" required minLength={setup ? 10 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? 'new-password' : 'current-password'} />
          </Field>
          {error ? <Alert tone="bad">{error}</Alert> : null}
          <Button variant="primary" type="submit" loading={busy} block>
            {setup ? 'Create account' : 'Sign in'} <ArrowRight size={15} />
          </Button>
        </div>
      </form>
      <div className="auth-art">
        <h2>One PDF in. A page and a PDF for every prospect out.</h2>
        <p>Turn the collateral you already have into outreach that reads like it was written for each person, straight from your Clay table.</p>
        <div className="auth-points">
          <div><FileText size={18} /> Upload a PDF and get a landing page built from it in seconds.</div>
          <div><Sparkles size={18} /> Name, company and job title change the copy, the PDF and who sees which section.</div>
          <div><Link2 size={18} /> Clay calls one endpoint per row and gets a unique link back.</div>
          <div><Zap size={18} /> See who opened, clicked and booked, and push it back into Clay.</div>
        </div>
      </div>
    </div>
  );
}
