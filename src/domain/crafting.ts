import type { ContentCatalog } from '../content/registry';
import { forgeItem } from './forge';
import { awardSkillExperience } from './progression';
import type { DomainEvent, GameState } from './types';

export function craftRecipe(
  state: GameState,
  content: ContentCatalog,
  recipeId: string,
  craftId: string,
  now: number,
): GameState {
  if (!craftId.trim()) throw new Error('Craft id cannot be empty.');
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    throw new Error('Craft time must be a valid non-negative epoch timestamp.');
  }
  const eventId = `${craftId}:item.crafted`;
  if (
    state.processedEventIds.includes(eventId) ||
    state.events.some((event) => event.id === eventId)
  ) {
    return state;
  }
  if (!state.character) throw new Error('A character is required to craft items.');
  const recipe = content.recipes.get(recipeId);
  if (!recipe) throw new Error(`Unknown forge recipe: ${recipeId}`);
  for (const [itemId, quantity] of Object.entries(recipe.inputs)) {
    if ((state.character.inventory[itemId] ?? 0) < quantity) {
      throw new Error(`Insufficient material: ${itemId}.`);
    }
  }
  if (recipe.requiredLevel && state.character.level < recipe.requiredLevel) {
    throw new Error(`Recipe requires character level ${recipe.requiredLevel}.`);
  }
  const skillId = recipe.skillId;
  const currentSkillLevel = skillId ? (state.character.skills[skillId]?.level ?? 1) : 1;
  if (skillId && recipe.requiredSkillLevel && currentSkillLevel < recipe.requiredSkillLevel) {
    throw new Error(`Recipe requires ${skillId} level ${recipe.requiredSkillLevel}.`);
  }

  let character = forgeItem(state.character, content, recipeId);
  const events: DomainEvent[] = [
    {
      id: eventId,
      type: 'item.crafted',
      occurredAt: now,
      itemId: recipe.resultItemId,
      quantity: recipe.resultQuantity,
    },
    {
      id: `${craftId}:item.acquired:${recipe.resultItemId}`,
      type: 'item.acquired',
      occurredAt: now,
      itemId: recipe.resultItemId,
      quantity: recipe.resultQuantity,
    },
  ];
  if (skillId) {
    const skill = content.skills.get(skillId);
    const skillUpdate = awardSkillExperience(
      character,
      skillId,
      recipe.experience ?? 20,
      skill?.experiencePerLevel ?? 100,
      craftId,
    );
    character = skillUpdate.character;
    events.push(...skillUpdate.events);
  }
  const processed = new Set(state.processedEventIds);
  const accepted = events.filter((event) => {
    if (processed.has(event.id)) return false;
    processed.add(event.id);
    return true;
  });
  return {
    ...state,
    character,
    events: [...state.events, ...accepted],
    processedEventIds: [...state.processedEventIds, ...accepted.map((event) => event.id)],
  };
}
