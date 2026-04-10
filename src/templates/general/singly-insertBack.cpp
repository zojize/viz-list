struct Node {
  int data;
  Node *next;
};

struct LinkedList {
  Node *head;
};

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

  return 0;
}
