// Doubly linked list using @position annotations for arrow direction.
// Uses ListNode (not Node) to avoid the LinkedListChain special-case renderer
// and demonstrate the generic tree placement + arrow system.
struct ListNode {
  int data;
  /** @position right */
  ListNode *next;
  /** @position left */
  ListNode *prev;
};

void insertBack(ListNode **head, int data) {
  ListNode *node = new ListNode;
  node->data = data;
  node->next = nullptr;
  node->prev = nullptr;

  if (*head == nullptr) {
    *head = node;
    return;
  }

  ListNode *cur = *head;
  while (cur->next != nullptr) {
    cur = cur->next;
  }
  cur->next = node;
  node->prev = cur;
}

int main() {
  ListNode *head = nullptr;
  insertBack(&head, 1);
  insertBack(&head, 2);
  insertBack(&head, 3);

  return 0;
}
