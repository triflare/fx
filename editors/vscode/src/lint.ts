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
    targetLine?: number;
    indent?: string;
  };
}

interface LintProject {
  groups: Map<string, LintDiagnostic[]>;
  documents: vscode.TextDocument[];
}

/** Fix descriptors for the diagnostics currently published, by location. */
const fixes = new Map<string, NonNullable<LintDiagnostic["fix"]>>();

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

/**
 * Lint the project that contains `document`: every `.tfx` file under the
 * nearest `fx.yml`, plus unsaved open documents. Diagnostics are grouped by
 * the source URI string so they can be published per open document.
 */
export async function lintDocument(
  document: vscode.TextDocument,
): Promise<LintProject> {
  const open = new Map<string, vscode.TextDocument>();
  for (const candidate of vscode.workspace.textDocuments) {
    if (candidate.languageId === LANGUAGE_ID)
      open.set(candidate.uri.toString(), candidate);
  }
  open.set(document.uri.toString(), document);

  // Unsaved buffers are linted on their own: merging unrelated scratch files
  // into a project would invent duplicate-sprite and scope errors.
  const untitled = document.uri.scheme === "untitled";
  const projectDocuments = untitled ? [document] : [...open.values()];
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  let configUri: vscode.Uri | null = null;
  if (!untitled)
    configUri = await findConfig(directoryOf(document.uri), folder?.uri);

  let parsed: ReturnType<typeof parseProjectConfigText> | null = null;
  if (configUri) {
    try {
      parsed = parseProjectConfigText(await readText(configUri));
    } catch {
      parsed = null;
    }
  }

  const sources = new Map<string, string>();
  if (!untitled && configUri && folder) {
    try {
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*.tfx"),
        EXCLUDED,
      );
      await Promise.all(
        found.map(async (uri) => {
          try {
            sources.set(uri.toString(), await readText(uri));
          } catch {
            // A file that disappeared between findFiles and read is skipped.
          }
        }),
      );
    } catch {
      // Workspace search is best effort; open documents still get linted.
    }
  }
  for (const candidate of projectDocuments) {
    if (!sources.has(candidate.uri.toString()))
      sources.set(candidate.uri.toString(), candidate.getText());
  }
  sources.set(document.uri.toString(), document.getText());

  const result = lintSources({
    sources: [...sources].map(([file, source]) => ({ file, source })),
    config: parsed?.config ?? null,
    configPath: configUri?.toString() ?? null,
    configDir: configUri ? directoryOf(configUri).toString() : undefined,
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
  return { groups, documents: projectDocuments };
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

/** Publish grouped diagnostics for every open document in the project. */
export function publishDiagnostics(
  collection: vscode.DiagnosticCollection,
  project: LintProject,
): void {
  for (const document of project.documents) {
    const diagnostics = project.groups.get(document.uri.toString()) ?? [];
    collection.set(
      document.uri,
      diagnostics.map((entry) => toDiagnostic(entry, document)),
    );
  }
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
      const action = new vscode.CodeAction(
        `Declare \`let ${fix.name} = 0;\``,
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];
      const edit = new vscode.WorkspaceEdit();
      const line = Math.max(0, fix.targetLine ?? 1);
      edit.insert(
        document.uri,
        new vscode.Position(line, 0),
        `${fix.indent ?? "    "}let ${fix.name} = 0;\n`,
      );
      action.edit = edit;
      actions.push(action);
    }
    return actions;
  }
}
