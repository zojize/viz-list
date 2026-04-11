// Malformed tree: delete a middle node without updating parent pointers.
// Demonstrates dangling pointer arrows (dashed red) in the visualization.
struct TreeNode {
  int data;
  TreeNode *left;
  TreeNode *right;
};

int main() {
  TreeNode *root = new TreeNode;
  root->data = 10;
  root->left = nullptr;
  root->right = nullptr;

  TreeNode *left = new TreeNode;
  left->data = 5;
  left->left = nullptr;
  left->right = nullptr;

  TreeNode *right = new TreeNode;
  right->data = 15;
  right->left = nullptr;
  right->right = nullptr;

  TreeNode *leftLeft = new TreeNode;
  leftLeft->data = 2;
  leftLeft->left = nullptr;
  leftLeft->right = nullptr;

  // Build tree
  root->left = left;
  root->right = right;
  left->left = leftLeft;

  // Bug: free a middle node without updating parent pointer.
  // root->left still points to the freed address.
  delete left;

  breakpoint();
  return 0;
}
