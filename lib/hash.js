var framedHash = require('framed-hash')
var empty = new Buffer(0)

module.exports = function (links, value) {
  var hash = framedHash('sha256')
  for (var i = 0; i < links.length; i++) hash.update(links[i])
  hash.update(value || empty)
  return hash.digest('hex')
}
