/**
 * Shell adapter (R3 mitigation): a thin abstraction over the desktop shell so
 * headless mode (CI, browser dev) and the Electrobun implementation are
 * interchangeable.
 */

export interface UiRequestContext {
  method: string;
  params: unknown;
}

export interface PickFilesOptions {
  title?: string;
  /** Comma-separated extensions, e.g. "png,jpg,jpeg". */
  allowedFileTypes?: string;
  multiple?: boolean;
}

export interface Shell {
  readonly kind: "electrobun" | "headless";
  /** Push an event to the UI. */
  sendToUi(method: string, params: unknown): void;
  /** Register the UI request dispatcher; returns an unsubscribe fn. */
  onRequest(handler: (ctx: UiRequestContext) => Promise<unknown>): void;
  /** Register a callback the shell invokes when the user quits the app. */
  onQuit?(handler: () => void | Promise<void>): void;
  /** Open a URL or platform settings deep link in the OS. */
  openExternal(url: string): Promise<boolean>;
  /** Reveal a file in Finder/Explorer. */
  showItemInFolder(path: string): Promise<boolean>;
  /** Native file picker; returns [] when the shell has no dialog. */
  pickFiles(options?: PickFilesOptions): Promise<string[]>;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** URL the user can open (headless) or null (native window). */
  url(): string | null;
}
