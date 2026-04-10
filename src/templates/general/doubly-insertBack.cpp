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

int main() {
  LinkedList list;
  insertBack(&list, 1);
  insertBack(&list, 2);
  insertBack(&list, 3);

  return 0;
}
