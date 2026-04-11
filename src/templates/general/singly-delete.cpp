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

void deleteNode(ListNode **head, int data) {
  if (*head == nullptr) {
    return;
  }

  if ((*head)->data == data) {
    ListNode *temp = *head;
    *head = (*head)->next;
    delete temp;
    return;
  }

  ListNode *curr = *head;
  while (curr->next != nullptr) {
    if (curr->next->data == data) {
      ListNode *temp = curr->next;
      curr->next = curr->next->next;
      delete temp;
      return;
    }
    curr = curr->next;
  }
}

int main() {
  ListNode *head = nullptr;
  insertBack(&head, 1);
  insertBack(&head, 2);
  insertBack(&head, 3);
  insertBack(&head, 4);
  deleteNode(&head, 3);

  return 0;
}
