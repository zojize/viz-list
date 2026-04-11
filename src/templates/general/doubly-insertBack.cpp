// Doubly linked list using @arrow-position annotations for arrow direction.
// Uses ListNode (not Node) to avoid the LinkedListChain special-case renderer
// and demonstrate the generic tree placement + arrow system.
/** @arrow-anchor closest @arrow-size 30 */
struct ListNode {
  int data;
  /**
   * @arrow-position right
   * @arrow-color #4ade80
   * @arrow-style horizontal
   *
   */
  ListNode *next;
  /**
   * @arrow-position left
   * @arrow-color #fb923c
   * @arrow-style horizontal
   *
   */
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
