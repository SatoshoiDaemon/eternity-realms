import { describe, expect, it } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import { createTestState } from '../test/fixtures';
import {
  buyFromShop,
  exchangeOrbs,
  getShopOffers,
  getShopPrices,
  getShopStockRemaining,
  sellToShop,
} from './economy';
import type { ShopDefinition, SkillDefinition } from '../content/schema';

const content = loadOfficialContent();

describe('offline economy', () => {
  it('rotates a deterministic daily selection across the complete local offer pool', () => {
    const daily = content.shops.get('shop:daily')!;
    const permanent = content.shops.get('shop:fragments')!;
    const first = getShopOffers(daily, 0);
    const second = getShopOffers(daily, 86_400_000);
    const third = getShopOffers(daily, 2 * 86_400_000);

    expect(first.map((entry) => entry.itemId)).toEqual([
      'healing-potion',
      'wild-herb',
      'iron-ore',
      'mana-potion',
    ]);
    expect(getShopOffers(daily, 1)).toEqual(first);
    expect(second.map((entry) => entry.itemId)).toEqual([
      'aura-tonic',
      'ore-silver',
      'oak-log',
      'wheat',
    ]);
    expect(third.map((entry) => entry.itemId)).toEqual([
      'river-carp',
      'beast-hide',
      'arcane-crystal',
      'rune-token',
    ]);
    expect(new Set([...first, ...second, ...third].map((entry) => entry.itemId)).size).toBe(
      daily.entries.length,
    );
    expect(getShopOffers(permanent, 0)).toEqual(permanent.entries);
    expect(() =>
      getShopOffers({ ...permanent, rotation: { offersPerPeriod: 1 } } as ShopDefinition, 0),
    ).toThrow('Rotating shop has permanent cadence: shop:fragments.');
    expect(() =>
      getShopOffers({ ...daily, rotation: { offersPerPeriod: 13 } } as ShopDefinition, 0),
    ).toThrow('Shop rotation is invalid for shop:daily.');
    expect(() => getShopOffers(daily, -1)).toThrow(
      'Shop time must be a valid non-negative epoch timestamp.',
    );
  });

  it('buys useful catalog items, spends currency, and tracks rotating stock by period', () => {
    const character = {
      ...createTestState().character!,
      extensions: { wallet: { fragments: 100 } },
    };
    const purchase = buyFromShop(
      character,
      content,
      'shop:daily',
      'healing-potion',
      2,
      Date.UTC(2026, 10, 21),
    );

    expect(purchase.inventory['healing-potion']).toBe(2);
    expect((purchase.extensions.wallet as Record<string, number>).fragments).toBe(70);
    expect(() =>
      buyFromShop(purchase, content, 'shop:daily', 'healing-potion', 2, Date.UTC(2026, 10, 21)),
    ).toThrow('Shop stock is insufficient for healing-potion.');
    expect(() =>
      buyFromShop(character, content, 'shop:daily', 'healing-potion', 4, Date.UTC(2026, 10, 21)),
    ).toThrow('Shop stock is insufficient for healing-potion.');
    expect(() =>
      buyFromShop(
        { ...character, level: 1, extensions: { wallet: { fragments: 1 } } },
        content,
        'shop:daily',
        'healing-potion',
        1,
        Date.UTC(2026, 10, 21),
      ),
    ).toThrow('Insufficient fragments.');
    const nextDay = buyFromShop(
      purchase,
      content,
      'shop:daily',
      'healing-potion',
      1,
      Date.UTC(2026, 10, 24),
    );
    expect(nextDay.inventory['healing-potion']).toBe(3);
    expect(() =>
      buyFromShop(character, content, 'shop:daily', 'healing-potion', 1, Date.UTC(2026, 10, 22)),
    ).toThrow('Item is not in the current shop rotation: shop:daily: healing-potion.');
  });

  it('reports current stock, unlimited stock, and period boundaries', () => {
    const character = {
      ...createTestState().character!,
      extensions: { wallet: { fragments: 100 } },
    };
    const daily = content.shops.get('shop:daily')!;
    const potion = daily.entries.find((entry) => entry.itemId === 'healing-potion')!;
    const unlimited = { ...potion, stock: -1 };

    expect(getShopStockRemaining(character, daily, potion, 0)).toBe(3);
    expect(getShopStockRemaining(character, daily, unlimited, 0)).toBeUndefined();
    const bought = buyFromShop(character, content, 'shop:daily', 'healing-potion', 2, 0);
    expect(getShopStockRemaining(bought, daily, potion, 0)).toBe(1);
    expect(getShopStockRemaining(bought, daily, potion, 86_400_000)).toBe(3);
    expect(() => getShopStockRemaining(character, daily, potion, -1)).toThrow(
      'Shop time must be a valid non-negative epoch timestamp.',
    );
  });

  it('migrates legacy index-based purchase counters into stable item-based stock keys', () => {
    const base = createTestState().character!;
    const daily = content.shops.get('shop:daily')!;
    const index = daily.entries.findIndex((entry) => entry.itemId === 'healing-potion');
    const character = {
      ...base,
      extensions: {
        wallet: { fragments: 100 },
        marketPurchases: { [`shop:daily:1970-01-01:${index}`]: 2 },
      },
    };

    expect(() => buyFromShop(character, content, 'shop:daily', 'healing-potion', 2, 0)).toThrow(
      'Shop stock is insufficient for healing-potion.',
    );
    const bought = buyFromShop(character, content, 'shop:daily', 'healing-potion', 1, 0);
    expect(bought.extensions.marketPurchases).toMatchObject({
      'shop:daily:1970-01-01:healing-potion': 3,
    });
  });

  it('sells only inventory backed by explicit buyback entries', () => {
    const character = {
      ...createTestState().character!,
      inventory: { 'iron-ore': 5 },
    };
    const sold = sellToShop(character, content, 'shop:daily', 'iron-ore', 3);
    expect(sold.inventory['iron-ore']).toBe(2);
    expect((sold.extensions.wallet as Record<string, number>).fragments).toBeGreaterThan(0);
    expect(() => sellToShop(character, content, 'shop:daily', 'iron-ore', 6)).toThrow(
      'Insufficient item quantity: iron-ore.',
    );
  });

  it('converts only upward bundles of ten through the six canonical orb colors', () => {
    const character = {
      ...createTestState().character!,
      extensions: { wallet: { 'green-orb': 27 } },
    };
    const converted = exchangeOrbs(character, 'green-orb', 27);
    const wallet = converted.extensions.wallet as Record<string, number>;
    expect(wallet['green-orb']).toBe(7);
    expect(wallet['blue-orb']).toBe(2);
    expect(() => exchangeOrbs(converted, 'blue-orb', 20)).toThrow('Insufficient blue-orb.');
    expect(() => exchangeOrbs(character, 'gold-orb', 10)).toThrow(
      'The highest orb cannot be converted upward.',
    );
    expect(() => exchangeOrbs(character, 'green-orb', 9)).toThrow(
      'At least ten orbs are required for conversion.',
    );
  });

  it('applies unlocked Commerce and Charisma milestones to displayed and paid prices', () => {
    const base = createTestState().character!;
    const daily = content.shops.get('shop:daily')!;
    const potion = daily.entries.find((entry) => entry.itemId === 'healing-potion')!;
    const trading = {
      ...base,
      skills: {
        ...base.skills,
        'trade-skill': { level: 10, experience: 0, extensions: {} },
        'charisma-skill': { level: 5, experience: 0, extensions: {} },
      },
      inventory: { 'healing-potion': 1 },
      extensions: { wallet: { fragments: 100 } },
    };

    expect(getShopPrices(trading, content, potion)).toEqual({ purchase: 14, sale: 9 });
    const bought = buyFromShop(trading, content, 'shop:daily', 'healing-potion', 1, 0);
    expect((bought.extensions.wallet as Record<string, number>).fragments).toBe(86);
    const sold = sellToShop(bought, content, 'shop:daily', 'healing-potion', 1);
    expect((sold.extensions.wallet as Record<string, number>).fragments).toBe(95);
  });

  it('validates price skill state, multiplier data, and safe integer rounding', () => {
    const base = createTestState().character!;
    const potion = content.shops.get('shop:daily')!.entries[0]!;
    expect(getShopPrices(base, content, potion)).toEqual({ purchase: 15, sale: 7 });
    expect(getShopPrices(base, { ...content, skills: new Map() }, potion)).toEqual({
      purchase: 15,
      sale: 7,
    });
    expect(getShopPrices(base, content, { ...potion, price: 0, sellPrice: 0 })).toEqual({
      purchase: 0,
      sale: 0,
    });
    expect(() =>
      getShopPrices(
        {
          ...base,
          skills: {
            ...base.skills,
            'trade-skill': { level: Number.NaN, experience: 0, extensions: {} },
          },
        },
        content,
        potion,
      ),
    ).toThrow('Market skill level is invalid for trade-skill.');
    expect(() =>
      getShopPrices(
        {
          ...base,
          skills: { ...base.skills, 'trade-skill': { level: 0, experience: 0, extensions: {} } },
        },
        content,
        potion,
      ),
    ).toThrow('Market skill level is invalid for trade-skill.');

    const skillWith = (effects: Array<Record<string, unknown>>) => {
      const skill = content.skills.get('trade-skill')!;
      const updated = {
        ...skill,
        milestones: effects.map((effect, index) => ({
          level: index + 5,
          name: `Test ${index}`,
          effects: [effect],
        })),
      } as SkillDefinition;
      return { ...content, skills: new Map(content.skills).set(skill.id, updated) };
    };
    const trained = {
      ...base,
      skills: { ...base.skills, 'trade-skill': { level: 10, experience: 0, extensions: {} } },
    };
    const effect = (value: unknown) => ({ type: 'market_buy_multiplier', value });
    expect(() => getShopPrices(trained, skillWith([effect(0)]), potion)).toThrow(
      'Market price effect is invalid for trade-skill.',
    );
    expect(() => getShopPrices(trained, skillWith([effect(Number.NaN)]), potion)).toThrow(
      'Market price effect is invalid for trade-skill.',
    );
    expect(() =>
      getShopPrices(trained, skillWith([effect(Number.MAX_VALUE), effect(2)]), potion),
    ).toThrow('Market price multiplier is invalid for trade-skill.');
    expect(() =>
      getShopPrices(
        trained,
        skillWith([effect(Number.MIN_VALUE), effect(Number.MIN_VALUE)]),
        potion,
      ),
    ).toThrow('Market price multiplier is invalid for trade-skill.');
    expect(() =>
      getShopPrices(
        {
          ...base,
          skills: { ...base.skills, 'trade-skill': { level: 5, experience: 0, extensions: {} } },
        },
        skillWith([effect(2)]),
        { ...potion, price: Number.MAX_SAFE_INTEGER },
      ),
    ).toThrow('Market price exceeds the safe integer range.');
  });

  it('validates shop access, item availability, level, skill, and time requirements', () => {
    const baseCharacter = createTestState().character!;
    const character = { ...baseCharacter, extensions: { wallet: { fragments: 100 } } };
    expect(() => buyFromShop(character, content, 'missing', 'healing-potion', 1, 0)).toThrow(
      'Unknown shop: missing.',
    );
    expect(() => buyFromShop(character, content, 'shop:daily', 'missing', 1, 0)).toThrow(
      'Item is not sold by shop:daily: missing.',
    );
    expect(() => buyFromShop(character, content, 'shop:daily', 'healing-potion', 1, -1)).toThrow(
      'Shop time must be a valid non-negative epoch timestamp.',
    );
    expect(() => buyFromShop(character, content, 'shop:daily', 'healing-potion', 0, 0)).toThrow(
      'Quantity must be a positive safe integer.',
    );
    const daily = content.shops.get('shop:daily')!;
    const withShop = (shop: ShopDefinition) => {
      const normalized =
        shop.rotation && shop.rotation.offersPerPeriod > shop.entries.length
          ? { ...shop, rotation: undefined }
          : shop;
      return { ...content, shops: new Map(content.shops).set(shop.id, normalized) };
    };
    const locked = { ...daily, id: 'test:locked', regionId: 'vaeloria' };
    expect(() =>
      buyFromShop(character, withShop(locked), locked.id, 'healing-potion', 1, 0),
    ).toThrow('Shop region is locked: vaeloria.');
    const level = {
      ...daily,
      id: 'test:level',
      entries: [{ ...daily.entries[0]!, requiredLevel: 5 }],
    };
    expect(() => buyFromShop(character, withShop(level), level.id, 'healing-potion', 1, 0)).toThrow(
      'Shop item requires character level 5.',
    );
    const skill = {
      ...daily,
      id: 'test:skill',
      entries: [{ ...daily.entries[0]!, requiredSkill: 'mining-skill', requiredSkillLevel: 4 }],
    };
    expect(() => buyFromShop(character, withShop(skill), skill.id, 'healing-potion', 1, 0)).toThrow(
      'Shop item requires mining-skill level 4.',
    );
    const skilled = {
      ...character,
      skills: { 'mining-skill': { level: 4, experience: 0, extensions: {} } },
    };
    expect(
      buyFromShop(skilled, withShop(skill), skill.id, 'healing-potion', 1, 0).inventory[
        'healing-potion'
      ],
    ).toBe(1);
  });

  it('handles shop cadence, unlimited stock, invalid purchase records and safe integer limits', () => {
    const original = createTestState().character!;
    const character = { ...original, extensions: { wallet: { fragments: 100 } } };
    expect(
      buyFromShop(character, content, 'shop:fragments', 'healing-potion', 1, 0).inventory[
        'healing-potion'
      ],
    ).toBe(1);
    const daily = content.shops.get('shop:daily')!;
    const withShop = (shop: ShopDefinition) => {
      const normalized =
        shop.rotation && shop.rotation.offersPerPeriod > shop.entries.length
          ? { ...shop, rotation: undefined }
          : shop;
      return { ...content, shops: new Map(content.shops).set(shop.id, normalized) };
    };
    const weekly = { ...daily, id: 'test:weekly', cadence: 'weekly' as const };
    expect(
      buyFromShop(
        character,
        withShop(weekly),
        weekly.id,
        'healing-potion',
        1,
        Date.UTC(2026, 10, 22),
      ).inventory['healing-potion'],
    ).toBe(1);
    const unlimited = {
      ...daily,
      id: 'test:unlimited',
      entries: [{ ...daily.entries[0]!, stock: -1 }],
    };
    expect(
      buyFromShop(character, withShop(unlimited), unlimited.id, 'healing-potion', 1, 0).inventory[
        'healing-potion'
      ],
    ).toBe(1);
    const overflowUnlimited = {
      ...character,
      extensions: {
        ...character.extensions,
        marketPurchases: { 'test:unlimited:1970-01-01:0': Number.MAX_SAFE_INTEGER },
      },
    };
    expect(() =>
      buyFromShop(overflowUnlimited, withShop(unlimited), unlimited.id, 'healing-potion', 1, 0),
    ).toThrow('Shop purchase counter exceeds the safe integer range.');
    for (const wallet of [null, [], 'invalid']) {
      expect(() =>
        buyFromShop(
          { ...original, extensions: { wallet } },
          content,
          'shop:daily',
          'healing-potion',
          1,
          0,
        ),
      ).toThrow('Insufficient fragments.');
    }
    expect(() =>
      buyFromShop(
        { ...original, extensions: { wallet: { ' ': 10 } } },
        content,
        'shop:daily',
        'healing-potion',
        1,
        0,
      ),
    ).toThrow('Wallet balance is invalid for  .');
    const invalidCounter = {
      ...character,
      extensions: { ...character.extensions, marketPurchases: { 'shop:daily:1970-01-01:0': -1 } },
    };
    expect(() =>
      buyFromShop(invalidCounter, content, 'shop:daily', 'healing-potion', 1, 0),
    ).toThrow('Shop purchase counter is invalid for healing-potion.');
    const overflowCounter = {
      ...character,
      extensions: {
        ...character.extensions,
        marketPurchases: { 'shop:daily:1970-01-01:0': Number.MAX_SAFE_INTEGER },
      },
    };
    expect(() =>
      buyFromShop(overflowCounter, content, 'shop:daily', 'healing-potion', 1, 0),
    ).toThrow('Shop stock is insufficient for healing-potion.');
    const expensive = {
      ...daily,
      id: 'test:expensive',
      entries: [{ ...daily.entries[0]!, price: Number.MAX_SAFE_INTEGER }],
    };
    expect(() =>
      buyFromShop(character, withShop(expensive), expensive.id, 'healing-potion', 2, 0),
    ).toThrow('Purchase total exceeds the safe integer range.');
  });

  it('validates sales, wallet balances and every orb conversion boundary', () => {
    const base = createTestState().character!;
    const withDevice = { ...base, inventory: { 'alchemical-implant-01': 1 } };
    expect(() => sellToShop(withDevice, content, 'missing', 'iron-ore', 1)).toThrow(
      'Unknown shop: missing.',
    );
    expect(() =>
      sellToShop(withDevice, content, 'shop:fragments', 'alchemical-implant-01', 1),
    ).toThrow('Shop does not buy this item: alchemical-implant-01.');
    expect(() => sellToShop(withDevice, content, 'shop:fragments', 'iron-ore', 0)).toThrow(
      'Quantity must be a positive safe integer.',
    );
    expect(() => sellToShop(base, content, 'shop:daily', 'iron-ore', 1)).toThrow(
      'Insufficient item quantity: iron-ore.',
    );
    const daily = content.shops.get('shop:daily')!;
    const withShop = (shop: ShopDefinition) => ({
      ...content,
      shops: new Map(content.shops).set(shop.id, shop),
    });
    const costly = {
      ...daily,
      id: 'test:costly-sale',
      entries: [{ ...daily.entries[0]!, sellPrice: Number.MAX_SAFE_INTEGER }],
    };
    expect(() =>
      sellToShop(
        { ...base, inventory: { 'healing-potion': 2 } },
        withShop(costly),
        costly.id,
        'healing-potion',
        2,
      ),
    ).toThrow('Sale total exceeds the safe integer range.');
    expect(() =>
      sellToShop(
        {
          ...base,
          inventory: { 'healing-potion': 1 },
          extensions: { wallet: { fragments: Number.MAX_SAFE_INTEGER } },
        },
        content,
        'shop:daily',
        'healing-potion',
        1,
      ),
    ).toThrow('Currency balance exceeds the safe integer range for fragments.');
    expect(() => exchangeOrbs(base, 'bad-orb', 10)).toThrow('Unknown orb: bad-orb.');
    expect(() => exchangeOrbs(base, 'green-orb', 0)).toThrow(
      'Quantity must be a positive safe integer.',
    );
    expect(() =>
      exchangeOrbs(
        {
          ...base,
          extensions: { wallet: { 'green-orb': 10, 'blue-orb': Number.MAX_SAFE_INTEGER } },
        },
        'green-orb',
        10,
      ),
    ).toThrow('Currency balance exceeds the safe integer range for blue-orb.');
    expect(() => exchangeOrbs(base, 'green-orb', 10)).toThrow('Insufficient green-orb.');
    expect(() =>
      exchangeOrbs({ ...base, extensions: { wallet: { fragments: -1 } } }, 'green-orb', 10),
    ).toThrow('Wallet balance is invalid for fragments.');
  });
});
