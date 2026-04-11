// Malformed tree: manually create a cycle by pointing a child back to an ancestor.
// Demonstrates cycle detection (back-arrow) in the tree layout.
struct TreeNode {
  int data;
  TreeNode *left;
  TreeNode *right;
};

int main() {
  TreeNode *a = new TreeNode;
  a->data = 1;
  a->left = nullptr;
  a->right = nullptr;

  TreeNode *b = new TreeNode;
  b->data = 2;
  b->left = nullptr;
  b->right = nullptr;

  TreeNode *c = new TreeNode;
  c->data = 3;
  c->left = nullptr;
  c->right = nullptr;

  // Build a normal tree: a -> b, a -> c
  a->left = b;
  a->right = c;

  // Introduce a cycle: c's left points back to a
  c->left = a;

  breakpoint();
  return 0;
}
