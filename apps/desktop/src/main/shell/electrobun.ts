/**
 * Electrobun shell — native system-webview window over the same loopback
 * UI/RPC surface used by HeadlessShell (ADR-010).
 *
 * The window loads http://127.0.0.1:<port>, so the Studio UI, its relative
 * fetches and its WebSocket event stream stay unchanged while the user gets a
 * real desktop window instead of a browser tab. Swapping the transport for
 * Electrobun RPC is a follow-up; this keeps the shell risk in one file.
 */
import { join } from "node:path";
import { BrowserWindow, Utils } from "electrobun/main";
import { electrobunEventEmitter } from "electrobun/main/events";
import { repoRoot } from "../paths";
import type { PickFilesOptions, Shell, UiRequestContext } from ".";
import { HeadlessShell } from "./headless";

export class ElectrobunShell implements Shell {
  readonly kind = "electrobun" as const;

  private readonly inner = new HeadlessShell(
    join(repoRoot(), "apps", "desktop", "src", "views", "studio", "dist"),
  );
  private window: BrowserWindow | null = null;
  private quitHandler: (() => void | Promise<void>) | null = null;

  onQuit(handler: () => void | Promise<void>) {
    this.quitHandler = handler;
  }

  sendToUi(method: string, params: unknown) {
    this.inner.sendToUi(method, params);
  }

  onRequest(handler: (ctx: UiRequestContext) => Promise<unknown>) {
    this.inner.onRequest(handler);
  }

  async openExternal(url: string): Promise<boolean> {
    try {
      return Utils.openExternal(url);
    } catch {
      return false;
    }
  }

  async showItemInFolder(path: string): Promise<boolean> {
    try {
      Utils.showItemInFolder(path);
      return true;
    } catch {
      return false;
    }
  }

  async pickFiles(options: PickFilesOptions = {}): Promise<string[]> {
    try {
      return await Utils.openFileDialog({
        allowedFileTypes: options.allowedFileTypes ?? "png,jpg,jpeg,webp",
        canChooseFiles: true,
        canChooseDirectory: false,
        allowsMultipleSelection: options.multiple ?? true,
      });
    } catch {
      return [];
    }
  }

  async start(): Promise<void> {
    await this.inner.start();
    const url = this.inner.url();
    if (!url) throw new Error("electrobun shell: UI server did not start");

    this.window = new BrowserWindow({
      title: "QBCAM",
      url,
      frame: { width: 1280, height: 840 },
    });

    // Native quit (window close / Cmd+Q) must stop sidecars and the server.
    // exitOnLastWindowClosed is false so the window does not race this cleanup.
    this.window.on("close", () => {
      void this.quitHandler?.();
    });
    electrobunEventEmitter.on("before-quit", () => {
      void this.quitHandler?.();
    });
  }

  async stop(): Promise<void> {
    this.window?.close();
    this.window = null;
    await this.inner.stop();
  }

  url(): string | null {
    return null;
  }
}
