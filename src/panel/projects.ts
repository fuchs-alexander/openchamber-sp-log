import type { SpProject } from "./api.ts";

export type ProjectGroups = { ungrouped: SpProject[]; groups: { folder: string; projects: SpProject[] }[] };

const compare = (a: string, b: string): number => a.localeCompare(b, "de", { sensitivity: "base" });

/** Projects without folder first, then one group per SP folder; both sorted by name. */
export function groupProjects(projects: SpProject[]): ProjectGroups {
  const byTitle = (list: SpProject[]) => [...list].sort((a, b) => compare(a.title, b.title));
  const folders = new Map<string, SpProject[]>();
  const ungrouped: SpProject[] = [];
  for (const p of projects) {
    if (!p.folder) {
      ungrouped.push(p);
      continue;
    }
    const list = folders.get(p.folder);
    if (list) list.push(p);
    else folders.set(p.folder, [p]);
  }
  const groups = [...folders.keys()].sort(compare).map((folder) => ({ folder, projects: byTitle(folders.get(folder)!) }));
  return { ungrouped: byTitle(ungrouped), groups };
}
