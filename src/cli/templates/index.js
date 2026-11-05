/**
 * Scaffolding templates used by `fx init`.
 */

import {
  configFilename,
  sourceDirectory,
  sourceExtension,
} from "../../brand.js";

const CAT_ASSET = `<svg xmlns="http://www.w3.org/2000/svg" width="95" height="101" viewBox="0 0 95 101">
  <ellipse cx="47" cy="60" rx="35" ry="35" fill="#ffab19" stroke="#cf8b17" stroke-width="4"/>
  <circle cx="35" cy="50" r="6" fill="#000"/>
  <circle cx="60" cy="50" r="6" fill="#000"/>
</svg>
`;

function configText({ name, width, height, target }) {
  const lines = [
    "project:",
    `  name: ${JSON.stringify(name)}`,
    "  fps: 60",
    `  width: ${width}`,
    `  height: ${height}`,
    "  turbo: false",
    "  interpolation: true",
    "fx:",
    "  partialSprites: false",
  ];
  if (target !== "none") {
    lines.push("package:", `  target: ${target}`);
  }
  return `${lines.join("\n")}\n`;
}

const CAT_SOURCE = `sprite "Cat" {
    costumes: {
        cat: "../assets/cat.svg"
    };

    let score = 0;

    when greenFlag {
        motion.goToXY(0, 0);
        control.forever {
            motion.turnRight(1);
        }
    }

    when keyPressed("space") {
        score += 1;
        looks.sayForSecs(operators.join("Score: ", score), 1);
    }
}
`;

const EMPTY_SOURCE = `// Your project starts here.
when greenFlag {
    looks.say("Hello, world!");
}
`;

const BLANK_SOURCE = `// Your project starts here.
`;

/**
 * Build the file map for an init run.
 *
 * @param {{
 *   product: object,
 *   name: string,
 *   template: "cat"|"empty"|"blank",
 *   width: number,
 *   height: number,
 *   target: string,
 * }} options
 */
export function initFiles({ product, name, template, width, height, target }) {
  const files = {
    [configFilename(product)]: configText({ name, width, height, target }),
    [`${sourceDirectory(product)}/main${sourceExtension(product)}`]:
      template === "cat"
        ? CAT_SOURCE
        : template === "empty"
          ? EMPTY_SOURCE
          : BLANK_SOURCE,
  };
  if (template === "cat") files["assets/cat.svg"] = CAT_ASSET;
  return files;
}

export const TEMPLATES = [
  {
    value: "cat",
    label: "Cat demo",
    hint: "sprite, costumes, events, variables",
  },
  { value: "empty", label: "Empty project", hint: "one green-flag script" },
  { value: "blank", label: "Blank", hint: "just the config and a source file" },
];

export const TARGETS = [
  { value: "none", label: "None", hint: "source only" },
  { value: "html", label: "HTML", hint: "single-file web build" },
  { value: "zip", label: "ZIP", hint: "packaged archive" },
];

export const STAGE_SIZES = [
  { value: "480x360", label: "480 × 360", hint: "Scratch default" },
  { value: "640x360", label: "640 × 360", hint: "wide" },
  { value: "1920x1080", label: "1920 × 1080", hint: "full HD" },
];
