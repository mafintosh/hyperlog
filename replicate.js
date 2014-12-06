var duplexify = require('duplexify')
var through = require('through2')
var encoding = require('./encoding')

var noop = function() {}

var replicate = function(logs) {  
  var self = logs // yolo
  var handshook = false
  var wanting = {}
  var done = {}
  var fins = 0

  var head = function(peer, cb) {
    self.graph.head(peer, function(_, a) {
      cb(a || 0)
    })
  }

  var want = function(peer, remote, cb) {
    if (wanting[peer] || done[peer]) return cb()
    wanting[peer] = true

    head(peer, function(seq) {
      if (seq >= remote) return cb()
      out.write({type:'want', peer:peer, seq:seq})
      cb()
    })
  }

  var fin = function() {
    out.write({type:'fin'})
    onfin(null, noop)
  }

  var onhandshake = function(handshake, cb) {
    handshook = true
    
    var loop = function() {
      if (!handshake.length) {
        if (!Object.keys(wanting).length) fin()
        return cb()
      }

      var next = handshake.shift()
      want(next.peer, next.seq, loop)
    }

    loop()
  }

  var onwant = function(data, cb) {
    var entries = self.graph.entries(data.peer, {since:data.seq})

    entries.on('end', function() {
      out.write({type:'end', peer:data.peer})
    })

    entries.pipe(out, {end:false})
    cb()
  }

  var onend = function(data, cb) {
    done[data.peer] = true
    delete wanting[data.peer]
    if (!Object.keys(wanting).length) fin()
    cb()
  }

  var onfin = function(data, cb) {
    if (++fins < 2) return cb()
    out.end()
    inc.end()
    if (cb) cb()
  }

  var ondata = function(data, cb) {
    if (data.type === 'want') return onwant(data, cb)
    if (data.type === 'end') return onend(data, cb)
    if (data.type === 'fin') return onfin(data, cb)

    var node = encoding.node.decode(data.value)

    var done = function() {
      self.deltas.put(data.peer, data.seq, data.value, cb)
    }

    var i = 0
    var loop = function() {
      if (i >= node.links.length) return done()

      var ln = node.links[i++]
      var peer = ln.slice(0, ln.indexOf('!'))
      var seq = parseInt(ln.slice(peer.length+1, ln.indexOf('!', peer.length+1)), 10)

      want(peer, seq, loop)        
    }

    loop()
  }

  var out = through.obj()
  var inc = through.obj(function(data, enc, cb) {
    if (!handshook) onhandshake(data, cb)
    else ondata(data, cb)
  })

  var stream = duplexify.obj()

  stream.setReadable(out)
  logs.heads(function(err, heads) {
    if (err) return stream.destroy(err)
    out.write(heads)
    stream.setWritable(inc)
  })

  return stream
}

module.exports = replicate