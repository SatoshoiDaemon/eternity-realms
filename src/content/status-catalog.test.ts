import { describe, expect, it } from 'vitest';
import { loadOfficialContent } from './registry';

describe('canonical status effect catalogue', () => {
  it('contains all 42 source effects with their original family counts and rules', () => {
    const content = loadOfficialContent();
    const effects = [...content.effects.values()].filter(
      (effect) => effect.payload.system === 'status-effect',
    );
    const counts = effects.reduce<Record<string, number>>((result, effect) => {
      const family = String(effect.payload.family);
      result[family] = (result[family] ?? 0) + 1;
      return result;
    }, {});
    expect(effects).toHaveLength(42);
    expect({
      dot: counts.dot,
      control: counts.control,
      debuff: counts.debuff,
      buff: counts.buff,
    }).toEqual({ dot: 8, control: 11, debuff: 10, buff: 13 });
    expect(content.effects.get('core:poison')?.payload.canonicalRule).toContain(
      'quantidade de turnos já passados',
    );
    expect(content.effects.get('core:charm')?.payload.engineSupport).toContain(
      'preserve unusual damage rule',
    );
  });
});
