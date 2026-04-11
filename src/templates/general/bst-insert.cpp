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

TreeNode *insert(TreeNode *root, int data) {
  if (root == nullptr) {
    return newNode(data);
  }
  if (data < root->data) {
    root->left = insert(root->left, data);
  } else {
    root->right = insert(root->right, data);
  }
  return root;
}

int main() {
  TreeNode *root = nullptr;
  root = insert(root, 5);
  root = insert(root, 3);
  root = insert(root, 7);
  root = insert(root, 1);
  root = insert(root, 4);

  breakpoint();
  return 0;
}
