var lexint = require('lexicographic-integer')

exports.decode = function(key) {
  var parts = key.split('!')
  parts[1] = lexint.unpack(parts[1], 'hex')
  return parts
}

exports.encode = function(peer, seq, hash) {
  return peer+'!'+lexint.pack(seq, 'hex')+'!'+(hash || '')
}