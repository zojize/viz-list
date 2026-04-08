void insertFront(LinkedList *list, int data) {
  Node *newNode = new Node;
  newNode->data = data;
  newNode->next = list->head;
  newNode->prev = nullptr;

  if (list->head != nullptr) {
    list->head->prev = newNode;
  }

  list->head = newNode;

  if (list->tail == nullptr) {
    list->tail = newNode;
  }
}

int main() {
  LinkedList list;
  insertFront(&list, 3);
  insertFront(&list, 2);
  insertFront(&list, 1);

  return 0;
}
