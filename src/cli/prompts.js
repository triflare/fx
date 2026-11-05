/**
 * Interactive prompt layer.
 *
 * `@clack/prompts` provides the widgets; this wrapper keeps Fx styling,
 * non-interactive fallbacks, cancellation, and testability in one place.
 */

import {
  cancel,
  confirm as clackConfirm,
  intro as clackIntro,
  isCancel,
  note as clackNote,
  outro as clackOutro,
  select as clackSelect,
  spinner as clackSpinner,
  text as clackText,
  updateSettings,
} from "@clack/prompts";
import { CliError, UsageError, EXIT } from "./errors.js";

updateSettings({
  messages: {
    cancel: "Cancelled",
    error: "Something went wrong",
  },
});

function cancelled() {
  return new CliError("Cancelled", {
    code: "CANCELLED",
    exitCode: EXIT.INTERRUPTED,
    silent: true,
  });
}

function unwrap(value) {
  if (isCancel(value)) throw cancelled();
  return value;
}

/**
 * @param {{
 *   reporter: ReturnType<import("./reporter.js").createReporter>,
 *   product: object,
 *   tty?: boolean,
 *   noInput?: boolean,
 *   json?: boolean,
 *   input?: NodeJS.ReadableStream,
 *   output?: NodeJS.WritableStream,
 * }} options
 */
export function createPrompts({
  reporter,
  product,
  tty = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  noInput = false,
  json = false,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const enabled = tty && !noInput && !json;
  const common = { input, output };

  const requireFallback = (value, feature) => {
    if (value !== undefined) return value;
    throw new UsageError(
      `${feature} requires an interactive terminal, --yes, or an explicit value`,
    );
  };

  const message = (text) => reporter.accent(String(text));

  return {
    enabled,

    intro(text) {
      if (!enabled) return;
      clackIntro(
        reporter.brand(`${product?.name ?? "Fx"} ${product?.version ?? ""}`) +
          (text ? `\n${message(text)}` : ""),
        common,
      );
    },

    outro(text) {
      if (!enabled) return;
      clackOutro(message(text), common);
    },

    note(text, title) {
      if (!enabled) return;
      clackNote(message(text), title ? message(title) : undefined, common);
    },

    async text({ message: prompt, placeholder, defaultValue, validate }) {
      if (!enabled) return requireFallback(defaultValue, prompt);
      return unwrap(
        await clackText(
          {
            ...common,
            message: message(prompt),
            placeholder,
            defaultValue,
            validate,
          },
          common,
        ),
      );
    },

    async select({ message: prompt, options, initialValue }) {
      if (!enabled) return requireFallback(initialValue, prompt);
      return unwrap(
        await clackSelect(
          {
            ...common,
            message: message(prompt),
            options,
            initialValue,
          },
          common,
        ),
      );
    },

    async confirm({ message: prompt, initialValue = true }) {
      if (!enabled) return initialValue;
      return unwrap(
        await clackConfirm(
          {
            ...common,
            message: message(prompt),
            initialValue,
          },
          common,
        ),
      );
    },

    async confirmDestructive({ message: prompt, yes = false }) {
      if (yes) return true;
      if (!enabled)
        throw new UsageError(
          `${prompt} is destructive; pass --yes to confirm in non-interactive mode`,
        );
      return unwrap(
        await clackConfirm(
          {
            ...common,
            message: message(prompt),
            initialValue: false,
          },
          common,
        ),
      );
    },

    cancel(text = "Cancelled") {
      if (!enabled) return;
      cancel(message(text), common);
    },

    spinner() {
      if (!enabled) {
        return {
          start() {},
          stop() {},
          message() {},
        };
      }
      const spin = clackSpinner(common);
      return {
        start: (text) => spin.start(message(text)),
        stop: (text) => spin.stop(text ? message(text) : undefined),
        message: (text) => spin.message(message(text)),
      };
    },
  };
}
