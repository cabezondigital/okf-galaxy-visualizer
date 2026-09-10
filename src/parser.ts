import fs from 'fs';
import path from 'path';

export interface GraphNode {
  id: string;
  label: string;
  group: string;
  filePath: string;
  summary: string;
  tags: string[];
  imageUrl?: string;
  color: string;
  size: number;
  isRoot?: boolean;
  metadata?: Record<string, any>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  isStructural?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    clusters: Record<string, number>;
  };
}

// Curated harmonious color palette for clusters
const CLUSTER_PALETTE = [
  '#38bdf8', // Sky / Cyan
  '#fbbf24', // Amber / Gold
  '#f43f5e', // Rose / Haute Pink
  '#10b981', // Emerald Green
  '#a855f7', // Violet / Purple
  '#f97316', // Bright Orange
  '#06b6d4', // Aqua Cyan
  '#ec4899', // Magenta
  '#8b5cf6', // Indigo
  '#14b8a6', // Teal
];

export class OkfVaultParser {
  private vaultDir: string;

  constructor(vaultDir?: string) {
    this.vaultDir = vaultDir || process.env.VAULT_PATH || path.resolve(process.cwd(), 'sample_vault');
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  public parseVault(): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeMap = new Map<string, GraphNode>();
    const clusters: Record<string, number> = {};

    if (!fs.existsSync(this.vaultDir)) {
      console.warn(`⚠️ [OKF Parser] Vault directory not found: ${this.vaultDir}`);
      return { nodes: [], edges: [], stats: { totalNodes: 0, totalEdges: 0, clusters: {} } };
    }

    // 1. Discover subdirectories (clusters) or treat root as single cluster
    const entries = fs.readdirSync(this.vaultDir, { withFileTypes: true });
    const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

    let colorIdx = 0;

    // Helper to process markdown files in a cluster
    const processCluster = (clusterName: string, folderPath: string, isRootFolder = false) => {
      const clusterColor = CLUSTER_PALETTE[colorIdx % CLUSTER_PALETTE.length];
      colorIdx++;

      const rootId = `root_${this.slugify(clusterName)}`;
      const rootLabel = `🌟 ${clusterName.toUpperCase()}`;

      // Create Gravity Center / Root Node for the cluster
      const rootNode: GraphNode = {
        id: rootId,
        label: rootLabel,
        group: clusterName,
        filePath: '',
        summary: `Gravity Center for cluster: ${clusterName}`,
        tags: ['cluster_root', clusterName],
        color: clusterColor,
        size: 42,
        isRoot: true,
      };

      nodes.push(rootNode);
      nodeMap.set(rootId, rootNode);
      clusters[clusterName] = 0;

      const mdFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.md'));
      for (const file of mdFiles) {
        const fullPath = path.join(folderPath, file);
        const rawContent = fs.readFileSync(fullPath, 'utf-8');
        const slug = file.replace('.md', '');

        // Extract title (# Title or frontmatter title)
        const titleMatch = rawContent.match(/^#+\s*(.+)$/m);
        const frontmatterTitleMatch = rawContent.match(/title:\s*["']?([^\r\n"']+)["']?/i);
        let label = frontmatterTitleMatch 
          ? frontmatterTitleMatch[1].trim() 
          : (titleMatch ? titleMatch[1].replace(/\[\[|\]\]/g, '').trim() : slug.replace(/_/g, ' '));

        // Extract tags (#tag or frontmatter tags: [tag1, tag2])
        const tags = Array.from(rawContent.matchAll(/#([a-zA-Z0-9_\-]+)/g)).map(m => m[1]);
        const fmTagsMatch = rawContent.match(/tags:\s*\[([^\]]+)\]/i);
        if (fmTagsMatch) {
          const parsedFmTags = fmTagsMatch[1].split(',').map(t => t.replace(/["'\s]/g, '')).filter(Boolean);
          tags.push(...parsedFmTags);
        }

        // Extract image if defined
        let imageUrl: string | undefined;
        const imgMatch = rawContent.match(/imageFile:\s*["']?([^\r\n"']+)["']?/i) || rawContent.match(/imageUrl:\s*["']?([^\r\n"']+)["']?/i);
        if (imgMatch) {
          imageUrl = imgMatch[1];
        }

        // Clean excerpt summary
        const summaryClean = rawContent
          .replace(/---[\s\S]*?---/, '') // remove YAML frontmatter
          .replace(/#+\s*.+/g, '') // remove headings
          .replace(/\[\[|\]\]/g, '') // remove wikilinks syntax
          .trim()
          .slice(0, 240);

        const node: GraphNode = {
          id: slug,
          label,
          group: clusterName,
          filePath: fullPath,
          summary: summaryClean ? summaryClean + '...' : 'No description provided.',
          tags: Array.from(new Set(tags)),
          imageUrl,
          color: clusterColor,
          size: 18,
        };

        nodes.push(node);
        nodeMap.set(slug, node);
        nodeMap.set(this.slugify(label), node);
        clusters[clusterName]++;

        // Structural connection to the Cluster Hub
        edges.push({
          id: `${rootId}==>${slug}`,
          source: rootId,
          target: slug,
          label: 'belongs_to',
          isStructural: true,
        });
      }
    };

    if (subdirs.length > 0) {
      for (const d of subdirs) {
        processCluster(d.name, path.join(this.vaultDir, d.name));
      }
    } else {
      processCluster('knowledge', this.vaultDir, true);
    }

    // 2. Discover wikilinks edges [[target]] across all nodes
    for (const node of nodes) {
      if (!node.filePath || !fs.existsSync(node.filePath)) continue;
      const rawContent = fs.readFileSync(node.filePath, 'utf-8');
      const wikilinks = Array.from(rawContent.matchAll(/\[\[(.*?)\]\]/g)).map(m => m[1].trim());

      for (const link of wikilinks) {
        const targetSlug = this.slugify(link);
        if (nodeMap.has(targetSlug)) {
          const targetNode = nodeMap.get(targetSlug);
          if (targetNode && targetNode.id !== node.id) {
            const edgeId = `${node.id}-->${targetNode.id}`;
            const reverseEdgeId = `${targetNode.id}-->${node.id}`;

            // Avoid duplicate undirected edges
            const exists = edges.some(e => e.id === edgeId || e.id === reverseEdgeId);
            if (!exists) {
              edges.push({
                id: edgeId,
                source: node.id,
                target: targetNode.id,
                label: 'linked_to',
                isStructural: false,
              });
            }
          }
        }
      }
    }

    return {
      nodes,
      edges,
      stats: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        clusters,
      },
    };
  }
}
