import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "QBCAM",
    identifier: "ai.qbcam.desktop",
    version: "0.1.0",
    description: "Real-time AI face swap, virtual webcam & studio recorder",
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/main/electrobun-entry.ts",
    },
    watchIgnore: ["src/views/studio/dist/**"],
    mac: {
      icons: "public/app-icon.icon",
      bundleCEF: false,
      entitlements: {
        "com.apple.security.device.camera": true,
        "com.apple.security.device.audio-input": true,
      },
    },
    linux: {
      icon: "public/app-icon.ico",
      bundleCEF: false,
    },
    win: {
      icon: "public/app-icon.png",
      bundleCEF: false,
    },
  },
  scripts: {
    postWrap: "./scripts/patch-info-plist.ts",
    postPackage: "./scripts/patch-info-plist.ts",
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
} satisfies ElectrobunConfig;
