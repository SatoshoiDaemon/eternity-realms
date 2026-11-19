import { bootstrapGame } from './bootstrap';
import { t } from './app/i18n';

const root = document.getElementById('root');

function renderStartupFailure(container: HTMLElement): void {
  container.replaceChildren();
  container.removeAttribute('role');
  const main = document.createElement('main');
  main.style.cssText = [
    'box-sizing:border-box',
    'display:grid',
    'min-height:100vh',
    'min-height:100dvh',
    'place-items:center',
    'padding:calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom))',
    'color:var(--color-text, #cdd6f4)',
    'background:var(--color-canvas, #1e1e2e)',
  ].join(';');
  const section = document.createElement('section');
  section.style.cssText =
    'box-sizing:border-box;width:min(100%, 440px);padding:24px;border:1px solid var(--color-border, #45475a);border-radius:16px;background:var(--color-surface, #181825)';
  const heading = document.createElement('h1');
  heading.textContent = t('app.startup.heading');
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = t('app.startup.message');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = t('app.retry');
  retry.style.cssText =
    'min-height:48px;width:100%;margin-top:16px;padding:12px;border:0;border-radius:10px;color:var(--color-accent-contrast, #1e1e2e);background:var(--color-accent, #cba6f7);font:inherit;font-weight:700';
  retry.addEventListener('click', () => {
    retry.disabled = true;
    retry.textContent = t('app.retrying');
    void start(container);
  });
  section.append(heading, message, retry);
  main.append(section);
  container.append(main);
}

async function start(container: HTMLElement): Promise<void> {
  container.replaceChildren();
  try {
    await bootstrapGame(container);
  } catch (error) {
    console.error('Falha ao iniciar o Eternity Realms.', error);
    renderStartupFailure(container);
  }
}

if (root) {
  void start(root);
}
