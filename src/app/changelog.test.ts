import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPLICATION_VERSION,
  CHANGELOG_SEEN_KEY,
  bundledChangelogs,
  checkLatestRelease,
  compareVersions,
  getUnseenChangelogs,
  recordChangelogSeen,
} from './changelog';

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe('offline changelog and optional release check', () => {
  beforeEach(() => localStorage.clear());

  it('shows all bundled changes on first install and only newer versions afterward', () => {
    expect(getUnseenChangelogs(null)).toEqual(bundledChangelogs);
    expect(
      getUnseenChangelogs(null, [
        { ...bundledChangelogs[0]!, version: '0.2.0' },
        { ...bundledChangelogs[0]!, version: '0.1.0' },
      ]).map((entry) => entry.version),
    ).toEqual(['0.1.0', '0.2.0']);
    expect(getUnseenChangelogs('0.1.0')).toEqual([]);
    expect(
      getUnseenChangelogs('0.0.5', [
        { ...bundledChangelogs[0]!, version: '0.1.0' },
        { ...bundledChangelogs[0]!, version: '0.2.0' },
      ]).map((entry) => entry.version),
    ).toEqual(['0.1.0', '0.2.0']);
    expect(compareVersions('v2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0-preview.2')).toBe(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
  });

  it('records the highest version seen without moving the marker backward', () => {
    recordChangelogSeen(localStorage, '0.2.0');
    recordChangelogSeen(localStorage, '0.1.0');
    expect(localStorage.getItem(CHANGELOG_SEEN_KEY)).toBe('0.2.0');
    recordChangelogSeen(localStorage);
    expect(localStorage.getItem(CHANGELOG_SEEN_KEY)).toBe('0.2.0');
    expect(APPLICATION_VERSION).toBe('0.1.0');
  });

  it('returns the latest stable release or a preview release by channel', async () => {
    const fetcher = vi.fn(async () =>
      response([
        {
          tag_name: 'v0.4.0-rc.1',
          html_url: 'https://github.com/test/release/4',
          published_at: '2026-11-19T00:00:00Z',
          prerelease: true,
        },
        {
          tag_name: 'v0.3.0',
          html_url: 'https://github.com/test/release/3',
          published_at: '2026-11-18T00:00:00Z',
          prerelease: false,
        },
      ]),
    );
    expect(
      await checkLatestRelease('stable', '0.2.0', fetcher as unknown as typeof fetch),
    ).toMatchObject({ version: '0.3.0', preview: false });
    expect(
      await checkLatestRelease('preview', '0.2.0', fetcher as unknown as typeof fetch),
    ).toMatchObject({ version: '0.4.0-rc.1', preview: true });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('SatoshoiDaemon/eternity-realms/releases'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('reports no update and surfaces HTTP or malformed release responses', async () => {
    expect(
      await checkLatestRelease('stable', APPLICATION_VERSION, (async () =>
        response([
          {
            tag_name: 'v0.1.0',
            html_url: 'https://github.com/test/release',
            published_at: '2026-11-19',
            prerelease: false,
          },
        ])) as typeof fetch),
    ).toBeNull();
    await expect(
      checkLatestRelease('stable', '0.0.0', (async () => response([], false, 503)) as typeof fetch),
    ).rejects.toThrow('HTTP 503');
    await expect(
      checkLatestRelease('stable', '0.0.0', (async () =>
        response([{ tag_name: 'invalid' }])) as typeof fetch),
    ).rejects.toThrow();
    await expect(
      checkLatestRelease('stable', '0.0.0', (async () => {
        throw new Error('offline');
      }) as typeof fetch),
    ).rejects.toThrow('offline');
  });
});
