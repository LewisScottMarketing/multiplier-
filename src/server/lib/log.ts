export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel = 'info', json = false): Logger {
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const out = lvl === 'error' || lvl === 'warn' ? console.error : console.log;
    if (json) out(safeStringify({ t: new Date().toISOString(), level: lvl, msg, ...fields }));
    else out(`${new Date().toISOString().slice(11, 19)} ${lvl.toUpperCase().padEnd(5)} ${msg}${fields ? ' ' + safeStringify(fields) : ''}`);
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => (val instanceof Error ? { name: val.name, message: val.message, stack: val.stack } : val));
  } catch {
    return '[unserialisable]';
  }
}
