import path from "path";

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyw": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".scala": "scala",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".dart": "dart",
  ".vue": "vue",
  ".svelte": "svelte",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".sql": "sql",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".json": "json",
  ".xml": "xml",
  ".md": "markdown",
  ".mdx": "markdown",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".tf": "terraform",
  ".prisma": "prisma",
};

const SPECIAL_FILENAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  "go.mod": "go",
  "cargo.toml": "rust",
};

export function detectLanguageFromPath(relativePath: string): string {
  const base = path.posix.basename(relativePath).toLowerCase();
  const special = SPECIAL_FILENAMES[base];
  if (special) return special;

  const ext = path.posix.extname(base).toLowerCase();
  if (ext && EXTENSION_LANGUAGE_MAP[ext]) {
    return EXTENSION_LANGUAGE_MAP[ext];
  }

  if (base.startsWith("dockerfile")) return "dockerfile";
  return "plaintext";
}

export function detectExtension(relativePath: string): string | null {
  const ext = path.posix.extname(relativePath).toLowerCase();
  return ext || null;
}
