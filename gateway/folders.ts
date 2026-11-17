// Folder index from Super Productivity's menu tree (`menuTree.projectTree` in
// its backups). The REST API knows no folders, so this is the only source.
// Nodes: {k:'f', name, children} is a folder, {k:'p', id} is a project.
// Nested folder names are joined with " / ". Invalid structures yield an empty map.

export const FOLDER_SEPARATOR = " / ";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function folderIndex(menuTree: unknown): Map<string, string> {
  const index = new Map<string, string>();
  if (!Array.isArray(menuTree)) return index;

  function walk(nodes: unknown[], path: string[]): void {
    for (const node of nodes) {
      if (!isRecord(node)) continue;
      if (node.k === "p" && typeof node.id === "string") {
        if (path.length > 0) index.set(node.id, path.join(FOLDER_SEPARATOR));
      } else if (node.k === "f" && typeof node.name === "string" && Array.isArray(node.children)) {
        walk(node.children, [...path, node.name]);
      }
    }
  }

  walk(menuTree, []);
  return index;
}
