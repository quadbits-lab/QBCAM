/**
 * Electrobun main-process entrypoint (Hutch build target).
 * Kept separate from index.ts so the plain Bun/headless path never imports the
 * Electrobun SDK, which only exists inside the generated .hutch/devkit.
 */
import { main } from "./index";
import { ElectrobunShell } from "./shell/electrobun";

main(new ElectrobunShell()).catch((err) => {
  console.error("[core] fatal:", err);
  process.exit(1);
});
