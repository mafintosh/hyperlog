var indexOf = function(list, sort){
  var low = 0
  var high = list.length
  var mid = 0

  while (low < high) {
    mid = (low + high) >> 1
    if (sort < list[mid].sort) high = mid
    else low = mid + 1
  }

  return low
}

var noop = function() {}

module.exports = function(logs, opts) {
  if (!opts) opts = {}

  var that = {}
  var next = []
  var ranges = {}
  var cache = []

  var waitLog = null
  var waitCb = null
  var toRemove = null

  var push = function(log, cb) {
    var range = ranges[log]
    if (!range || range[0] > range[1]) return cb()

    logs.get(log, range[0], function(err, node) {
      if (err && !err.notFound) return cb(err)

      if (err) {
        waitLog = log
        waitCb = cb
        return
      }

      range[0]++
      cache.splice(indexOf(cache, node.sort), 0, node)
      cb()
    })
  }

  var update = function(log) {
    if (log !== waitLog) return
    var cb = waitCb
    waitLog = null
    waitCb = null
    push(log, cb)
  }

  that.shift = function(cb) {
    var loop = function(err) {
      if (err) return cb(err)
      if (next.length) {
        push(next.shift(), loop)
        return
      }

      var node = cache.length ? cache.shift() : null
      if (!node) return cb(null, null)
      next.push(node.log)
      if (opts.remove) toRemove = node
      cb(null, node)
    }

    if (!toRemove) return loop()

    logs.db.del(logs.key(toRemove.log, toRemove.seq), function(err) {
      if (err) return cb(err)
      loop()
    })
  }

  that.push = function(node, cb) {
    if (!cb) cb = noop
    var key = logs.key(node.log, node.seq)
    var value = logs.value(node)
    logs.db.put(key, value, function(err) {
      if (err) return cb(err)
      update(node.log)
      cb()
    })
  }

  that.want = function(log, from, to, cb) {
    var inserted = !ranges[log]
    var prevFrom = inserted ? 0 : ranges[log][0]
    var prevTo = inserted ? 0 : ranges[log][1]
    var add = inserted || ranges[log][0] > ranges[log][1]

    ranges[log] = [Math.max(from, prevFrom), Math.max(to, prevTo)]

    if (add) {
      next.push(log)
      update(log)
    }

    if (cb) cb(null, inserted)
  }

  return that
}