struct ListNode {
  int data;
  /** @position right @color #4ade80 @style horizontal */
  ListNode *next;
};

void insertFront(ListNode **head, int data) {
  ListNode *node = new ListNode;
  node->data = data;
  node->next = *head;
  *head = node;
}

int main() {
  ListNode *head = nullptr;
  insertFront(&head, 3);
  insertFront(&head, 2);
  insertFront(&head, 1);

  return 0;
}
