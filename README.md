# Eternity Realms

Eternity Realms is an open source idle RPG for Android, designed to work offline, support mods, and keep saves under the player's control. The repository is the source of truth for implementation and technical notes.

## Current playable loop

- Create a character with a data-defined starter race and class.
- Queue a mining, gathering, or expedition session, close the app, and reconcile elapsed time when it opens again.
- Expeditions run deterministic, event-based battles against weighted encounters, groups, variants, elites, and bosses. The combat record keeps the seed, combat state, and detailed log for offline review.
- Build abilities in the node editor, equip them, and order their automatic combat priority. The same compiled actions run in the arena and during expeditions.
- Loot feeds a working forge: collect materials, craft equipment, equip it, and carry its damage, mitigation, speed, and material properties into combat.
- Browse the bestiary to inspect enemy tags and their counterplay; dungeon and raid results add unlocked nodes to the character library.
- Grant configured items, experience, loot, node unlocks, and combat history once, in the same SQLite transaction as the save and domain-event history.
- Queue up to five sessions per character, edit and reorder queued sessions, or cancel the active cycle.
- Load official JSON through the same schema-validated content-pack loader used by external packs.
- Run Lua transforms in a WebAssembly runtime. SQLite and Lua WebAssembly files are copied into the local app assets so the runtime does not fetch them from the internet.

The initial mining and foraging rewards, and the 80 XP per-level threshold, are explicitly provisional data. Change the content JSON when the game rules are ready; the session engine does not encode reward values or a level curve.

## Requirements

- Node.js 24 and npm.
- Java 21, Android SDK platform 36, and Android build tools 36.0.0 to build the debug APK locally.

## Development

```sh
npm ci
npm run dev
```

The app opens at the Vite development URL. It uses Capacitor SQLite in the browser, backed by `jeep-sqlite` and IndexedDB, and the native SQLite plugin on Android.

Useful project commands:

| Command                    | Purpose                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `npm test`                 | Run unit and integration tests                                            |
| `npm run coverage`         | Run tests and enforce 100% line, branch, function, and statement coverage |
| `npm run typecheck`        | Check TypeScript types                                                    |
| `npm run lint`             | Run ESLint                                                                |
| `npm run format:check`     | Check formatting                                                          |
| `npm run validate:content` | Validate the JSON content pack and references                             |
| `npm run build`            | Copy local WASM assets, typecheck, and build the web app                  |
| `npm run android:sync`     | Build the web app and sync Capacitor's Android project                    |
| `npm run android:apk`      | Build a debug APK (requires the Android SDK)                              |

All production behavior is developed test-first. The Vitest coverage thresholds apply to source and build-asset preparation code; tests are not excluded to lower coverage.

## Architecture

- `src/domain/`: character model, progression, timed session engine, and domain events. This code has no React or Capacitor dependency.
- `src/content/` and `content/core/`: Zod schemas, shared content-pack loader, and a small official JSON pack.
- `src/combat/`: reusable player/enemy actors, executable tag rules, deterministic virtual-time combat, loot tables, and expedition simulation.
- `src/nodes/`: typed graph validation and compilation, glyphs, sigils, and the character's versioned construction library.
- `src/persistence/`: versioned SQLite migrations, atomic save/event transactions, idempotent event IDs, and Capacitor adapters.
- `src/mods/`: Lua/WebAssembly transform boundary. Content packs are JSON and validated through the same loader regardless of source.
- `src/app/`: mobile-first React screen and first playable loop.
- `android/`: generated Capacitor Android host, synced from the web app.

The session engine uses persisted timestamps rather than background timers. On foreground startup it processes elapsed cycles in order, simulates any expedition with a session-derived seed, stores its results atomically, and leaves the character idle when the queue ends. The queue is never restarted automatically. Combat uses virtual time and a saved PRNG state, so continuous play and offline batches produce the same event order.

## Content packs

The official pack is in `content/core/`. External content can be passed as `{ manifest, records, nodes?, glyphs?, sigils?, rules? }` objects to `loadContentPacks`; each pack and record is schema-validated, duplicate IDs are rejected, and declared activity, reward, item, skill, expedition, enemy, loot, and recipe references are checked. Node, glyph, sigil, and tag records use the same validated registries. The official pack goes through that exact code path. Mods use the same runtime contracts as core content; no RP administration rules are enforced by the game.

## Android and CI

`npm run android:add` creates the Capacitor Android host. On machines without the Android SDK, the GitHub Actions workflow installs the SDK, syncs Capacitor, builds `app-debug.apk`, and uploads it as a short-lived artifact. The workflow compiles the APK; physical-device behavior still needs device validation.

The main CI workflow runs typecheck, lint, formatting, 100% coverage, content validation, web build, and a high-severity dependency audit on pushes and pull requests to `main`.

## License

MIT. See [LICENSE](LICENSE).
