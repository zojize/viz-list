struct Node {
  int data;
  Node *next;
};

struct LinkedList {
  Node *head;
};

void insertFront(LinkedList *list, int data) {
  Node *newNode = new Node;
  newNode->data = data;
  newNode->next = list->head;
  list->head = newNode;
}

int main() {
  LinkedList list;
  insertFront(&list, 3);
  insertFront(&list, 2);
  insertFront(&list, 1);

  return 0;
}
