import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { LINE_COLUMN } from "./tokens";

const AT_LINE = new RegExp(`${LINE_COLUMN}$`);

// The folder and, as git prints paths from there, its repository's root.
export function searchFolders(folder: string): string[] {
  for (let dir = folder; dirname(dir) !== dir; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir === folder ? [folder] : [folder, dir];
  }
  return [folder];
}

// A file as a program printed it, relative to one of the folders and with an
// editor's line and column. Anything that isn't a readable file is null.
export function existingFile(
  text: string,
  folders: readonly string[],
  home: string,
): string | null {
  const path = text.replace(AT_LINE, "");
  const files =
    path === "~" || path.startsWith("~/")
      ? [home + path.slice(1)]
      : folders.map((folder) => resolve(folder, path));
  return files.find(isFile) ?? null;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
