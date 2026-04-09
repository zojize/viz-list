void insertBack(LinkedList *list, int data) {
  Node *newNode = new Node;
  newNode->data = data;
  newNode->next = nullptr;
  newNode->prev = list->tail;

  if (list->head == nullptr) {
    list->head = newNode;
    list->tail = newNode;
    return;
  }

  list->tail->next = newNode;
  list->tail = newNode;
}

int main() {
  LinkedList list;
  insertBack(&list, 1);
  insertBack(&list, 2);
  insertBack(&list, 3);
  insertBack(&list, 4);

  // Create a loop: last node's next points back to second node
  list.tail->next = list.head->next;
  list.head->next->prev = list.tail;

  return 0;
}
