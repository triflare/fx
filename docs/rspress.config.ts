import fs from "node:fs";
import * as path from "node:path";
import { defineConfig } from "@rspress/core";

// Use the VS Code extension's grammar so `tfx` code fences are highlighted.
const fxGrammar = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../editors/vscode/syntaxes/fx.tmLanguage.json"),
    "utf8",
  ),
);

export default defineConfig({
  root: path.join(__dirname, "docs"),
  // GitHub Pages project sites are served from a subpath; CI sets this.
  base: process.env.RSPRESS_BASE || "/",
  lang: "en",
  title: "Triflare Fx",
  description: "Code PenguinMod projects with text.",
  icon: "/icon.svg",
  markdown: {
    shiki: {
      langs: [{ ...fxGrammar, aliases: ["tfx"] }],
    },
  },
  themeConfig: {
    socialLinks: [
      {
        icon: "github",
        mode: "link",
        content: "https://github.com/triflare/fx",
      },
    ],
  },
  multiVersion: {
    default: "v2",
    versions: ["v1", "v2"],
  },
});
