/** @arrow-anchor closest @arrow-size 30 */
struct ListNode {
  int data;
  /** @arrow-position right @arrow-color #4ade80 @arrow-style horizontal @arrow-fallback-style orthogonal */
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

void freeAll(ListNode **head) {
  ListNode *curr = *head;
  while (curr != nullptr) {
    ListNode *next = curr->next;
    delete curr;
    curr = next;
  }
  *head = nullptr;
}

int main() {
  ListNode *head = nullptr;
  insertBack(&head, 10);
  insertBack(&head, 20);
  insertBack(&head, 30);
  freeAll(&head);

  return 0;
}
