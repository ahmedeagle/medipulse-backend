/**
 * Dependency-free Isolation Forest (Liu, Ting & Zhou, 2008).
 *
 * Unsupervised anomaly scoring for small tabular feature matrices. Used to
 * surface POS shifts whose behavioural profile deviates from a cashier's own
 * recent history — complementing (never replacing) the fixed-threshold cash /
 * refund rules. It only produces a 0..1 score; the caller decides what to do
 * with it (here: raise a review flag, never block an operation).
 *
 * score → 1  : strong anomaly (isolated quickly / short path length)
 * score ≈ 0.5: indistinguishable from normal
 * score < 0.5: very normal
 */

const EULER = 0.5772156649015329;

/** Average path length of an unsuccessful BST search over n points. */
function cFactor(n: number): number {
  if (n <= 1) return 0;
  return 2 * (Math.log(n - 1) + EULER) - (2 * (n - 1)) / n;
}

interface INode {
  // Internal node
  splitFeature?: number;
  splitValue?: number;
  left?: INode;
  right?: INode;
  // External (leaf) node
  size?: number;
}

class ITree {
  private root: INode;
  private readonly heightLimit: number;

  constructor(data: number[][], heightLimit: number) {
    this.heightLimit = heightLimit;
    this.root = this.build(data, 0);
  }

  private build(data: number[][], depth: number): INode {
    if (depth >= this.heightLimit || data.length <= 1) {
      return { size: data.length };
    }
    const dims = data[0].length;
    const feature = Math.floor(Math.random() * dims);

    let min = Infinity;
    let max = -Infinity;
    for (const row of data) {
      const v = row[feature];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === max) {
      return { size: data.length };
    }

    const splitValue = min + Math.random() * (max - min);
    const left: number[][] = [];
    const right: number[][] = [];
    for (const row of data) {
      (row[feature] < splitValue ? left : right).push(row);
    }

    return {
      splitFeature: feature,
      splitValue,
      left: this.build(left, depth + 1),
      right: this.build(right, depth + 1),
    };
  }

  /** Path length for a point, with the standard external-node adjustment. */
  pathLength(point: number[]): number {
    let node = this.root;
    let depth = 0;
    while (node.splitFeature !== undefined) {
      node = point[node.splitFeature] < (node.splitValue as number)
        ? (node.left as INode)
        : (node.right as INode);
      depth++;
    }
    return depth + cFactor(node.size ?? 1);
  }
}

export class IsolationForest {
  private trees: ITree[] = [];
  private c = 0;

  constructor(
    private readonly numTrees = 100,
    private readonly sampleSize = 256,
  ) {}

  /** Fit on a baseline feature matrix. No-op safety if data is too small. */
  fit(data: number[][]): this {
    this.trees = [];
    if (!data || data.length === 0) return this;

    const psi = Math.min(this.sampleSize, data.length);
    this.c = cFactor(psi);
    const heightLimit = Math.ceil(Math.log2(Math.max(2, psi)));

    for (let t = 0; t < this.numTrees; t++) {
      this.trees.push(new ITree(this.subsample(data, psi), heightLimit));
    }
    return this;
  }

  /** Anomaly score in [0..1]; higher = more anomalous. */
  score(point: number[]): number {
    if (this.trees.length === 0 || this.c === 0) return 0;
    let sum = 0;
    for (const tree of this.trees) sum += tree.pathLength(point);
    const avg = sum / this.trees.length;
    return Math.pow(2, -avg / this.c);
  }

  private subsample(data: number[][], psi: number): number[][] {
    if (psi >= data.length) return data;
    // Reservoir-free random sample (Fisher–Yates on indices).
    const idx = Array.from({ length: data.length }, (_, i) => i);
    for (let i = data.length - 1; i > data.length - 1 - psi; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx.slice(data.length - psi).map((i) => data[i]);
  }
}
