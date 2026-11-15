import { bootstrapGame } from './bootstrap';

const root = document.getElementById('root');
if (root) {
  void bootstrapGame(root).catch((error: unknown) => {
    root.setAttribute('role', 'alert');
    root.textContent = error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
  });
}
