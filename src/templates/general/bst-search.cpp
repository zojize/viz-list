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

TreeNode *search(TreeNode *root, int data) {
  if (root == nullptr) {
    return nullptr;
  }
  if (data == root->data) {
    return root;
  }
  if (data < root->data) {
    return search(root->left, data);
  }
  return search(root->right, data);
}

int main() {
  TreeNode *root = nullptr;
  root = insert(root, 5);
  root = insert(root, 3);
  root = insert(root, 7);
  root = insert(root, 1);
  root = insert(root, 4);

  TreeNode *found = search(root, 4);
  TreeNode *notFound = search(root, 6);

  breakpoint();
  return 0;
}
