import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import { createTestState } from '../test/fixtures';
import type { Character } from '../domain/types';
import type { ContentCatalog } from '../content/registry';
import type { ShopDefinition } from '../content/schema';
import { MarketPanel } from './MarketPanel';

const content = loadOfficialContent();

describe('offline market panel', () => {
  it('renders stores and performs a persisted purchase through the economy service', async () => {
    let character: Character = {
      ...createTestState().character!,
      inventory: { 'iron-ore': 2 },
      extensions: { wallet: { fragments: 100, 'green-orb': 10 } },
    };
    const updateCharacter = vi.fn(async (update: (current: Character) => Character) => {
      character = update(character);
    });
    render(
      <MarketPanel
        character={character}
        content={content}
        clock={() => 1}
        updateCharacter={updateCharacter}
      />,
    );

    const potion = screen.getByRole('heading', { name: 'Poção de cura' }).closest('article')!;
    fireEvent.click(within(potion).getByRole('button', { name: 'Comprar' }));
    expect(await screen.findByRole('status')).toHaveTextContent('comprado(s)');
    expect(character.inventory['healing-potion']).toBe(1);
    expect((character.extensions.wallet as Record<string, number>).fragments).toBe(75);
    expect(screen.getByRole('heading', { name: 'Conversão de orbes' })).toBeInTheDocument();
  });

  it('shows skill-adjusted commerce prices in the offline market', () => {
    const character = {
      ...createTestState().character!,
      skills: {
        'trade-skill': { level: 10, experience: 0, extensions: {} },
        'charisma-skill': { level: 5, experience: 0, extensions: {} },
      },
      inventory: { 'healing-potion': 1 },
      extensions: { wallet: { fragments: 100 } },
    } as Character;
    render(
      <MarketPanel
        character={character}
        content={content}
        clock={() => 1}
        updateCharacter={async () => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'Loja regional: Loja de Fragmentos' }));
    fireEvent.click(screen.getByRole('option', { name: 'Banca diária' }));
    const potion = screen.getByRole('heading', { name: 'Poção de cura' }).closest('article')!;
    expect(within(potion).getByText(/Compra: 14 fragments · preço-base 15/)).toBeInTheDocument();
    expect(within(potion).getByText('Revenda: 9 fragments por unidade')).toBeInTheDocument();
    expect(
      within(potion).getByRole('button', { name: 'Vender por 9 fragments cada' }),
    ).toBeInTheDocument();
  });

  it('shows domain errors and accepts an orb conversion', async () => {
    const character: Character = {
      ...createTestState().character!,
      inventory: { 'iron-ore': 1 },
      extensions: { wallet: { fragments: 0, 'green-orb': 10 } },
    };
    let current = character;
    render(
      <MarketPanel
        character={character}
        content={content}
        clock={() => 1}
        updateCharacter={async (update) => {
          current = update(current);
        }}
      />,
    );
    const potion = screen.getByRole('heading', { name: 'Poção de cura' }).closest('article')!;
    fireEvent.click(within(potion).getByRole('button', { name: 'Comprar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient fragments.');

    fireEvent.click(screen.getByRole('button', { name: 'Converter' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 orbe(s) convertido(s).');
    expect(current.extensions.wallet).toMatchObject({ 'green-orb': 0, 'blue-orb': 1 });
    fireEvent.click(screen.getByRole('combobox', { name: 'Loja regional: Loja de Fragmentos' }));
    fireEvent.click(screen.getByRole('option', { name: 'Banca diária' }));
    const ore = screen.getByRole('heading', { name: 'Minério de ferro' }).closest('article')!;
    fireEvent.click(within(ore).getByRole('button', { name: /Vender/ }));
    expect(current.inventory['iron-ore']).toBe(0);
  });

  it('supports empty markets, missing item labels, quantity entry and non-Error failures', async () => {
    const noShops = { ...content, shops: new Map() } as ContentCatalog;
    const emptyCharacter: Character = {
      ...createTestState().character!,
      extensions: { wallet: null },
    };
    const emptyUpdate = vi.fn(async (update: (current: Character) => Character) => {
      update(emptyCharacter);
    });
    const emptyView = render(
      <MarketPanel
        character={emptyCharacter}
        content={noShops}
        clock={() => 0}
        updateCharacter={emptyUpdate}
      />,
    );
    expect(screen.getByText('Nenhuma loja está disponível.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Loja regional:/ })).toHaveValue('');
    emptyView.unmount();

    const missingItemShop: ShopDefinition = {
      id: 'test:missing-item-shop',
      kind: 'shop',
      name: 'Loja de teste',
      description: '',
      cadence: 'permanent',
      entries: [
        { itemId: 'missing:item', currency: 'fragments', price: 1, stock: -1, sellPrice: 1 },
      ],
    };
    const missingItemContent = {
      ...content,
      shops: new Map([[missingItemShop.id, missingItemShop]]),
    };
    const character: Character = {
      ...createTestState().character!,
      inventory: { 'missing:item': 1 },
      extensions: { wallet: { fragments: 10 } },
    };
    render(
      <MarketPanel
        character={character}
        content={missingItemContent}
        clock={() => 0}
        updateCharacter={async () => {
          throw 'worker unavailable';
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Orbes disponíveis para conversão'), {
      target: { value: '20' },
    });
    expect(screen.getByRole('heading', { name: 'missing:item' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Comprar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('worker unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Vender por 1 fragments cada' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('worker unavailable');
  });
});
