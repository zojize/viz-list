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

void freeAll(LinkedList *list) {
  Node *curr = list->head;
  while (curr != nullptr) {
    Node *next = curr->next;
    delete curr;
    curr = next;
  }
  list->head = nullptr;
  list->tail = nullptr;
}

int main() {
  LinkedList list;
  insertBack(&list, 10);
  insertBack(&list, 20);
  insertBack(&list, 30);
  freeAll(&list);

  return 0;
}
