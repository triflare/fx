#!/usr/bin/env node
/**
 * Triflare Fx command line interface.
 *
 * The implementation lives in `src/cli`; this entrypoint only delegates so it
 * stays usable as a Node API (`run()` returns an exit code) in tests.
 */
import { run } from "../src/cli/run.js";

process.exitCode = await run();
