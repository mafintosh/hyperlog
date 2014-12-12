var Duplexify = require('duplexify')
var util = require('util')
var pump = require('pump')
var lpstream = require('length-prefixed-stream')
var through = require('through2')
var messages = require('./messages')

var noobj = {}
var done = new Buffer([3])
var finalize = new Buffer([4])

var Protocol = function() {
  if (!(this instanceof Protocol)) return new Protocol()

  this._encoder = lpstream.encode()
  this._decoder = lpstream.decode()

  var self = this
  var parse = through.obj(function(data, enc, cb) {
    self._decode(data, cb)
  })

  this.on('finish', function() {
    self._encoder.end()
  })

  pump(this._decoder, parse)
  Duplexify.call(this, this._decoder, this._encoder)
}

util.inherits(Protocol, Duplexify)

Protocol.prototype.have = function(have, cb) {
  this._encode(0, messages.Have, have, cb)
}

Protocol.prototype.want = function(want, cb) {
  this._encode(1, messages.Want, want, cb)
}

Protocol.prototype.node = function(node, cb) {
  this._encode(2, messages.Node, node, cb)
}

Protocol.prototype.done = function(cb) {
  this._encoder.write(done, cb)
}

Protocol.prototype.finalize = function(cb) {
  this._encoder.write(finalize, cb)
}

Protocol.prototype._encode = function(type, enc, data, cb) {
  var buf = new Buffer(enc.encodingLength(data)+1)
  buf[0] = type
  enc.encode(data, buf, 1)
  this._encoder.write(buf, cb)
}

Protocol.prototype._decode = function(data, cb) {
  switch (data[0]) {
    case 0: return this.emit('have', messages.Have.decode(data, 1), cb)
    case 1: return this.emit('want', messages.Want.decode(data, 1), cb)
    case 2: return this.emit('node', messages.Node.decode(data, 1), cb)
    case 3: return this.emit('done', cb)
    case 4: return this.emit('finalize', cb)
  }

  cb()
}

module.exports = Protocol
