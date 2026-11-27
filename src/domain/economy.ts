import type { ContentCatalog } from '../content/registry';
import type { ShopDefinition } from '../content/schema';
import type { Character } from './types';
import { getUnlockedRegionIds } from './activity-access';
import { grantItems } from './progression';

const ORB_TIERS = ['green-orb', 'blue-orb', 'orange-orb', 'red-orb', 'black-orb', 'gold-orb'];
const DAY_MS = 86_400_000;
const WEEK_MS = DAY_MS * 7;

function validateQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive safe integer.');
  }
}

function walletOf(character: Character): Record<string, number> {
  const value = character.extensions.wallet;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const wallet = value as Record<string, number>;
  for (const [currency, balance] of Object.entries(wallet)) {
    if (!currency.trim() || !Number.isSafeInteger(balance) || balance < 0) {
      throw new Error(`Wallet balance is invalid for ${currency}.`);
    }
  }
  return { ...wallet };
}

function shopPeriod(cadence: 'permanent' | 'daily' | 'weekly', now: number): string {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    throw new Error('Shop time must be a valid non-negative epoch timestamp.');
  }
  if (cadence === 'permanent') return 'permanent';
  const date = new Date(now);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (cadence === 'daily') return new Date(dayStart).toISOString().slice(0, 10);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(dayStart - daysSinceMonday * 86_400_000).toISOString().slice(0, 10);
}

function shopPeriodOrdinal(cadence: 'daily' | 'weekly', now: number): number {
  const date = new Date(now);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (cadence === 'daily') return Math.floor(dayStart / DAY_MS);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return Math.floor((dayStart - daysSinceMonday * DAY_MS) / WEEK_MS);
}

export function getShopOffers(shop: ShopDefinition, now: number): ShopDefinition['entries'] {
  shopPeriod(shop.cadence, now);
  if (!shop.rotation) return shop.entries;
  if (shop.cadence === 'permanent') {
    throw new Error(`Rotating shop has permanent cadence: ${shop.id}.`);
  }
  const offerCount = shop.rotation.offersPerPeriod;
  if (!Number.isSafeInteger(offerCount) || offerCount <= 0 || offerCount > shop.entries.length) {
    throw new Error(`Shop rotation is invalid for ${shop.id}.`);
  }
  const ordinal = shopPeriodOrdinal(shop.cadence, now);
  const start =
    (((ordinal * offerCount) % shop.entries.length) + shop.entries.length) % shop.entries.length;
  return Array.from(
    { length: offerCount },
    (_, index) => shop.entries[(start + index) % shop.entries.length]!,
  );
}

function purchasedQuantity(
  character: Character,
  shop: ShopDefinition,
  entry: ShopDefinition['entries'][number],
  period: string,
): number {
  const marketValue = character.extensions.marketPurchases;
  const purchases =
    typeof marketValue === 'object' && marketValue !== null && !Array.isArray(marketValue)
      ? (marketValue as Record<string, number>)
      : {};
  const itemKey = `${shop.id}:${period}:${entry.itemId}`;
  const legacyIndex = shop.entries.indexOf(entry);
  const legacyKey = `${shop.id}:${period}:${legacyIndex}`;
  const alreadyBought = purchases[itemKey] ?? purchases[legacyKey] ?? 0;
  if (!Number.isSafeInteger(alreadyBought) || alreadyBought < 0) {
    throw new Error(`Shop purchase counter is invalid for ${entry.itemId}.`);
  }
  return alreadyBought;
}

export function getShopStockRemaining(
  character: Character,
  shop: ShopDefinition,
  entry: ShopDefinition['entries'][number],
  now: number,
): number | undefined {
  if (entry.stock === undefined || entry.stock < 0) return undefined;
  const period = shopPeriod(shop.cadence, now);
  return Math.max(0, entry.stock - purchasedQuantity(character, shop, entry, period));
}

function assertShopAccess(character: Character, shopId: string, content: ContentCatalog) {
  const shop = content.shops.get(shopId);
  if (!shop) throw new Error(`Unknown shop: ${shopId}.`);
  if (shop.regionId && !getUnlockedRegionIds(character, content.regions).includes(shop.regionId)) {
    throw new Error(`Shop region is locked: ${shop.regionId}.`);
  }
  return shop;
}

function skillPriceMultiplier(
  character: Character,
  content: ContentCatalog,
  effectType: 'market_buy_multiplier' | 'market_sell_multiplier',
): number {
  let multiplier = 1;
  for (const skillId of ['trade-skill', 'charisma-skill']) {
    const skill = content.skills.get(skillId);
    const level = character.skills[skillId]?.level ?? 1;
    if (!Number.isSafeInteger(level) || level < 1) {
      throw new Error(`Market skill level is invalid for ${skillId}.`);
    }
    for (const milestone of skill?.milestones ?? []) {
      if (milestone.level > level) continue;
      for (const effect of milestone.effects) {
        if (effect.type !== effectType) continue;
        const value = effect.value;
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          throw new Error(`Market price effect is invalid for ${skillId}.`);
        }
        multiplier *= value;
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
          throw new Error(`Market price multiplier is invalid for ${skillId}.`);
        }
      }
    }
  }
  return multiplier;
}

function adjustedPrice(basePrice: number, multiplier: number, rounding: 'up' | 'down'): number {
  const adjusted =
    rounding === 'up' ? Math.ceil(basePrice * multiplier) : Math.floor(basePrice * multiplier);
  if (!Number.isSafeInteger(adjusted))
    throw new Error('Market price exceeds the safe integer range.');
  return basePrice > 0 && rounding === 'up' ? Math.max(1, adjusted) : adjusted;
}

