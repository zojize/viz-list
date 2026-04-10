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

void reverse(LinkedList *list) {
  Node *temp = nullptr;
  Node *current = list->head;

  while (current != nullptr) {
    temp = current->prev;
    current->prev = current->next;
    current->next = temp;
    current = current->prev;
  }

  list->tail = list->head;
  if (temp != nullptr) {
    list->head = temp->prev;
  }
}

int main() {
  LinkedList list;
  insertBack(&list, 1);
  insertBack(&list, 2);
  insertBack(&list, 3);
  insertBack(&list, 4);
  insertBack(&list, 5);
  reverse(&list);

  return 0;
}
