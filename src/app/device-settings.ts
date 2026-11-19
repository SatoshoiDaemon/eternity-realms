import { z } from 'zod';

export const DEVICE_SETTINGS_KEY = 'eternity-realms:device-settings:v1';

export const themeIds = ['catppuccin-mocha', 'tokyo-night', 'monochrome', 'gruvbox'] as const;
export type ThemeId = (typeof themeIds)[number];

export const DeviceSettingsSchema = z.object({
  theme: z.enum(themeIds).default('catppuccin-mocha'),
  fontScale: z.number().min(0.85).max(1.3).default(1),
  motion: z.enum(['full', 'reduced', 'off']).default('full'),
  effectsIntensity: z.number().int().min(0).max(100).default(80),
  language: z.literal('pt-BR').default('pt-BR'),
  notifications: z
    .object({
      sessionComplete: z.boolean().default(true),
      queueIdle: z.boolean().default(true),
      rewards: z.boolean().default(true),
      missions: z.boolean().default(true),
    })
    .default({ sessionComplete: true, queueIdle: true, rewards: true, missions: true }),
  backup: z
    .object({
      frequency: z.enum(['off', 'daily', 'weekly']).default('off'),
      retention: z.number().int().min(1).max(30).default(7),
    })
    .default({ frequency: 'off', retention: 7 }),
  updateChannel: z.enum(['stable', 'preview']).default('stable'),
  developerMode: z.boolean().default(false),
  verboseLogs: z.boolean().default(false),
});

export type DeviceSettings = z.infer<typeof DeviceSettingsSchema>;

export const defaultDeviceSettings: DeviceSettings = DeviceSettingsSchema.parse({});

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadDeviceSettings(storage: StoragePort): DeviceSettings {
  try {
    const value = storage.getItem(DEVICE_SETTINGS_KEY);
    if (value === null) return defaultDeviceSettings;
    return DeviceSettingsSchema.parse(JSON.parse(value));
  } catch {
    return defaultDeviceSettings;
  }
}

export function saveDeviceSettings(settings: DeviceSettings, storage: StoragePort): void {
  storage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(DeviceSettingsSchema.parse(settings)));
}

export function applyDeviceSettings(settings: DeviceSettings, root: HTMLElement): void {
  root.dataset.theme = settings.theme;
  root.dataset.motion = settings.motion;
  root.style.setProperty('--font-scale', String(settings.fontScale));
  root.style.setProperty('--effects-intensity', String(settings.effectsIntensity / 100));
}
