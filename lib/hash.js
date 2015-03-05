var crypto = require('crypto')

module.exports = function (links, value) {
  return crypto.createHash('sha1')
    .update(links.join(' ') + '\n')
    .update(value)
    .digest('hex')
}
