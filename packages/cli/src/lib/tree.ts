export interface SessionTreeNode<T> {
  value: T;
  children: SessionTreeNode<T>[];
}

interface Treeable {
  id: string;
  parentSessionId?: string;
}

/**
 * Groups sessions under their parents. Sessions whose parent is missing from
 * the list (or absent entirely) become roots, so a partial listing still
 * renders as a forest instead of dropping children.
 */
export function buildSessionTree<T extends Treeable>(items: T[]): SessionTreeNode<T>[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const childrenOf = new Map<string, T[]>();

  const roots: T[] = [];
  for (const item of items) {
    const parentId = item.parentSessionId;
    if (parentId && byId.has(parentId)) {
      const children = childrenOf.get(parentId) ?? [];
      children.push(item);
      childrenOf.set(parentId, children);
    } else {
      roots.push(item);
    }
  }

  const build = (item: T): SessionTreeNode<T> => ({
    value: item,
    children: (childrenOf.get(item.id) ?? []).map(build),
  });

  return roots.map(build);
}

/**
 * Renders a session forest with box-drawing connectors. Each line is produced
 * by `format`, so the caller keeps its own per-session line styling.
 */
export function renderSessionTree<T extends Treeable>(
  nodes: SessionTreeNode<T>[],
  format: (t: T) => string
): string[] {
  const lines: string[] = [];

  const walk = (node: SessionTreeNode<T>, prefix: string, isLast: boolean, isRoot: boolean): void => {
    const connector = isRoot ? "" : isLast ? "└─ " : "├─ ";
    lines.push(prefix + connector + format(node.value));
    const childPrefix = isRoot ? "" : prefix + (isLast ? "   " : "│  ");
    node.children.forEach((child, index) =>
      walk(child, childPrefix, index === node.children.length - 1, false)
    );
  };

  nodes.forEach((node) => walk(node, "", true, true));
  return lines;
}
