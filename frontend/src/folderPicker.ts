export function canPickFolder(): boolean {
  return typeof window !== 'undefined' && typeof window.kurarium?.pickFolder === 'function';
}

export async function pickFolders(defaultPath?: string): Promise<string[]> {
  const picker = window.kurarium?.pickFolder;
  if (!picker) return [];
  return picker(defaultPath);
}

export function mergeFolderPaths(current: string, selected: readonly string[]): string {
  const paths = current
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const seen = new Set(paths.map((value) => value.toLowerCase()));
  for (const value of selected) {
    const path = value.trim();
    const key = path.toLowerCase();
    if (!path || seen.has(key)) continue;
    seen.add(key);
    paths.push(path);
  }
  return paths.join('\n');
}

export function firstPath(current: string): string | undefined {
  return current
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0);
}
