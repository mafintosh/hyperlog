var debug = require('debug')('vector-logs.resolve')
var through = require('through2')
var encoding = require('./encoding')
var pump = require('pump')

var noop = function() {}

var stack = function(opts) { // TODO: add level swap and move to cache
  var that = {}
  var prev = {}
  var unique = opts && !!opts.unique

  that.top = null

  that.push = function(key, cb) {
    if (Array.isArray(key)) {
      for (var i = 0; i < key.length-1; i++) that.push(key[i])
      key = key[key.length-1]
    }

    if (!cb) cb = noop
    if (prev.hasOwnProperty(key)) return cb()
    prev[key] = that.top
    that.top = key
    cb()
  }

  that.has = function(key, cb) {
    cb(null, !!prev[key])
  }

  that.iterator = function(until) {
    var top = that.top
    return function(cb) {
      if (top === until) return cb(null, null)
      var next = top
      top = prev[next] || null
      cb(null, next)
    }
  }

  that.peek = function(cb) {
    cb(null, that.top)
  }

  that.pop = function(cb) {
    if (!cb) cb = noop
    var popped = that.top    
    that.top = prev[that.top] || null
    delete prev[popped]
    cb(null, popped)
  }

  return that
}

var taker = function(stream) {
  var pending = null

  stream.on('readable', function() {
    if (!pending) return
    var fn = pending
    pending = null
    fn(stream.read())
  })

  return function(cb) {
    if (pending) throw new Error('read in progress')
    var doc = stream.read()
    if (doc) return cb(doc)
    pending = cb
  }
}

var split = function(key) {
  key = key.split('!')
  return [key[0], parseInt(key[1], 16), key[2]]
}

var join = function(peer, seq, hash) {
  return peer+'!'+seq.toString(16)+'!'+hash
}

var resolve = function(logs, cb) {
  var s = stack()

  var visit = function(ptr, cb) {
    var next = s.iterator(ptr)
    var pushed = 0

    next(function fn(err, key) {
      if (err) return cb(err)
      if (key === null) return cb(null, pushed)
      
      var pair = split(key)
      
      logs.deltas.get(pair[0], pair[1], function(err, entry) {
        if (err) return cb(err)

        var node = encoding.node.decode(entry)

        var i = 0
        var loop = function(err) {
          if (err) return cb(err)
          if (i === node.links.length) return next(fn)

          var ln = node.links[i++]
          var pair = split(ln)

          logs.graph.get(pair[0], pair[1], function(err) {
            if (!err) return loop() // no err - we already have it

            logs.deltas.tail(pair[0], function(err, tail) {
              if (err) return cb(err)

              var keys = []
              for (var i = pair[1]; i >= tail; i--) keys.push(join(pair[0], i, ''))
              
              pushed += keys.length
              s.push(keys, loop)
            })
          })
        }

        loop(null)
      })
    })
  }

  var onpeer = function(peer, enc, cb) {
    var entries = logs.deltas.entries(peer)

    var onlog = function(data, enc, cb) {
      s.push(join(data.peer, data.seq, ''), function(err) {
        if (err) return cb(err)

        var apply = function() {
          s.pop(function loop(err, key) {
            if (err || !key) return cb(err)

            var pair = split(key)
            key = logs.deltas.key(pair[0], pair[1])

            debug('applying %s(%d) to the graph', pair[0], pair[1])

            logs.db.get(key, {valueEncoding:'binary'}, function(err, val) {
              if (err) return cb(err)

              var node = encoding.node.decode(val)
              logs.commit([{type:'del', key:key}], node, function(err) {
                if (err) return cb(err)
                s.pop(loop)
              })
            })
          })
        }

        var loop = function(ptr) {
          var top = s.top
          visit(ptr, function(err, pushed) {
            if (err) return cb(err)
            if (!pushed) return apply()
            loop(top)
          })
        }

        loop(null)
      })
    }

    pump(entries, through.obj(onlog), cb)
  }

  pump(logs.deltas.peers(), through.obj(onpeer), cb)
}

module.exports = resolve