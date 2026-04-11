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

TreeNode *findMin(TreeNode *node) {
  while (node->left != nullptr) {
    node = node->left;
  }
  return node;
}

TreeNode *deleteNode(TreeNode *root, int data) {
  if (root == nullptr) {
    return nullptr;
  }
  if (data < root->data) {
    root->left = deleteNode(root->left, data);
  } else if (data > root->data) {
    root->right = deleteNode(root->right, data);
  } else {
    // Found the node to delete
    if (root->left == nullptr) {
      TreeNode *temp = root->right;
      delete root;
      return temp;
    }
    if (root->right == nullptr) {
      TreeNode *temp = root->left;
      delete root;
      return temp;
    }
    // Two children: replace with inorder successor
    TreeNode *successor = findMin(root->right);
    root->data = successor->data;
    root->right = deleteNode(root->right, successor->data);
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
  root = insert(root, 6);

  // Delete leaf node
  root = deleteNode(root, 1);
  // Delete node with one child
  root = deleteNode(root, 3);
  // Delete node with two children
  root = deleteNode(root, 5);

  breakpoint();
  return 0;
}
