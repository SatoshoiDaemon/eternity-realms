import { describe, expect, it } from 'vitest';
import { loadContentPacks, loadOfficialContent } from './registry';
import { testPack } from '../test/fixtures';

describe('declarative content registry', () => {
  it('loads official content through the same validation pipeline as external packs', () => {
    const official = loadOfficialContent();

    expect(official.races.get('human')?.name).toBe('Humano');
    expect(official.activities.get('mining')?.rewardId).toBe('mining-iron');
    expect(official.activities.get('foraging')?.rewardId).toBe('foraging-herbs');
    expect(official.rewards.get('mining-iron')?.items[0]?.itemId).toBe('iron-ore');
    expect(official.rewards.get('foraging-herbs')?.items[0]?.itemId).toBe('wild-herb');
    expect(official.items.has('iron-ore')).toBe(true);
    expect(official.skills.has('mining-skill')).toBe(true);
    expect(official.effects.has('focused-work')).toBe(true);
    expect(official.rules.experiencePerLevel).toBe(80);
  });

  it('allows a later content pack to override an id deliberately', () => {
    const override = {
      ...testPack,
      manifest: { id: 'test.override', name: 'Override', version: '1.0.0' },
      records: [
        {
          id: 'iron-ore',
          kind: 'item',
          name: 'Rich Iron Ore',
          description: 'Modded.',
          stackable: true,
        },
      ],
    };

    expect(loadContentPacks([testPack, override]).items.get('iron-ore')?.name).toBe(
      'Rich Iron Ore',
    );
  });

  it('rejects malformed packs, duplicate ids inside one pack, and unresolved references', () => {
    expect(() => loadContentPacks([{}])).toThrow();
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          records: [...testPack.records, testPack.records[0]],
        },
      ]),
    ).toThrow('Duplicate content id in pack: human');
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          records: testPack.records.filter((record) => record.id !== 'mining-reward'),
        },
      ]),
    ).toThrow('Activity "mining" references missing reward "mining-reward".');
    expect(() => loadContentPacks([testPack, testPack])).toThrow(
      'Duplicate content pack id: test.core',
    );
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          records: testPack.records.map((record) =>
            record.id === 'mining-reward' && record.kind === 'reward'
              ? { ...record, items: [{ itemId: 'missing-item', quantity: 1 }] }
              : record,
          ),
        },
      ]),
    ).toThrow('Reward "mining-reward" references missing item "missing-item".');
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          records: testPack.records.map((record) =>
            record.id === 'mining-skill' && record.kind === 'skill'
              ? { ...record, activityIds: ['missing-activity'] }
              : record,
          ),
        },
      ]),
    ).toThrow('Skill "mining-skill" references missing activity "missing-activity".');
  });
});
