void insertBack(LinkedList *list, int data) {
  Node *newNode = new Node;
  newNode->data = data;
  newNode->next = nullptr;

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
  insertBack(&list, 4);

  // Create a loop: last node points back to second node
  Node *last = list.head;
  while (last->next != nullptr) {
    last = last->next;
  }
  last->next = list.head->next;

  return 0;
}
