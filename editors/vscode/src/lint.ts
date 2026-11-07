import * as vscode from "vscode";
import { lintSources } from "../../../src/lint/analyze.js";
import { parseProjectConfigText } from "../../../src/lint/config-file.js";

const LANGUAGE_ID = "fx";
const CONFIG_FILES = ["fx.yml", "fx.yaml"];
const EXCLUDED = "**/{node_modules,build,dist,coverage,.cache}/**";

/** Diagnostic shape produced by `lintSources`. */
interface LintDiagnostic {
  ruleId: string;
  severity: "error" | "warning" | "info";
  message: string;
  file: string | null;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  fix?: {
    kind: string;
    name: string;
    file?: string | null;
    line?: number;
    column?: number;
    indent?: string;
  };
}

interface LintProject {
  groups: Map<string, LintDiagnostic[]>;
  documents: vscode.TextDocument[];
  configUri: vscode.Uri | null;
  configError: string | null;
}

/** Fix descriptors for the diagnostics currently published, by location. */
const fixes = new Map<string, NonNullable<LintDiagnostic["fix"]>>();

/** Last run that published per document URI, so stale runs can be ignored. */
const publishedRuns = new Map<string, number>();
let nextRunId = 0;

/** Start a lint run; pass the id to the publish helpers below. */
export function beginLintRun(): number {
  nextRunId += 1;
  return nextRunId;
}

function fixKey(uri: vscode.Uri, line: number, character: number): string {
  return `${uri.toString()}:${line}:${character}`;
}

/** Parent directory URI, without relying on node:path. */
function directoryOf(uri: vscode.Uri): vscode.Uri {
  const path = uri.path.replace(/\/[^/]*$/, "");
  return uri.with({ path: path || "/" });
}

function isInside(uri: vscode.Uri, root: vscode.Uri): boolean {
  const base = root.path.endsWith("/") ? root.path : `${root.path}/`;
  return uri.path === root.path || uri.path.startsWith(base);
}

/** Whether `uri` is one of the project configuration files. */
export function isProjectConfig(uri: vscode.Uri): boolean {
  const name = uri.path.slice(uri.path.lastIndexOf("/") + 1);
  return CONFIG_FILES.includes(name);
}

/** Whether `document` lives under the directory configured by `configUri`. */
export function isInProject(
  document: vscode.TextDocument,
  configUri: vscode.Uri,
): boolean {
  return isInside(document.uri, directoryOf(configUri));
}

async function readText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return new TextDecoder().decode(bytes);
}

/** Walk up from `start` for `fx.yml`/`fx.yaml`, staying inside the folder. */
async function findConfig(
  start: vscode.Uri,
  root: vscode.Uri | undefined,
): Promise<vscode.Uri | null> {
  let dir = start;
  for (;;) {
    for (const name of CONFIG_FILES) {
      const candidate = vscode.Uri.joinPath(dir, name);
      try {
        const stat = await vscode.workspace.fs.stat(candidate);
        if (stat.type & vscode.FileType.File) return candidate;
      } catch {
        // Not here; keep walking up.
      }
    }
    if (root && dir.path === root.path) return null;
    if (!dir.path || dir.path === "/") return null;
    const parent = directoryOf(dir);
    if (parent.path === dir.path) return null;
    if (root && !isInside(parent, root)) return null;
    dir = parent;
  }
}

/** Nearest project configuration for `uri`, if it belongs to a project. */
export async function projectConfigFor(
  uri: vscode.Uri,
): Promise<vscode.Uri | null> {
  // Unsaved buffers have no directory to search from.
  if (uri.scheme === "untitled") return null;
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return findConfig(directoryOf(uri), folder?.uri);
}

/**
 * Lint the project that contains `document`: every `.tfx` file under the
 * nearest `fx.yml`, plus unsaved open documents. Diagnostics are grouped by
 * the source URI string so they can be published per open document.
 */
