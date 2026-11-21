import { useMemo } from 'react';
import { createTreeCollection } from '@ark-ui/react/tree-view';
import type { DocumentBrowserProps } from './contracts';
import { buildDocumentTree, type DocumentTreeNode } from './document-tree';
import { DocumentTreeView } from './DocumentTree.view';

export function DocumentTree(props: DocumentBrowserProps) {
  const tree = useMemo(() => buildDocumentTree(props.model.snapshot?.documents ?? [], props.model.query), [props.model.snapshot, props.model.query]);
  const collection = useMemo(() => createTreeCollection<DocumentTreeNode>({
    rootNode: tree.root, nodeToValue: node => node.id, nodeToString: node => node.name, nodeToChildren: node => node.children ?? [],
  }), [tree]);
  return <DocumentTreeView {...props} tree={tree} collection={collection} />;
}
