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

void deleteNode(LinkedList *list, int data) {
  if (list->head == nullptr) {
    return;
  }

  if (list->head->data == data) {
    Node *temp = list->head;
    list->head = list->head->next;
    delete temp;
    return;
  }

  Node *curr = list->head;
  while (curr->next != nullptr) {
    if (curr->next->data == data) {
      Node *temp = curr->next;
      curr->next = curr->next->next;
      delete temp;
      return;
    }
    curr = curr->next;
  }
}

int main() {
  LinkedList list;
  insertBack(&list, 1);
  insertBack(&list, 2);
  insertBack(&list, 3);
  insertBack(&list, 4);
  deleteNode(&list, 3);

  return 0;
}
