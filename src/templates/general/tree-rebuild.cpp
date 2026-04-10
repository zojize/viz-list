// Build a tree, then restructure it by moving subtrees.
// Demonstrates re-placement when parent pointers change.
struct TreeNode {
  int data;
  TreeNode *left;
  TreeNode *right;
};

TreeNode *newNode(int data) {
  TreeNode *node = new TreeNode;
  node->data = data;
  node->left = nullptr;
  node->right = nullptr;
  return node;
}

int main() {
  // Build initial tree:  1
  //                     / \
  //                    2   3
  //                   /
  //                  4
  TreeNode *root = newNode(1);
  root->left = newNode(2);
  root->right = newNode(3);
  root->left->left = newNode(4);

  // Move subtree: detach node 2 from left, reattach as right child of 3
  TreeNode *detached = root->left;
  root->left = nullptr;
  root->right->right = detached;

  return 0;
}
