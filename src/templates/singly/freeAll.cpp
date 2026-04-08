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

void freeAll(LinkedList *list) {
  Node *curr = list->head;
  while (curr != nullptr) {
    Node *next = curr->next;
    delete curr;
    curr = next;
  }
  list->head = nullptr;
}

int main() {
  LinkedList list;
  insertBack(&list, 10);
  insertBack(&list, 20);
  insertBack(&list, 30);
  freeAll(&list);

  return 0;
}
