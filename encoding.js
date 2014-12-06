exports.node = {
  encode: function(val) {
    return new Buffer(JSON.stringify(val))
  },
  decode: function(buf) {
    return JSON.parse(buf.toString())
  }  
}

exports.replicate = {
  encode: function(val) {
    return new Buffer(JSON.stringify(val))
  },
  decode: function(buf) {
    return new Buffer(JSON.parse(val))
  }
}