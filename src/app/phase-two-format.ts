import { t, type TranslationKey } from './i18n';

export function nodeCategoryName(category: string): string {
  const keys: Record<string, TranslationKey> = {
    source: 'phase.nodeCategory.source',
    type: 'phase.nodeCategory.type',
    form: 'phase.nodeCategory.form',
    effect: 'phase.nodeCategory.effect',
    modifier: 'phase.nodeCategory.modifier',
    sacrifice: 'phase.nodeCategory.sacrifice',
  };
  const key = keys[category];
  return key ? t(key) : category;
}