export async function lintDocument(
  document: vscode.TextDocument,
): Promise<LintProject> {
  // Unsaved buffers are linted on their own: merging unrelated scratch files
  // into a project would invent duplicate-sprite and scope errors.
  const untitled = document.uri.scheme === "untitled";
  const configUri = untitled ? null : await projectConfigFor(document.uri);
  const projectRoot = configUri ? directoryOf(configUri) : null;

  // Scope the run to the discovered project. Without an fx.yml there is no
  // project to merge, so fall back to linting the current document only.
  const projectDocuments: vscode.TextDocument[] = [document];
  if (projectRoot) {
    for (const candidate of vscode.workspace.textDocuments) {
      if (candidate.languageId !== LANGUAGE_ID) continue;
      if (candidate.uri.scheme === "untitled") continue;
      if (candidate.uri.toString() === document.uri.toString()) continue;
      if (isInside(candidate.uri, projectRoot))
        projectDocuments.push(candidate);
    }
  }

  let parsed: ReturnType<typeof parseProjectConfigText> | null = null;
  let configError: string | null = null;
  if (configUri) {
    try {
      parsed = parseProjectConfigText(await readText(configUri));
      configError = parsed.error ?? null;
    } catch (error) {
      configError = error instanceof Error ? error.message : String(error);
    }
  }

  const sources = new Map<string, string>();
  if (projectRoot) {
    try {
      // Read every project file first, then insert the results in path order
      // so the merged program does not depend on read completion order.
      const found = (
        await vscode.workspace.findFiles(
          new vscode.RelativePattern(projectRoot, "**/*.tfx"),
          EXCLUDED,
        )
      ).sort((a, b) => a.path.localeCompare(b.path));
      const texts = await Promise.all(
        found.map(async (uri) => {
          try {
            return [uri, await readText(uri)] as const;
          } catch {
            // A file that disappeared between findFiles and read is skipped.
            return null;
          }
        }),
      );
      for (const entry of texts)
        if (entry) sources.set(entry[0].toString(), entry[1]);
    } catch {
      // Workspace search is best effort; open documents still get linted.
    }
  }
  // Open buffers always win over the text on disk, including unsaved edits.
  for (const candidate of projectDocuments)
    sources.set(candidate.uri.toString(), candidate.getText());

  const result = lintSources({
    sources: [...sources].map(([file, source]) => ({ file, source })),
    config: parsed?.config ?? null,
    configPath: configUri?.toString() ?? null,
    configDir: configUri ? directoryOf(configUri).toString() : undefined,
    rootDir: projectRoot?.toString() ?? undefined,
    testPattern: parsed?.testPattern ?? undefined,
    lintConfig: parsed?.lintConfig ?? undefined,
    declaredExtensions: parsed?.declaredExtensions ?? [],
  }) as { diagnostics: LintDiagnostic[] };

  const groups = new Map<string, LintDiagnostic[]>();
  for (const diagnostic of result.diagnostics) {
    if (!diagnostic.file) continue;
    const list = groups.get(diagnostic.file) ?? [];
    list.push(diagnostic);
    groups.set(diagnostic.file, list);
  }
  return { groups, documents: projectDocuments, configUri, configError };
}

/** Convert one linter diagnostic into a VS Code diagnostic. */
function toDiagnostic(
  entry: LintDiagnostic,
  document: vscode.TextDocument,
): vscode.Diagnostic {
  const lastLine = Math.max(0, document.lineCount - 1);
  const startLine = Math.min(Math.max(0, entry.line - 1), lastLine);
  const startCharacter = Math.max(0, entry.column - 1);
  const endLine = Math.min(Math.max(startLine, entry.endLine - 1), lastLine);
  const endCharacter = Math.max(startCharacter, entry.endColumn - 1);
  const range = new vscode.Range(
    startLine,
    startCharacter,
    endLine,
    endCharacter,
  );
  const severity =
    entry.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : entry.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
  const diagnostic = new vscode.Diagnostic(range, entry.message, severity);
  diagnostic.source = LANGUAGE_ID;
  diagnostic.code = entry.ruleId;
  if (entry.fix)
    fixes.set(fixKey(document.uri, startLine, startCharacter), entry.fix);
  return diagnostic;
}

