struct ListNode {
  int data;
  /** @position right @color #4ade80 @style horizontal */
  ListNode *next;
};

void insertBack(ListNode **head, int data) {
  ListNode *node = new ListNode;
  node->data = data;
  node->next = nullptr;

  if (*head == nullptr) {
    *head = node;
    return;
  }

  ListNode *cur = *head;
  while (cur->next != nullptr) {
    cur = cur->next;
  }
  cur->next = node;
}

int main() {
  ListNode *head = nullptr;
  insertBack(&head, 1);
  insertBack(&head, 2);
  insertBack(&head, 3);

  return 0;
}
