import type { DocumentDTO } from '../../app-hooks/contracts';

export interface DocumentTreeNode {
  id: string;
  name: string;
  path: string;
  document?: DocumentDTO;
  children?: DocumentTreeNode[];
}

export const folderNodeId = (path: string) => `folder:${path}`;
export const documentNodeId = (id: string) => `document:${id}`;
export function ancestorFolders(path: string): string[] {
  const segments = path.split('/');
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}

/** Folders are derived navigation, never new resources or document identities. */
export function buildDocumentTree(documents: readonly DocumentDTO[], query: string) {
  const root: DocumentTreeNode = { id: 'root', name: 'Documents', path: '', children: [] };
  const folders = new Map<string, DocumentTreeNode>();
  const matches = documents.filter(document => document.path.toLowerCase().includes(query.trim().toLowerCase()));
  for (const document of matches) {
    let parent = root;
    for (const path of ancestorFolders(document.path)) {
      let folder = folders.get(path);
      if (!folder) {
        folder = { id: folderNodeId(path), name: path.split('/').at(-1)!, path, children: [] };
        folders.set(path, folder);
        parent.children!.push(folder);
      }
      parent = folder;
    }
    parent.children!.push({ id: documentNodeId(document.id), name: document.path.split('/').at(-1)!, path: document.path, document });
  }
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  function sort(node: DocumentTreeNode) {
    node.children?.sort((a, b) => Number(Boolean(b.children)) - Number(Boolean(a.children)) || collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
    node.children?.forEach(sort);
  }
  sort(root);
  return { root, folders: [...folders.keys()], count: matches.length };
}
