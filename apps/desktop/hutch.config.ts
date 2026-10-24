// @hutch cli=0.28.1
export default {
  scripts: {
    dev: "hutch electrobun prepare && bun run --cwd src/views/studio build && hutch electrobun dev --watch",
    build:
      "hutch electrobun prepare && bun run --cwd src/views/studio build && hutch electrobun build --env=stable",
  },
  electrobun: {
    version: "2.0.4",
  },
};
