var noop = function() {}

var Stack = function(db) {
  if (!(this instanceof Stack)) return new Stack(db)
  this.db = db
  this.top = null
  this.cache = {}
}

Stack.prototype.push = function(keys, cb) {
  if (!Array.isArray(keys)) keys = [keys]
  if (!cb) cb = noop

  for (var i = 0; i < keys.length; i++) {
    if (this.cache.hasOwnProperty(keys[i])) continue
    this.cache[keys[i]] = this.top
    this.top = keys[i]
  }

  cb()
}

Stack.prototype.iterator = function(until) {
  var self = this
  var top = this.top
  return function(cb) {
    if (top === until) return cb(null, null)
    var next = top
    top = self.cache[next] || null
    cb(null, next)
  }
}

Stack.prototype.pop = function(cb) {
  if (!cb) cb = noop
  var popped = this.top    
  this.top = this.cache[this.top] || null
  delete this.cache[popped]
  cb(null, popped)
}

module.exports = Stack