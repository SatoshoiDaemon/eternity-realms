import { describe, expect, it } from 'vitest';
import { createTestState } from '../test/fixtures';
import { getEnergyAttributeAccessError, isEnergyResourceAvailable } from './energy-rules';

describe('energy attribute and resource rules', () => {
  const character = (affinity: string) => ({
    ...createTestState().character!,
    energy: { affinity, reserves: {} },
  });

  it('separates direct allocation, training, and affinity-specific attributes', () => {
    expect(
      getEnergyAttributeAccessError(character('unaffiliated'), 'energy:mana', 'allocate'),
    ).toBe('Sem Afinidade characters cannot allocate energy attributes.');
    expect(getEnergyAttributeAccessError(character('unaffiliated'), 'energy:chi', 'train')).toBe(
      'Sem Afinidade characters cannot train energy attributes.',
    );
    expect(getEnergyAttributeAccessError(character('aura'), 'energy:chi', 'allocate')).toContain(
      'cannot be allocated directly',
    );
    expect(getEnergyAttributeAccessError(character('aura'), 'energy:mana', 'allocate')).toContain(
      'cannot allocate Mana or Spirit',
    );
    expect(getEnergyAttributeAccessError(character('aura'), 'energy:spirit', 'train')).toContain(
      'cannot train Mana or Spirit',
    );
    expect(getEnergyAttributeAccessError(character('mana'), 'energy:chi', 'train')).toContain(
      'cannot train Chi',
    );
    expect(
      getEnergyAttributeAccessError(character('mana'), 'energy:mana', 'train'),
    ).toBeUndefined();
    expect(getEnergyAttributeAccessError(character('aura'), 'energy:chi', 'train')).toBeUndefined();
    expect(getEnergyAttributeAccessError(character('unawakened'), 'physical:speed', 'train')).toBe(
      undefined,
    );
  });

  it('makes Mana and Aura reserves available only to their selected path', () => {
    expect(isEnergyResourceAvailable('mana', 'mana')).toBe(true);
    expect(isEnergyResourceAvailable('mana', 'aura')).toBe(false);
    expect(isEnergyResourceAvailable('aura', 'aura')).toBe(true);
    expect(isEnergyResourceAvailable('aura', 'mana')).toBe(false);
    expect(isEnergyResourceAvailable('unaffiliated', 'mana')).toBe(false);
    expect(isEnergyResourceAvailable('unaffiliated', 'aura')).toBe(false);
    expect(isEnergyResourceAvailable('unaffiliated', 'focus')).toBe(true);
    expect(isEnergyResourceAvailable('unawakened', 'mana')).toBe(true);
    expect(isEnergyResourceAvailable('unawakened', 'custom')).toBe(true);
  });
});
