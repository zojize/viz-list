// Bubble sort on a small integer array.
// Demonstrates array visualization with in-place swapping.
int main() {
  int arr[6];
  arr[0] = 5;
  arr[1] = 3;
  arr[2] = 8;
  arr[3] = 1;
  arr[4] = 4;
  arr[5] = 2;

  int n = 6;
  int i = 0;
  while (i < n - 1) {
    int j = 0;
    while (j < n - 1 - i) {
      if (arr[j] > arr[j + 1]) {
        int temp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = temp;
      }
      j = j + 1;
    }
    i = i + 1;
  }

  return 0;
}
