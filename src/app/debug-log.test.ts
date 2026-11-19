import { describe, expect, it } from 'vitest';
import { DebugLog } from './debug-log';

describe('developer log buffer', () => {
  it('filters by verbosity, level, and subsystem and includes technical context on request', () => {
    let now = 1_700_000_000_000;
    const log = new DebugLog(10, () => ++now);
    log.write('error', 'persistence', 'Database error', { transactionId: 'tx-1' });
    log.write('info', 'app', 'Ready');
    log.write('trace', 'combat', 'Damage resolved', { seed: 48 });

    expect(log.list().map((entry) => entry.message)).toEqual(['Database error', 'Ready']);
    expect(log.list({ verbose: true, subsystem: 'combat' })).toHaveLength(1);
    expect(log.list({ minimumLevel: 'warn' })).toHaveLength(1);
    expect(log.format({ verbose: true })[0]).toContain('persistence log-');
    expect(log.format({ verbose: true })[0]).toContain('"transactionId":"tx-1"');
    expect(log.format({ minimumLevel: 'error' })).toEqual(['ERROR persistence Database error']);
  });

  it('bounds memory, clones details, and can clear the buffer', () => {
    let now = 10;
    const log = new DebugLog(2, () => now++);
    const details = { nested: { seed: 6 } };
    log.write('debug', 'nodes', 'Graph compiled', details);
    details.nested.seed = 7;
    log.write('warn', 'app', 'Notice');
    log.write('info', 'app', 'Ready');

    expect(log.list({ verbose: true }).map((entry) => entry.message)).toEqual(['Notice', 'Ready']);
    log.clear();
    expect(log.list({ verbose: true })).toEqual([]);
  });
});