export function getShopPrices(
  character: Character,
  content: ContentCatalog,
  entry: ShopDefinition['entries'][number],
): { purchase: number; sale?: number } {
  return {
    purchase: adjustedPrice(
      entry.price,
      skillPriceMultiplier(character, content, 'market_buy_multiplier'),
      'up',
    ),
    ...(entry.sellPrice === undefined
      ? {}
      : {
          sale: adjustedPrice(
            entry.sellPrice,
            skillPriceMultiplier(character, content, 'market_sell_multiplier'),
            'down',
          ),
        }),
  };
}

export function buyFromShop(
  character: Character,
  content: ContentCatalog,
  shopId: string,
  itemId: string,
  quantity: number,
  now: number,
): Character {
  validateQuantity(quantity);
  const shop = assertShopAccess(character, shopId, content);
  const period = shopPeriod(shop.cadence, now);
  const catalogEntryIndex = shop.entries.findIndex((entry) => entry.itemId === itemId);
  if (catalogEntryIndex < 0) throw new Error(`Item is not sold by ${shopId}: ${itemId}.`);
  const entry = getShopOffers(shop, now).find((candidate) => candidate.itemId === itemId);
  if (!entry) throw new Error(`Item is not in the current shop rotation: ${shopId}: ${itemId}.`);
  if (entry.requiredLevel && character.level < entry.requiredLevel) {
    throw new Error(`Shop item requires character level ${entry.requiredLevel}.`);
  }
  if (entry.requiredSkill) {
    const level = character.skills[entry.requiredSkill]?.level ?? 1;
    if (entry.requiredSkillLevel && level < entry.requiredSkillLevel) {
      throw new Error(
        `Shop item requires ${entry.requiredSkill} level ${entry.requiredSkillLevel}.`,
      );
    }
  }
  const totalPrice = getShopPrices(character, content, entry).purchase * quantity;
  if (!Number.isSafeInteger(totalPrice))
    throw new Error('Purchase total exceeds the safe integer range.');
  const wallet = walletOf(character);
  const balance = wallet[entry.currency] ?? 0;
  if (balance < totalPrice) throw new Error(`Insufficient ${entry.currency}.`);

  const purchaseKey = `${shop.id}:${period}:${entry.itemId}`;
  const marketValue = character.extensions.marketPurchases;
  const purchases =
    typeof marketValue === 'object' && marketValue !== null && !Array.isArray(marketValue)
      ? { ...(marketValue as Record<string, number>) }
      : {};
  const alreadyBought = purchasedQuantity(character, shop, entry, period);
  if (entry.stock !== undefined && entry.stock >= 0 && alreadyBought + quantity > entry.stock) {
    throw new Error(`Shop stock is insufficient for ${itemId}.`);
  }
  if (!Number.isSafeInteger(alreadyBought + quantity)) {
    throw new Error('Shop purchase counter exceeds the safe integer range.');
  }
  if (entry.stock !== undefined && entry.stock >= 0)
    purchases[purchaseKey] = alreadyBought + quantity;
  wallet[entry.currency] = balance - totalPrice;
  const withItems = grantItems(character, { [itemId]: quantity }).character;
  return {
    ...withItems,
    extensions: { ...withItems.extensions, wallet, marketPurchases: purchases },
  };
}

export function sellToShop(
  character: Character,
  content: ContentCatalog,
  shopId: string,
  itemId: string,
  quantity: number,
): Character {
  validateQuantity(quantity);
  const shop = assertShopAccess(character, shopId, content);
  const entry = shop.entries.find((candidate) => candidate.itemId === itemId);
  if (!entry || entry.sellPrice === undefined) {
    throw new Error(`Shop does not buy this item: ${itemId}.`);
  }
  if ((character.inventory[itemId] ?? 0) < quantity) {
    throw new Error(`Insufficient item quantity: ${itemId}.`);
  }
  const salePrice = getShopPrices(character, content, entry).sale!;
  const total = salePrice * quantity;
  if (!Number.isSafeInteger(total)) throw new Error('Sale total exceeds the safe integer range.');
  const wallet = walletOf(character);
  const balance = (wallet[entry.currency] ?? 0) + total;
  if (!Number.isSafeInteger(balance)) {
    throw new Error(`Currency balance exceeds the safe integer range for ${entry.currency}.`);
  }
  wallet[entry.currency] = balance;
  return {
    ...character,
    inventory: { ...character.inventory, [itemId]: character.inventory[itemId]! - quantity },
    extensions: { ...character.extensions, wallet },
  };
}

export function exchangeOrbs(character: Character, fromOrb: string, amount: number): Character {
  validateQuantity(amount);
  const index = ORB_TIERS.indexOf(fromOrb);
  if (index < 0) throw new Error(`Unknown orb: ${fromOrb}.`);
  const nextOrb = ORB_TIERS[index + 1];
  if (!nextOrb) throw new Error('The highest orb cannot be converted upward.');
  const exchanged = Math.floor(amount / 10);
  if (exchanged <= 0) throw new Error('At least ten orbs are required for conversion.');
  const consumed = exchanged * 10;
  const wallet = walletOf(character);
  const balance = wallet[fromOrb] ?? 0;
  if (balance < consumed) throw new Error(`Insufficient ${fromOrb}.`);
  const nextBalance = (wallet[nextOrb] ?? 0) + exchanged;
  if (!Number.isSafeInteger(nextBalance)) {
    throw new Error(`Currency balance exceeds the safe integer range for ${nextOrb}.`);
  }
  wallet[fromOrb] = balance - consumed;
  wallet[nextOrb] = nextBalance;
  return { ...character, extensions: { ...character.extensions, wallet } };
}
