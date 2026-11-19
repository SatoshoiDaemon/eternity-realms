import currentRelease from '../../content/changelogs/0.1.0.json';
import { z } from 'zod';

export const CHANGELOG_SEEN_KEY = 'eternity-realms:changelog-seen:v1';
export const APPLICATION_VERSION = '0.1.0';

const categories = ['added', 'improved', 'changed', 'fixed', 'removed', 'technical'] as const;
const ReleaseNotesSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  date: z.string().date(),
  changes: z.object(
    Object.fromEntries(categories.map((category) => [category, z.array(z.string())])),
  ),
});

export type ReleaseNotes = z.infer<typeof ReleaseNotesSchema>;
export const bundledChangelogs: ReleaseNotes[] = [ReleaseNotesSchema.parse(currentRelease)];

export function compareVersions(left: string, right: string): number {
  const normalize = (version: string) =>
    version.replace(/^v/, '').split('-')[0]!.split('.').map(Number);
  const a = normalize(left);
  const b = normalize(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export function getUnseenChangelogs(
  seenVersion: string | null,
  notes = bundledChangelogs,
): ReleaseNotes[] {
  if (!seenVersion) return [...notes].sort((a, b) => compareVersions(a.version, b.version));
  return notes
    .filter((entry) => compareVersions(entry.version, seenVersion) > 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

export function recordChangelogSeen(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  version = APPLICATION_VERSION,
): void {
  const current = storage.getItem(CHANGELOG_SEEN_KEY);
  if (!current || compareVersions(version, current) > 0)
    storage.setItem(CHANGELOG_SEEN_KEY, version);
}

export interface LatestRelease {
  version: string;
  url: string;
  publishedAt: string;
  preview: boolean;
}

export async function checkLatestRelease(
  channel: 'stable' | 'preview',
  currentVersion = APPLICATION_VERSION,
  fetcher: typeof fetch = fetch,
): Promise<LatestRelease | null> {
  const response = await fetcher(
    'https://api.github.com/repos/SatoshoiDaemon/eternity-realms/releases?per_page=20',
    {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`A consulta de versões respondeu HTTP ${response.status}.`);
  const payload: unknown = await response.json();
  const releases = z
    .array(
      z.object({
        tag_name: z.string(),
        html_url: z.string().url(),
        published_at: z.string(),
        prerelease: z.boolean(),
        draft: z.boolean().optional(),
      }),
    )
    .parse(payload);
  const eligible = releases
    .filter((release) => !release.draft && (channel === 'preview' || !release.prerelease))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  const latest = eligible[0];
  if (!latest || compareVersions(latest.tag_name, currentVersion) <= 0) return null;
  return {
    version: latest.tag_name.replace(/^v/, ''),
    url: latest.html_url,
    publishedAt: latest.published_at,
    preview: latest.prerelease,
  };
}
