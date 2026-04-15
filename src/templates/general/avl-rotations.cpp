// AVL tree insert with all four rotation cases.
// Insertions are chosen to trigger LL, RR, RL, LR in order.
struct TreeNode {
  int data;
  int height;
  TreeNode *left;
  TreeNode *right;
};

TreeNode *newNode(int data) {
  TreeNode *node = new TreeNode;
  node->data = data;
  node->height = 1;
  node->left = nullptr;
  node->right = nullptr;
  return node;
}

int height(TreeNode *node) {
  if (node == nullptr) {
    return 0;
  }
  return node->height;
}

int max(int a, int b) {
  return (a > b) ? a : b;
}

int balanceFactor(TreeNode *node) {
  if (node == nullptr) {
    return 0;
  }
  return height(node->left) - height(node->right);
}

TreeNode *rotateRight(TreeNode *y) {
  TreeNode *x = y->left;
  TreeNode *t = x->right;
  x->right = y;
  y->left = t;
  y->height = 1 + max(height(y->left), height(y->right));
  x->height = 1 + max(height(x->left), height(x->right));
  return x;
}

TreeNode *rotateLeft(TreeNode *x) {
  TreeNode *y = x->right;
  TreeNode *t = y->left;
  y->left = x;
  x->right = t;
  x->height = 1 + max(height(x->left), height(x->right));
  y->height = 1 + max(height(y->left), height(y->right));
  return y;
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

  root->height = 1 + max(height(root->left), height(root->right));

  int bf = balanceFactor(root);

  // LL: left-left heavy, single right rotation
  if (bf > 1 && data < root->left->data) {
    return rotateRight(root);
  }
  // RR: right-right heavy, single left rotation
  if (bf < -1 && data > root->right->data) {
    return rotateLeft(root);
  }
  // LR: left-right heavy, left then right
  if (bf > 1 && data > root->left->data) {
    root->left = rotateLeft(root->left);
    return rotateRight(root);
  }
  // RL: right-left heavy, right then left
  if (bf < -1 && data < root->right->data) {
    root->right = rotateRight(root->right);
    return rotateLeft(root);
  }

  return root;
}

int main() {
  TreeNode *root = nullptr;

  // LL rotation at 30 -> root becomes 20
  root = insert(root, 30);
  root = insert(root, 20);
  root = insert(root, 10);
  breakpoint();

  // RR rotation at 30 -> 40 lifts above 30, 50
  root = insert(root, 40);
  root = insert(root, 50);
  breakpoint();

  // RL rotation at 20 (rotate right at 40, then left at 20)
  root = insert(root, 25);
  breakpoint();

  // LR rotation at 10 (rotate left at 5, then right at 10)
  root = insert(root, 5);
  root = insert(root, 7);
  breakpoint();

  return 0;
}
