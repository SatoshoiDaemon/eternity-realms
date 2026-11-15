import { createRoot } from 'react-dom/client';
import { GameApp } from './app/GameApp';
import { openCapacitorRepository } from './persistence/open-capacitor-repository';

export async function bootstrapGame(root: HTMLElement | null): Promise<void> {
  if (!root) {
    throw new Error('App root element #root was not found.');
  }
  const repository = await openCapacitorRepository();
  createRoot(root).render(<GameApp repository={repository} />);
}
