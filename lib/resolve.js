var debug = require('debug')('hyperlog.resolve')
var through = require('through2')
var pump = require('pump')
var stack = require('./stack')

var noop = function() {}

var split = function(key) {
  key = key.split('!')
  return [key[0], parseInt(key[1], 16), key[2]]
}

var join = function(peer, seq, hash) {
  return peer+'!'+seq.toString(16)+'!'+hash
}

var resolve = function(log, cb) {
  var s = stack()

  var visit = function(ptr, cb) {
    var next = s.iterator(ptr)
    var pushed = 0

    next(function fn(err, key) {
      if (err) return cb(err)
      if (key === null) return cb(null, pushed)
      
      var pair = split(key)
      
      log.deltas.get(pair[0], pair[1], function(err, node) {
        if (err) return cb(err)

        var i = 0
        var loop = function(err) {
          if (err) return cb(err)
          if (i === node.links.length) return next(fn)

          var ln = node.links[i++]
          var pair = split(ln)

          log.graph.get(pair[0], pair[1], function(err) {
            if (!err) return loop() // no err - we already have it

            log.deltas.tail(pair[0], function(err, tail) {
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
    var nodes = log.deltas.nodes(peer, {values:false})

    var onlog = function(data, enc, cb) {
      s.push(join(data.peer, data.seq, ''), function(err) {
        if (err) return cb(err)

        var apply = function() {
          s.pop(function loop(err, key) {
            if (err || !key) return cb(err)

            var pair = split(key)

            debug('applying %s(%d) to the graph', pair[0], pair[1])

            log.deltas.get(pair[0], pair[1], function(err, node) {
              if (err) return cb(err)

              log.commit([{type:'del', key:log.deltas.key(pair[0], pair[1])}], node, function(err) {
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

    pump(nodes, through.obj(onlog), cb)
  }

  pump(log.deltas.peers(), through.obj(onpeer), cb)
}

module.exports = resolve