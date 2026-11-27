import { describe, expect, it } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import { createTestState } from '../test/fixtures';
import { craftRecipe } from './crafting';

const content = loadOfficialContent();

describe('crafting progression', () => {
  it('consumes recipe inputs, creates usable equipment, and advances its profession', () => {
    const state = createTestState();
    state.character!.inventory['material-iron'] = 4;
    state.character!.skills['forging-skill'] = { level: 3, experience: 0, extensions: {} };
    const crafted = craftRecipe(state, content, 'forge:iron-weapon', 'craft-1', 123);

    expect(crafted.character?.inventory['material-iron']).toBe(0);
    expect(crafted.character?.inventory['gear:iron-weapon']).toBe(1);
    expect(crafted.character?.skills['forging-skill']).toMatchObject({ level: 3, experience: 20 });
    expect(crafted.events.map((event) => event.type)).toContain('item.crafted');
    expect(crafted.events.map((event) => event.type)).toContain('item.acquired');
    expect(craftRecipe(crafted, content, 'forge:iron-weapon', 'craft-1', 456)).toEqual(crafted);
  });

  it('rejects missing materials and locked profession recipes before mutating the save', () => {
    const state = createTestState();
    expect(() => craftRecipe(state, content, 'forge:iron-weapon', 'craft-2', 123)).toThrow(
      'Insufficient material: material-iron.',
    );
    const prepared = {
      ...state,
      character: {
        ...state.character!,
        level: 1,
        inventory: { 'material-iron': 4, 'material-mithril': 3 },
        skills: { 'forging-skill': { level: 1, experience: 0, extensions: {} } },
      },
    };
    expect(() => craftRecipe(prepared, content, 'forge:mithril-weapon', 'craft-3', 123)).toThrow(
      'Recipe requires forging-skill level 6.',
    );
  });

  it('validates operation identity, time, character, recipe and character-level gates', () => {
    const state = createTestState();
    expect(() => craftRecipe(state, content, 'forge:iron-weapon', ' ', 123)).toThrow(
      'Craft id cannot be empty.',
    );
    expect(() => craftRecipe(state, content, 'forge:iron-weapon', 'bad-time', Number.NaN)).toThrow(
      'Craft time must be a valid non-negative epoch timestamp.',
    );
    expect(() => craftRecipe(state, content, 'missing', 'missing-recipe', 123)).toThrow(
      'Unknown forge recipe: missing',
    );
    expect(() =>
      craftRecipe({ ...state, character: null }, content, 'forge:iron-weapon', 'no-character', 123),
    ).toThrow('A character is required to craft items.');

    const recipe = content.recipes.get('forge:iron-weapon')!;
    const recipes = new Map(content.recipes);
    recipes.set('test:level-locked', { ...recipe, id: 'test:level-locked', requiredLevel: 4 });
    const gatedContent = { ...content, recipes };
    const prepared = {
      ...state,
      character: { ...state.character!, inventory: { 'material-iron': 4 } },
    };
    expect(() => craftRecipe(prepared, gatedContent, 'test:level-locked', 'locked', 123)).toThrow(
      'Recipe requires character level 4.',
    );
  });

  it('uses default recipe experience and tolerates duplicate result event IDs', () => {
    const state = createTestState();
    const recipe = content.recipes.get('forge:iron-weapon')!;
    const recipes = new Map(content.recipes);
    recipes.set('test:no-skill', {
      ...recipe,
      id: 'test:no-skill',
      skillId: undefined,
      requiredSkillLevel: undefined,
      experience: undefined,
    });
    const noSkillContent = { ...content, recipes };
    const prepared = {
      ...state,
      character: { ...state.character!, inventory: { 'material-iron': 4 } },
      processedEventIds: ['craft-no-skill:item.acquired:gear:iron-weapon'],
    };
    const crafted = craftRecipe(prepared, noSkillContent, 'test:no-skill', 'craft-no-skill', 123);
    expect(crafted.character?.inventory['gear:iron-weapon']).toBe(1);
    expect(crafted.events.map((event) => event.id)).toEqual(['craft-no-skill:item.crafted']);

    const journalOnly = {
      ...prepared,
      processedEventIds: [],
      events: [
        {
          id: 'journal:item.crafted',
          type: 'item.crafted',
          occurredAt: 10,
          itemId: 'x',
          quantity: 1,
        },
      ],
    } as never;
    expect(craftRecipe(journalOnly, content, 'forge:iron-weapon', 'journal', 123)).toBe(
      journalOnly,
    );

    recipes.set('test:skill-without-gate', {
      ...recipe,
      id: 'test:skill-without-gate',
      skillId: 'missing-skill',
      requiredSkillLevel: undefined,
      experience: undefined,
    });
    const skillState = {
      ...state,
      character: { ...state.character!, inventory: { 'material-iron': 4 } },
    };
    const skillCraft = craftRecipe(
      skillState,
      noSkillContent,
      'test:skill-without-gate',
      'craft-without-gate',
      123,
    );
    expect(skillCraft.character?.skills['missing-skill']).toMatchObject({
      level: 1,
      experience: 20,
    });
  });
});
