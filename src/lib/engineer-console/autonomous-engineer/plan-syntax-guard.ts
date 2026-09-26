import fs from "fs";
import path from "path";
import ts from "typescript";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";

function syntaxErrorsInTypeScript(fileName: string, content: string): string[] {
  const result = ts.transpileModule(content, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  return (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
      const line = diagnostic.file && diagnostic.start != null
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
        : null;
      return line != null ? `${fileName}:${line} ${message}` : `${fileName}: ${message}`;
    });
}

/** Reject planned TypeScript that does not parse — before worktree execution. */
export function validatePlanTypeScriptSyntax(repoPath: string, plan: WorkerPlan): string[] {
  const errors: string[] = [];
  for (const [index, operation] of (plan.operations ?? []).entries()) {
    const relative = operation.path.replace(/^\.?\//, "");
    if (operation.type === "delete_file") continue;
    if (!/\.(ts|tsx)$/.test(relative)) continue;

    let content = operation.content;
    if (operation.type === "append_file") {
      const abs = path.join(repoPath, relative);
      const existing = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
      content = `${existing}${operation.content}`;
    }

    if (!content.trim()) continue;

    for (const message of syntaxErrorsInTypeScript(relative, content)) {
      errors.push(`operation ${index} syntax error in ${relative}: ${message}`);
    }

    // Check for TS5097: illegal .ts/.tsx extensions in relative module imports
    const tsImportRegex =
      /(?:(?:import|export)\s+(?:[\s\S]*?from\s+)?|import\s*\(\s*)['"](\.[^'"]*\.tsx?)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = tsImportRegex.exec(content)) !== null) {
      const importPath = match[1];
      const jsPath = importPath.replace(/\.tsx?$/, ".js");
      errors.push(
        `operation ${index} illegal import path '${importPath}' in ${relative} (TS5097). In TypeScript ESM, import relative modules using '${jsPath}' or without file extension — never with '.ts' extension.`,
      );
    }
    // Check for duplicate export of class/function already declared as 'export class Foo' or 'export function Foo'
    const exportBlockRegex = /export\s*\{([^}]+)\}(?!\s*from)/g;
    while ((match = exportBlockRegex.exec(content)) !== null) {
      const exportList = match[1];
      const items = exportList.split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim()).filter(Boolean);
      for (const exportedName of items) {
        if (/^\w+$/.test(exportedName)) {
          const directDecl = new RegExp(`export\\s+(?:class|function|type|interface|const|let|var)\\s+${exportedName}\\b`);
          if (directDecl.test(content)) {
            errors.push(
              `operation ${index} duplicate export '${exportedName}' in ${relative} (TS2323/TS2484). The symbol is already declared with 'export ${exportedName}', do not add 'export { ... }' at the bottom.`,
            );
          }
        }
      }
    }
  }
  return errors;
}
