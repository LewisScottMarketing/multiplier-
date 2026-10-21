import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/server/lib/log';

afterEach(() => vi.restoreAllMocks());

describe('logger', () => {
  it('keeps the message and stack of an Error in JSON mode, where production logs are read', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    createLogger('info', true).error('unhandled error', { err: new Error('disk is full'), path: '/p/abc…' });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: 'error', msg: 'unhandled error', path: '/p/abc…', err: { name: 'Error', message: 'disk is full' } });
    expect(line.err.stack).toContain('disk is full');
  });

  it('never throws because of what it was asked to log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => createLogger('info', true).info('hello', { circular })).not.toThrow();
    expect(() => createLogger('info', false).info('hello', { circular })).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('respects the level', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    createLogger('warn').info('quiet');
    expect(spy).not.toHaveBeenCalled();
  });
});
