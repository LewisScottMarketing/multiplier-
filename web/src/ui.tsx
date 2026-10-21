import { AlertTriangle, Check, CheckCircle2, Copy, Info, Loader2, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';

// ── Buttons ─────────────────────────────────────────────────────────────────

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger' | 'default';
  size?: 'xs' | 'sm' | 'md';
  icon?: boolean;
  loading?: boolean;
  block?: boolean;
}

export function Button({ variant = 'default', size = 'md', icon, loading, block, className = '', children, disabled, type = 'button', ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'default' ? variant : '', size !== 'md' ? size : '', icon ? 'icon' : '', block ? 'block' : '', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 size={15} className="spin" /> : null}
      {children}
    </button>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="spin" style={{ color: 'var(--ink-4)' }} />;
}

export function CenterSpinner() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 64 }}>
      <Spinner size={22} />
    </div>
  );
}

// ── Form controls ───────────────────────────────────────────────────────────

export function Field({ label, hint, error, children, right }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="field">
      {label ? (
        <label>
          {label}
          {right ? <span className="right" style={{ fontWeight: 400 }}>{right}</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <div className="err">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Input({ className = '', small, ...rest }: InputHTMLAttributes<HTMLInputElement> & { small?: boolean }) {
  return <input className={`input ${small ? 'sm' : ''} ${className}`} {...rest} />;
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`} {...rest} />;
}

export function Select({ className = '', small, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { small?: boolean }) {
  return (
    <select className={`select ${small ? 'sm' : ''} ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="switch" onClick={() => onChange(!checked)} />;
}

export function SwitchRow({ label, hint, checked, onChange }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="switch-row">
      <div>
        <div style={{ fontWeight: 560, fontSize: 13.5 }}>{label}</div>
        {hint ? <div className="hint">{hint}</div> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={typeof label === 'string' ? label : undefined} />
    </div>
  );
}

export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="color-field">
      <input type="color" className="swatch" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label="Pick a colour" />
      <Input
        small
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
        }}
        onBlur={() => setText(value)}
        style={{ fontFamily: 'var(--mono)', width: 104 }}
      />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: ReactNode; title?: string }>; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Badges & callouts ───────────────────────────────────────────────────────

export function Badge({ tone, children, dot }: { tone?: 'ok' | 'warn' | 'bad' | 'brand'; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge ${tone ?? ''}`}>
      {dot ? <i className="dot" /> : null}
      {children}
    </span>
  );
}

export function Alert({ tone, children, icon }: { tone?: 'warn' | 'bad' | 'ok'; children: ReactNode; icon?: ReactNode }) {
  const ic = icon ?? (tone === 'warn' || tone === 'bad' ? <AlertTriangle size={16} /> : tone === 'ok' ? <CheckCircle2 size={16} /> : <Info size={16} />);
  return (
    <div className={`alert ${tone ?? ''}`} role={tone === 'bad' ? 'alert' : undefined}>
      {ic}
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon-bubble">{icon}</div>
      <h3>{title}</h3>
      {children ? <p style={{ maxWidth: 420, margin: '0 auto' }}>{children}</p> : null}
      {action ? <div style={{ marginTop: 18 }}>{action}</div> : null}
    </div>
  );
}

// ── Copy ────────────────────────────────────────────────────────────────────

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function CopyButton({ text, label, size = 'sm', variant = 'default' }: { text: string; label?: string; size?: 'xs' | 'sm'; variant?: 'default' | 'ghost' }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      icon={!label}
      title="Copy"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {label ? (done ? 'Copied' : label) : null}
    </Button>
  );
}

export function CopyBox({ text, block }: { text: string; block?: boolean }) {
  return (
    <div className={`copy-box ${block ? 'block' : ''}`}>
      <span>{text}</span>
      <CopyButton text={text} size="xs" variant="ghost" />
    </div>
  );
}

export function CodeBlock({ text }: { text: string }) {
  return (
    <pre className="code">
      <span className="copy">
        <CopyButton text={text} size="xs" />
      </span>
      {text}
    </pre>
  );
}

// ── Menu ────────────────────────────────────────────────────────────────────

export function Menu({ trigger, children, align = 'right', up }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open ? <div className={`menu ${align === 'left' ? 'left' : ''} ${up ? 'up' : ''}`}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

// ── Modal & drawer ──────────────────────────────────────────────────────────

export function Modal({ title, onClose, children, footer, size, description }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'xwide'; description?: ReactNode }) {
  const titleId = useId();
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <div className="grow">
            <h2 id={titleId}>{title}</h2>
            {description ? <p className="muted" style={{ marginTop: 4 }}>{description}</p> : null}
          </div>
          <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close">
            <X size={16} />
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ title, onClose, children, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="grow">{title}</div>
          {actions}
          <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close">
            <X size={16} />
          </Button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>,
    document.body,
  );
}

// ── Toasts ──────────────────────────────────────────────────────────────────

interface ToastItem {
  id: number;
  tone: 'ok' | 'bad';
  text: string;
}
const ToastCtx = createContext<{ ok: (t: string) => void; error: (t: string) => void }>({ ok: () => {}, error: () => {} });
export const useToast = () => useContext(ToastCtx);

// ── Confirm ─────────────────────────────────────────────────────────────────

interface ConfirmOpts {
  title: string;
  body?: ReactNode;
  confirm?: string;
  danger?: boolean;
}
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const push = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 6000 : 3000);
  }, []);
  const api = useMemo(() => ({ ok: (t: string) => push('ok', t), error: (t: string) => push('bad', t) }), [push]);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  return (
    <ToastCtx.Provider value={api}>
      <ConfirmCtx.Provider value={ask}>
        {children}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.tone}`}>
              {t.tone === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              {t.text}
            </div>
          ))}
        </div>
        {confirm ? (
          <Modal
            title={confirm.title}
            onClose={() => {
              confirm.resolve(false);
              setConfirm(null);
            }}
            footer={
              <>
                <Button
                  onClick={() => {
                    confirm.resolve(false);
                    setConfirm(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant={confirm.danger ? 'danger' : 'primary'}
                  className={confirm.danger ? 'solid' : ''}
                  onClick={() => {
                    confirm.resolve(true);
                    setConfirm(null);
                  }}
                >
                  {confirm.confirm ?? 'Confirm'}
                </Button>
              </>
            }
          >
            <div className="muted">{confirm.body}</div>
          </Modal>
        ) : null}
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

// ── Brand ───────────────────────────────────────────────────────────────────

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
        <path d="M5 5l14 14M19 5L5 19" />
      </svg>
    </span>
  );
}
