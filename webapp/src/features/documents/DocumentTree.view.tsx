import { TreeView, createTreeCollection } from '@ark-ui/react/tree-view';
import type { DocumentBrowserProps } from './contracts';
import { buildDocumentTree, documentNodeId, folderNodeId, type DocumentTreeNode } from './document-tree';

export function DocumentTreeView({ model, actions, tree, collection }: DocumentBrowserProps & {
  tree: ReturnType<typeof buildDocumentTree>;
  collection: ReturnType<typeof createTreeCollection<DocumentTreeNode>>;
}) {
  const expanded = model.query.trim() ? tree.folders : model.expandedFolders;
  return <>
    <TreeView.Root className="document-tree" collection={collection} aria-label="Documents"
      data-density={model.treeAppearance.density} data-accent={model.treeAppearance.accent}
      expandedValue={expanded.map(folderNodeId)} selectedValue={model.documentId ? [documentNodeId(model.documentId)] : []}
      onExpandedChange={details => actions.setExpandedFolders(details.expandedValue.map(id => id.slice('folder:'.length)))}
      onSelectionChange={details => {
        const document = details.selectedValue[0] ? collection.findNode(details.selectedValue[0])?.document : undefined;
        if (document) actions.selectDocument(document.id);
      }}>
      <TreeView.Tree aria-label="Documents">
        {collection.rootNode.children?.map((node, index) => <DocumentTreeNodeView key={node.id} node={node} indexPath={[index]} />)}
      </TreeView.Tree>
    </TreeView.Root>
    <p className="tree-results muted" aria-live="polite">{tree.count ? `${tree.count} of ${model.snapshot?.documents.length ?? 0} documents` : 'No documents match this search.'}</p>
  </>;
}

function DocumentTreeNodeView({ node, indexPath }: { node: DocumentTreeNode; indexPath: number[] }) {
  return <TreeView.NodeProvider node={node} indexPath={indexPath}>
    {node.children ? <TreeView.Branch>
      <TreeView.BranchControl className="document-tree-row" title={node.path}>
        <TreeView.BranchIndicator className="tree-chevron" aria-hidden="true">›</TreeView.BranchIndicator>
        <TreeView.BranchText className="tree-name">{node.name}</TreeView.BranchText>
      </TreeView.BranchControl>
      <TreeView.BranchContent>
        {node.children.map((child, index) => <DocumentTreeNodeView key={child.id} node={child} indexPath={[...indexPath, index]} />)}
      </TreeView.BranchContent>
    </TreeView.Branch> : <TreeView.Item className="document-tree-row" title={node.path} aria-label={node.path}>
      <span className="tree-file-icon" aria-hidden="true">▤</span>
      <TreeView.ItemText className="tree-name">{node.name}</TreeView.ItemText>
      <small className="tree-size">{node.document?.size == null ? 'Size unknown' : `${node.document.size.toLocaleString()} bytes`}</small>
    </TreeView.Item>}
  </TreeView.NodeProvider>;
}
