/**
 * Shell adapter (R3 mitigation): a thin abstraction over the desktop shell so
 * headless mode (CI, browser dev) and the Electrobun implementation are
 * interchangeable. ElectrobunShell lands with the UI (P8).
 */

export interface UiRequestContext {
  method: string;
  params: unknown;
}

export interface Shell {
  readonly kind: "electrobun" | "headless";
  /** Push an event to the UI. */
  sendToUi(method: string, params: unknown): void;
  /** Register the UI request dispatcher; returns an unsubscribe fn. */
  onRequest(handler: (ctx: UiRequestContext) => Promise<unknown>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** URL the user can open (headless) or null (native window). */
  url(): string | null;
}
