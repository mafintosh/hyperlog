var indexOf = function (list, change) {
  var low = 0
  var high = list.length
  var mid = 0

  while (low < high) {
    mid = (low + high) >> 1
    if (change < list[mid].change) high = mid
    else low = mid + 1
  }

  return low
}

var SortedQueue = function () { // TODO: buffer to leveldb if the queue becomes large
  if (!(this instanceof SortedQueue)) return new SortedQueue()
  this.list = []
  this.wait = null
  this.length = 0
}

SortedQueue.prototype.push = function (entry, cb) {
  var i = indexOf(this.list, entry.change)
  if (i === this.list.length) this.list.push(entry)
  else this.list.splice(i, 0, entry)
  this.length++

  if (this.wait) this.pull(this.wait)
  if (cb) cb()
}

SortedQueue.prototype.pull = function (cb) {
  if (!this.list.length) {
    this.wait = cb
    return
  }

  this.wait = null

  var next = this.list.shift()
  this.length--

  cb(next)
}

module.exports = SortedQueue