/** Mark `runId` as the latest publisher for a document, if it still is. */
function claim(uriKey: string, runId: number): boolean {
  if ((publishedRuns.get(uriKey) ?? 0) > runId) return false;
  publishedRuns.set(uriKey, runId);
  return true;
}

/** Drop fix descriptors published for the document's previous diagnostics. */
function clearFixes(uriKey: string): void {
  const prefix = `${uriKey}:`;
  for (const key of [...fixes.keys()])
    if (key.startsWith(prefix)) fixes.delete(key);
}

/** Report a broken `fx.yml`/`fx.yaml` against the config file itself. */
function configDiagnostic(uri: vscode.Uri, message: string): vscode.Diagnostic {
  const name = uri.path.slice(uri.path.lastIndexOf("/") + 1) || "fx.yml";
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(0, 0, 0, 0),
    `Invalid ${name}: ${message}`,
    vscode.DiagnosticSeverity.Error,
  );
  diagnostic.source = LANGUAGE_ID;
  diagnostic.code = "FX000";
  return diagnostic;
}

/**
 * Publish grouped diagnostics for every open document in the project. A run
 * that a newer run has already superseded publishes nothing. A configuration
 * error is surfaced on the config file, and cleared once it parses again.
 */
export function publishDiagnostics(
  collection: vscode.DiagnosticCollection,
  project: LintProject,
  runId: number,
): void {
  if (project.configUri && claim(project.configUri.toString(), runId)) {
    collection.set(
      project.configUri,
      project.configError
        ? [configDiagnostic(project.configUri, project.configError)]
        : [],
    );
  }
  for (const document of project.documents) {
    const key = document.uri.toString();
    if (!claim(key, runId)) continue;
    clearFixes(key);
    const diagnostics = project.groups.get(key) ?? [];
    collection.set(
      document.uri,
      diagnostics.map((entry) => toDiagnostic(entry, document)),
    );
  }
}

/**
 * Release a closed document: clear its fixes and let any pending run know it
 * must not publish for it anymore.
 */
export function invalidateDocument(uri: vscode.Uri): void {
  const key = uri.toString();
  nextRunId += 1;
  publishedRuns.set(key, nextRunId);
  clearFixes(key);
}

/**
 * Publish a single failure diagnostic, unless a newer run already published
 * for the document. The diagnostic is built lazily so superseded runs do no
 * work and cannot overwrite fresher state.
 */
export function publishFailure(
  collection: vscode.DiagnosticCollection,
  document: vscode.TextDocument,
  runId: number,
  makeDiagnostic: () => vscode.Diagnostic,
): void {
  const key = document.uri.toString();
  if (!claim(key, runId)) return;
  clearFixes(key);
  collection.set(document.uri, [makeDiagnostic()]);
}

/** Offer the FX204 declaration insertion as an editor quick fix. */
export class FxQuickFixProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== "FX204") continue;
      const fix = fixes.get(
        fixKey(
          document.uri,
          diagnostic.range.start.line,
          diagnostic.range.start.character,
        ),
      );
      if (!fix) continue;
      if (fix.file !== document.uri.toString()) continue;
      if (fix.line == null || fix.column == null) continue;
      const action = new vscode.CodeAction(
        `Declare \`let ${fix.name} = 0;\``,
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];
      const edit = new vscode.WorkspaceEdit();
      // The fix records the 1-based opening-brace column; inserting at that
      // character index puts the declaration immediately inside the block.
      edit.insert(
        document.uri,
        new vscode.Position(fix.line - 1, fix.column),
        `\n${fix.indent ?? "    "}let ${fix.name} = 0;`,
      );
      action.edit = edit;
      actions.push(action);
    }
    return actions;
  }
}
