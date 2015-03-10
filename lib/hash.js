var crypto = require('crypto')

module.exports = function (links, value) {
  return crypto.createHash('sha256')
    .update(links.join(' ') + '\n')
    .update(value)
    .digest('hex')
}
