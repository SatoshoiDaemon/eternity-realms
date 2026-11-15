import { createRoot, type Root } from 'react-dom/client';
import { GameApp } from './app/GameApp';
import { openCapacitorRepository } from './persistence/open-capacitor-repository';

export async function bootstrapGame(root: HTMLElement | null): Promise<Root> {
  if (!root) {
    throw new Error('App root element #root was not found.');
  }
  const repository = await openCapacitorRepository();
  const application = createRoot(root);
  application.render(<GameApp repository={repository} />);
  return application;
}
