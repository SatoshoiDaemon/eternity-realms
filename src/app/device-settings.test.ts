import { describe, expect, it } from 'vitest';
import {
  applyDeviceSettings,
  defaultDeviceSettings,
  DEVICE_SETTINGS_KEY,
  loadDeviceSettings,
  saveDeviceSettings,
} from './device-settings';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('persistent device settings', () => {
  it('uses defaults when no device preference exists', () => {
    expect(loadDeviceSettings(new MemoryStorage())).toEqual(defaultDeviceSettings);
  });

  it('loads persisted choices and fills omitted fields with defaults', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      DEVICE_SETTINGS_KEY,
      JSON.stringify({ theme: 'tokyo-night', fontScale: 1.15, notifications: { missions: false } }),
    );

    expect(loadDeviceSettings(storage)).toMatchObject({
      theme: 'tokyo-night',
      fontScale: 1.15,
      notifications: { missions: false, sessionComplete: true, rewards: true, queueIdle: true },
      language: 'pt-BR',
    });
  });

  it('falls back safely for malformed, invalid, or unavailable storage', () => {
    const malformed = new MemoryStorage();
    malformed.setItem(DEVICE_SETTINGS_KEY, '{');
    const invalid = new MemoryStorage();
    invalid.setItem(DEVICE_SETTINGS_KEY, JSON.stringify({ theme: 'unknown' }));

    expect(loadDeviceSettings(malformed)).toEqual(defaultDeviceSettings);
    expect(loadDeviceSettings(invalid)).toEqual(defaultDeviceSettings);
    expect(
      loadDeviceSettings({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {},
      }),
    ).toEqual(defaultDeviceSettings);
  });

  it('persists validated settings independently of character saves', () => {
    const storage = new MemoryStorage();
    const settings = { ...defaultDeviceSettings, theme: 'gruvbox' as const, developerMode: true };
    saveDeviceSettings(settings, storage);

    expect(JSON.parse(storage.getItem(DEVICE_SETTINGS_KEY) ?? '{}')).toEqual(settings);
    expect(loadDeviceSettings(storage)).toEqual(settings);
    expect(() => saveDeviceSettings({ ...settings, fontScale: 5 }, storage)).toThrow();
  });

  it('applies theme, motion, font size, and effect strength as semantic root tokens', () => {
    const root = document.createElement('html');
    applyDeviceSettings(
      {
        ...defaultDeviceSettings,
        theme: 'monochrome',
        motion: 'reduced',
        fontScale: 1.2,
        effectsIntensity: 35,
      },
      root,
    );

    expect(root.dataset.theme).toBe('monochrome');
    expect(root.dataset.motion).toBe('reduced');
    expect(root.style.getPropertyValue('--font-scale')).toBe('1.2');
    expect(root.style.getPropertyValue('--effects-intensity')).toBe('0.35');
  });
});
