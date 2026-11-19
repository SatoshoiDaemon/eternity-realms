import { beforeEach, describe, expect, it, vi } from 'vitest';

const pluginMocks = vi.hoisted(() => ({
  native: false,
  configure: vi.fn(async (options: unknown) => options),
  setMetadata: vi.fn(async () => undefined),
  setSnapshot: vi.fn(async () => undefined),
  writeBackup: vi.fn(async () => ({ id: 'manual-1.json', createdAt: 1 })),
  listBackups: vi.fn(async () => ({
    backups: [{ id: 'auto-1.json', createdAt: 1, characterName: 'Aria', automatic: true }],
  })),
  readBackup: vi.fn(async () => ({ payload: '{"formatVersion":1}' })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => pluginMocks.native },
  registerPlugin: () => ({
    configure: pluginMocks.configure,
    setMetadata: pluginMocks.setMetadata,
    setSnapshot: pluginMocks.setSnapshot,
    writeBackup: pluginMocks.writeBackup,
    listBackups: pluginMocks.listBackups,
    readBackup: pluginMocks.readBackup,
  }),
}));

import {
  configureAutomaticBackups,
  isNativeBackupAvailable,
  listNativeBackups,
  readNativeBackup,
  setBackupSnapshot,
  setBackupMetadata,
  writeNativeBackup,
} from './backup-scheduler';

describe('Android automatic backup bridge', () => {
  beforeEach(() => {
    pluginMocks.native = false;
    vi.clearAllMocks();
  });

  it('keeps browser settings usable without invoking Android APIs', async () => {
    expect(isNativeBackupAvailable()).toBe(false);
    await configureAutomaticBackups('off', 7);
    await setBackupMetadata('0.1.0', []);
    await setBackupSnapshot('{"schemaVersion":1}');
    expect(pluginMocks.configure).not.toHaveBeenCalled();
    expect(pluginMocks.setMetadata).not.toHaveBeenCalled();
    expect(pluginMocks.setSnapshot).not.toHaveBeenCalled();
  });

  it('configures scheduled retention and shares release and dependency metadata with WorkManager', async () => {
    pluginMocks.native = true;
    expect(isNativeBackupAvailable()).toBe(true);
    await configureAutomaticBackups('weekly', 10);
    await setBackupMetadata('0.1.0', ['eternity.core', 'mod.test']);
    await setBackupSnapshot('{"schemaVersion":1}');
    expect(pluginMocks.configure).toHaveBeenCalledWith({ frequency: 'weekly', retention: 10 });
    expect(pluginMocks.setMetadata).toHaveBeenCalledWith({
      applicationVersion: '0.1.0',
      modDependencies: '["eternity.core","mod.test"]',
    });
    expect(pluginMocks.setSnapshot).toHaveBeenCalledWith({ payload: '{"schemaVersion":1}' });
  });

  it('creates, lists, and reads native backup files', async () => {
    pluginMocks.native = true;
    expect(await writeNativeBackup('{"save":true}')).toMatchObject({
      id: 'manual-1.json',
      automatic: false,
    });
    expect(await listNativeBackups()).toEqual([
      { id: 'auto-1.json', createdAt: 1, characterName: 'Aria', automatic: true },
    ]);
    expect(await readNativeBackup('auto-1.json')).toBe('{"formatVersion":1}');
  });
});
