var Duplexify = require('duplexify')
var util = require('util')
var lpstream = require('length-prefixed-stream')
var through = require('through2')
var debug = require('debug')('hyperlog-replicate')
var messages = require('./messages')

var empty = {
  encodingLength: function () {
    return 0
  },
  encode: function (data, buf, offset) {
    return buf
  }
}

var Protocol = function (opts) {
  if (!(this instanceof Protocol)) return new Protocol(opts)

  var frame = !opts || opts.frame !== false

  this._encoder = frame ? lpstream.encode() : through.obj()
  this._decoder = frame ? lpstream.decode() : through.obj()
  this._finalize = opts.finalize ? opts.finalize : function (cb) { cb() }
  this._process = opts.process || null

  var self = this
  var parse = through.obj(function (data, enc, cb) {
    self._decode(data, cb)
  })

  parse.on('error', function (err) {
    self.destroy(err)
  })

  this.on('end', function () {
    debug('ended')
    self.end()
  })

  this.on('finish', function () {
    debug('finished')
    self.finalize()
  })

  this._decoder.pipe(parse)

  if (this._process) {
    this._process.pipe(through.obj(function (node, enc, cb) {
      self.emit('node', node, cb) || cb()
    }))
  }

  var hwm = opts.highWaterMark || 16
  Duplexify.call(this, this._decoder, this._encoder, frame ? {} : {objectMode: true, highWaterMark: hwm})
}

util.inherits(Protocol, Duplexify)

Protocol.prototype.handshake = function (handshake, cb) {
  debug('sending handshake')
  this._encode(0, messages.Handshake, handshake, cb)
}

Protocol.prototype.have = function (have, cb) {
  debug('sending have')
  this._encode(1, messages.Log, have, cb)
}

Protocol.prototype.want = function (want, cb) {
  debug('sending want')
  this._encode(2, messages.Log, want, cb)
}

Protocol.prototype.node = function (node, cb) {
  debug('sending node')
  this._encode(3, messages.Node, node, cb)
}

Protocol.prototype.sentHeads = function (cb) {
  debug('sending sentHeads')
  this._encode(4, empty, null, cb)
}

Protocol.prototype.sentWants = function (cb) {
  debug('sending sentWants')
  this._encode(5, empty, null, cb)
}

Protocol.prototype.finalize = function (cb) {
  var self = this
  this._finalize(function (err) {
    debug('ending')
    if (err) return self.destroy(err)
    self._encoder.end(cb)
  })
}

Protocol.prototype._encode = function (type, enc, data, cb) {
  var buf = new Buffer(enc.encodingLength(data) + 1)
  buf[0] = type
  enc.encode(data, buf, 1)
  this._encoder.write(buf, cb)
}

var decodeMessage = function (data) {
  switch (data[0]) {
    case 0: return messages.Handshake.decode(data, 1)
    case 1: return messages.Log.decode(data, 1)
    case 2: return messages.Log.decode(data, 1)
    case 3: return messages.Node.decode(data, 1)
  }
  return null
}

Protocol.prototype._decode = function (data, cb) {
  try {
    var msg = decodeMessage(data)
  } catch (err) {
    return cb(err)
  }

  switch (data[0]) {
    case 0:
    debug('receiving handshake')
    return this.emit('handshake', msg, cb) || cb()

    case 1:
    debug('receiving have')
    return this.emit('have', msg, cb) || cb()

    case 2:
    debug('receiving want')
    return this.emit('want', msg, cb) || cb()

    case 3:
    debug('receiving node')
    return this._process ? this._process.write(msg, cb) : (this.emit('node', msg, cb) || cb())

    case 4:
    debug('receiving sentHeads')
    return this.emit('sentHeads', cb) || cb()

    case 5:
    debug('receiving sentWants')
    return this.emit('sentWants', cb) || cb()
  }

  cb()
}

module.exports = Protocol
