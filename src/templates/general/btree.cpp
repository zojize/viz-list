// Simple B-tree (order 3) constructed manually.
// Each node has up to 2 keys and 3 children.
struct BTreeNode {
  int numKeys;
  int keys[3];
  BTreeNode *children[4];
};

int main() {
  // Root: keys [10, 20]
  BTreeNode *root = new BTreeNode;
  root->numKeys = 2;
  root->keys[0] = 10;
  root->keys[1] = 20;
  root->keys[2] = 0;

  // Left child: keys [3, 7]
  BTreeNode *left = new BTreeNode;
  left->numKeys = 2;
  left->keys[0] = 3;
  left->keys[1] = 7;
  left->keys[2] = 0;
  left->children[0] = nullptr;
  left->children[1] = nullptr;
  left->children[2] = nullptr;
  left->children[3] = nullptr;

  // Middle child: keys [14]
  BTreeNode *mid = new BTreeNode;
  mid->numKeys = 1;
  mid->keys[0] = 14;
  mid->keys[1] = 0;
  mid->keys[2] = 0;
  mid->children[0] = nullptr;
  mid->children[1] = nullptr;
  mid->children[2] = nullptr;
  mid->children[3] = nullptr;

  // Right child: keys [25, 30]
  BTreeNode *right = new BTreeNode;
  right->numKeys = 2;
  right->keys[0] = 25;
  right->keys[1] = 30;
  right->keys[2] = 0;
  right->children[0] = nullptr;
  right->children[1] = nullptr;
  right->children[2] = nullptr;
  right->children[3] = nullptr;

  // Wire up root's children
  root->children[0] = left;
  root->children[1] = mid;
  root->children[2] = right;
  root->children[3] = nullptr;

  return 0;
}
