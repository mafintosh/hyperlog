var duplexify = require('duplexify')
var protobuf = require('protocol-buffers')
var through = require('through2')
var lpstream = require('length-prefixed-stream')
var pump = require('pump')
var messages = require('./messages')

var noop = function() {}

var encoder = function(byte) {
  switch (byte) {
    case 0: return messages.Handshake
    case 1: return messages.Head
    case 2: return messages.Head
    case 3: return messages.Head
    case 4: return messages.Node
    case 5: return messages.Fin
  }

  throw new Error('Unknown byte type: '+byte)  
}

var toByteType = function(type) {
  switch (type) {
    case 'handshake': return 0
    case 'head':      return 1
    case 'want':      return 2
    case 'end':       return 3
    case 'node':      return 4
    case 'fin':       return 5
  }

  return -1
}

var toStringType = function(byte) {
  switch (byte) {
    case 0: return 'handshake'
    case 1: return 'head'
    case 2: return 'want'
    case 3: return 'end'
    case 4: return 'node'
    case 5: return 'fin'
  }

  return null
}

var protocol = function() {
  var incoming = through.obj(function(data, enc, cb) {
    var b = data[0]
    var t = toStringType(b)

    if (!t) return cb(new Error('Unknown byte type: '+b))

    data = encoder(b).decode(data, 1)
    data.type = t

    cb(null, data)
  })

  var outgoing = through.obj(function(data, enc, cb) {
    var t = data.type || 'node'
    var b = toByteType(t)

    if (b < 0) return cb(new Error('Unknown string type '+t))

    var e = encoder(b)
    var len = e.encodingLength(data)+1
    var buf = new Buffer(len)

    buf[0] = b
    cb(null, e.encode(data, buf, 1))
  })

  var dec = lpstream.decode()
  var enc = lpstream.encode()
  var result = duplexify(dec, enc)

  pump(dec, incoming)
  pump(outgoing, enc)

  result.incoming = incoming
  result.outgoing = outgoing

  return result
}

// TODO: completely refactor this
var replicate = function(vector) {  
  var stream = protocol()

  var handshook = false
  var pending = 0
  var wanting = {}
  var fins = 0

  var head = function(peer, cb) {
    vector.graph.head(peer, function(_, a) {
      cb(a || 0)
    })
  }

  var want = function(peer, remote, cb) {
    if (wanting[peer]) return cb()
    wanting[peer] = true
    pending++

    head(peer, function(seq) {
      if (seq >= remote) {
        pending--
        return cb()
      }
      stream.outgoing.write({type:'want', peer:peer, seq:seq})
      cb()
    })
  }

  var fin = function() {
    stream.outgoing.write({type:'fin'})
    onfin(null, noop)
  }

  var onhandshake = function(handshake, cb) {
    handshook = true
    
    var heads = handshake.heads
    var loop = function() {
      if (!heads.length) {
        if (!pending) fin()
        return cb()
      }

      var next = heads.shift()
      want(next.peer, next.seq, loop)
    }

    loop()
  }

  var onwant = function(data, cb) {
    var nodes = vector.graph.nodes(data.peer, {since:data.seq})

    nodes.on('end', function() {
      stream.outgoing.write({type:'end', peer:data.peer, seq:data.seq})
    })

    nodes.pipe(stream.outgoing, {end:false})
    cb()
  }

  var onend = function(data, cb) {
    if (!--pending) fin()
    cb()
  }

  var onfin = function(data, cb) {
    if (++fins < 2) return cb()
    stream.outgoing.end()
    if (cb) cb()
  }

  var ondata = function(data, cb) {
    if (data.type === 'want') return onwant(data, cb)
    if (data.type === 'end') return onend(data, cb)
    if (data.type === 'fin') return onfin(data, cb)

    // TODO: sanity check this inregards to log order etc

    var done = function() {
      var key = vector.deltas.key(data.peer, data.seq)
      var value = vector.deltas.value(data)

      vector.db.put(key, value, cb)
    }

    var i = 0
    var loop = function() {
      if (i >= data.links.length) return done()

      var ln = data.links[i++]
      var peer = ln.slice(0, ln.indexOf('!'))
      var seq = parseInt(ln.slice(peer.length+1, ln.indexOf('!', peer.length+1)), 10)

      want(peer, seq, loop)        
    }

    loop()
  }

  var parse = through.obj(function(data, enc, cb) {
    if (!handshook) onhandshake(data, cb)
    else ondata(data, cb)
  })

  vector.heads(function(err, heads) {
    if (err) return stream.destroy(err)
    stream.outgoing.write({type:'handshake', heads:heads})
    stream.incoming.pipe(parse)
  })

  return stream
}

module.exports = replicate