import { Capacitor, registerPlugin } from '@capacitor/core';

export interface BackupSummary {
  id: string;
  createdAt: number;
  characterName: string;
  automatic: boolean;
}

interface BackupSchedulerPlugin {
  configure(options: {
    frequency: 'off' | 'daily' | 'weekly';
    retention: number;
  }): Promise<unknown>;
  setMetadata(options: { applicationVersion: string; modDependencies: string }): Promise<void>;
  setSnapshot(options: { payload: string }): Promise<void>;
  writeBackup(options: { payload: string }): Promise<{ id: string; createdAt: number }>;
  listBackups(): Promise<{ backups: BackupSummary[] }>;
  readBackup(options: { id: string }): Promise<{ payload: string }>;
}

const BackupScheduler = registerPlugin<BackupSchedulerPlugin>('BackupScheduler');

export function isNativeBackupAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export async function configureAutomaticBackups(
  frequency: 'off' | 'daily' | 'weekly',
  retention: number,
): Promise<void> {
  if (!isNativeBackupAvailable()) return;
  await BackupScheduler.configure({ frequency, retention });
}

export async function setBackupMetadata(
  applicationVersion: string,
  modDependencies: string[],
): Promise<void> {
  if (!isNativeBackupAvailable()) return;
  await BackupScheduler.setMetadata({
    applicationVersion,
    modDependencies: JSON.stringify(modDependencies),
  });
}

export async function setBackupSnapshot(payload: string): Promise<void> {
  if (!isNativeBackupAvailable()) return;
  await BackupScheduler.setSnapshot({ payload });
}

export async function writeNativeBackup(payload: string): Promise<BackupSummary> {
  const result = await BackupScheduler.writeBackup({ payload });
  return { ...result, characterName: 'Save atual', automatic: false };
}

export async function listNativeBackups(): Promise<BackupSummary[]> {
  const result = await BackupScheduler.listBackups();
  return result.backups;
}

export async function readNativeBackup(id: string): Promise<string> {
  const result = await BackupScheduler.readBackup({ id });
  return result.payload;
}
