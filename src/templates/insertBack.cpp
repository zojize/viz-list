void insertBack(LinkedList *list, int data) {
  Node *newNode = new Node;
  newNode->data = data;
  newNode->next = nullptr;
  newNode->prev = list->tail;
  list->tail = newNode;

  if (list->head == nullptr) {
    list->head = newNode;
    return;
  }

  Node *temp = list->head;
  while (temp->next != nullptr) {
    temp = temp->next;
  }

  temp->next = newNode;
}

int main() {
  LinkedList list;
  insertBack(&list, 1);
  insertBack(&list, 2);
  insertBack(&list, 3);

  LinkedList list2;
  insertBack(&list2, 1);
  insertBack(&list2, 2);
  insertBack(&list2, 3);

  return 0;
}
