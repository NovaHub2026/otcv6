import type { EngineAccess } from '../engineAccess.js';

/**
 * The Lab's end of the venue's engine callback (PH-28.2).
 *
 * `hand` is what the composition passes as `AppModuleOptions.engineAccess`;
 * `get` is what the Lab's providers read once the venue has been built. Asking
 * before the venue exists is a composition error and is refused by name rather
 * than answered with null.
 */
export class EngineHandle {
  #access: EngineAccess | null = null;

  readonly hand = (access: EngineAccess): void => {
    if (this.#access !== null)
      throw new Error('The engine access was handed to this handle twice.');
    this.#access = access;
  };

  get(): EngineAccess {
    if (this.#access === null) {
      throw new Error(
        'No engine access has been handed to this handle: the venue was not composed with it.',
      );
    }
    return this.#access;
  }
}
