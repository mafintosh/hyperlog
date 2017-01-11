var protobuf = require('protocol-buffers')
var fs = require('fs')
var path = require('path')

module.exports = protobuf(fs.readFileSync(path.join(__dirname, '..', 'schema.proto'), 'utf-8'))
