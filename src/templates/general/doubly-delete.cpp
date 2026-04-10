struct Node {
  int data;
  Node *next;
  Node *prev;
};

struct LinkedList {
  Node *head;
  Node *tail;
};

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

void deleteNode(LinkedList *list, int data) {
  Node *curr = list->head;
  while (curr != nullptr) {
    if (curr->data == data) {
      if (curr->prev != nullptr) {
        curr->prev->next = curr->next;
      } else {
        list->head = curr->next;
      }
      if (curr->next != nullptr) {
        curr->next->prev = curr->prev;
      } else {
        list->tail = curr->prev;
      }
      delete curr;
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
  deleteNode(&list, 1);

  return 0;
}
