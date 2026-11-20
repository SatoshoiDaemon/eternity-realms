import { useMemo, useState } from 'react';
import type { ContentCatalog } from '../content/registry';
import { buyFromShop, exchangeOrbs, getShopPrices, sellToShop } from '../domain/economy';
import type { Character } from '../domain/types';
import { GameSelect } from './GameSelect';

const orbIds = ['green-orb', 'blue-orb', 'orange-orb', 'red-orb', 'black-orb', 'gold-orb'];

export function MarketPanel({
  character,
  content,
  clock,
  updateCharacter,
}: {
  character: Character;
  content: ContentCatalog;
  clock: () => number;
  updateCharacter: (update: (current: Character) => Character) => Promise<void>;
}) {
  const shops = useMemo(() => [...content.shops.values()], [content.shops]);
  const [shopId, setShopId] = useState(shops[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [orbId, setOrbId] = useState(orbIds[0]!);
  const [orbQuantity, setOrbQuantity] = useState(10);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const shop = content.shops.get(shopId);
  const wallet =
    typeof character.extensions.wallet === 'object' && character.extensions.wallet !== null
      ? (character.extensions.wallet as Record<string, number>)
      : {};

  const run = async (operation: (current: Character) => Character, message: string) => {
    try {
      await updateCharacter(operation);
      setError('');
      setStatus(message);
    } catch (cause) {
      setStatus('');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="screen-stack" aria-labelledby="market-heading">
      <div className="screen-intro">
        <p className="eyebrow">Economia</p>
        <h1 id="market-heading">Mercado e orbes</h1>
        <p>Compre, venda e converta moedas. Estoques diários e semanais renovam offline.</p>
      </div>

      <section className="panel" aria-labelledby="wallet-heading">
        <h2 id="wallet-heading">Carteira</h2>
        <div className="benefit-tags">
          {['fragments', ...orbIds].map((currency) => (
            <span key={currency}>
              {currency}: {wallet[currency] ?? 0}
            </span>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="shop-heading">
        <h2 id="shop-heading">Lojas</h2>
        <GameSelect
          id="market-shop"
          label="Loja regional"
          value={shopId}
          options={shops.map((entry) => ({ value: entry.id, label: entry.name }))}
          onChange={(value) => setShopId(value)}
        />
        <label className="field-label" htmlFor="market-quantity">
          Quantidade
        </label>
        <input
          id="market-quantity"
          className="text-input"
          min={1}
          max={999}
          type="number"
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
        <div className="activity-grid">
          {(shop?.entries ?? []).map((entry) => {
            const item = content.items.get(entry.itemId);
            const prices = getShopPrices(character, content, entry);
            return (
              <article className="panel" key={entry.itemId}>
                <h3>{item?.name ?? entry.itemId}</h3>
                <p>
                  Compra: {prices.purchase} {entry.currency}
                  {prices.purchase !== entry.price ? ` · preço-base ${entry.price}` : ''}
                  {entry.stock !== undefined && entry.stock >= 0 ? ` · Estoque ${entry.stock}` : ''}
                </p>
                {prices.sale !== undefined && (
                  <p>
                    Revenda: {prices.sale} {entry.currency} por unidade
                  </p>
                )}
                <div className="action-grid">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() =>
                      void run(
                        (current) =>
                          buyFromShop(current, content, shopId, entry.itemId, quantity, clock()),
                        `${quantity} × ${item?.name ?? entry.itemId} comprado(s).`,
                      )
                    }
                  >
                    Comprar
                  </button>
                  {entry.sellPrice !== undefined &&
                    (character.inventory[entry.itemId] ?? 0) > 0 && (
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() =>
                          void run(
                            (current) =>
                              sellToShop(current, content, shopId, entry.itemId, quantity),
                            `${quantity} × ${item?.name ?? entry.itemId} vendido(s).`,
                          )
                        }
                      >
                        Vender por {prices.sale} {entry.currency} cada
                      </button>
                    )}
                </div>
              </article>
            );
          })}
          {shops.length === 0 && <p className="empty-state">Nenhuma loja está disponível.</p>}
        </div>
      </section>

      <section className="panel" aria-labelledby="orb-exchange-heading">
        <h2 id="orb-exchange-heading">Conversão de orbes</h2>
        <p>Dez orbes viram um orbe da próxima cor.</p>
        <GameSelect
          id="orb-exchange-source"
          label="Orbe de origem"
          value={orbId}
          options={orbIds.map((id) => ({ value: id, label: id }))}
          onChange={setOrbId}
        />
        <label className="field-label" htmlFor="orb-exchange-quantity">
          Orbes disponíveis para conversão
        </label>
        <input
          id="orb-exchange-quantity"
          className="text-input"
          min={10}
          max={999_999}
          type="number"
          value={orbQuantity}
          onChange={(event) => setOrbQuantity(Number(event.target.value))}
        />
        <button
          className="primary-button"
          type="button"
          onClick={() =>
            void run(
              (current) => exchangeOrbs(current, orbId, orbQuantity),
              `${Math.floor(orbQuantity / 10)} orbe(s) convertido(s).`,
            )
          }
        >
          Converter
        </button>
      </section>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="status-banner" role="status">
          {status}
        </p>
      )}
    </section>
  );
}
