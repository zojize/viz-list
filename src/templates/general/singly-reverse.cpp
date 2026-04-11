/** @arrow-anchor closest @arrow-size 30 */
struct ListNode {
  int data;
  /** @arrow-position right @arrow-color #4ade80 @arrow-style horizontal */
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

void reverse(ListNode **head) {
  ListNode *prev = nullptr;
  ListNode *current = *head;
  ListNode *next = nullptr;

  while (current != nullptr) {
    next = current->next;
    current->next = prev;
    prev = current;
    current = next;
  }

  *head = prev;
}

int main() {
  ListNode *head = nullptr;
  insertBack(&head, 1);
  insertBack(&head, 2);
  insertBack(&head, 3);
  insertBack(&head, 4);
  insertBack(&head, 5);
  reverse(&head);

  breakpoint();
  return 0;
}
