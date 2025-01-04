let idCounter = 0
const idMap = new WeakMap<Exclude<object, number | boolean>, number>()

export function getObjectId(obj: object): string {
  if (!obj || typeof obj !== 'object') {
    throw new TypeError('Invalid object')
  }

  if (idMap.has(obj)) {
    return `${idMap.get(obj)!}`
  }

  const id = idCounter++
  idMap.set(obj, id)
  return `${id}`
}
