struct Node {
  int data;
  Node *next;
  Node *prev;
};

struct LinkedList {
  Node *head;
  Node *tail;
};

void insertFront(LinkedList *list, int data) {
  Node *newNode = new Node;
  newNode->data = data;
  newNode->next = list->head;
  newNode->prev = nullptr;

  if (list->head != nullptr) {
    list->head->prev = newNode;
  } else {
    list->tail = newNode;
  }
  list->head = newNode;
}

int main() {
  LinkedList list;
  insertFront(&list, 3);
  insertFront(&list, 2);
  insertFront(&list, 1);

  return 0;
}
