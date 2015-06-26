exports.encode = function (value, enc) {
  if (typeof enc === 'object' && enc.encode) {
    value = enc.encode(value)
  } else if (enc === 'json') {
    value = Buffer(JSON.stringify(value))
  }
  if (typeof value === 'string') value = new Buffer(value)
  return value
}

exports.decode = function (value, enc) {
  if (typeof enc === 'object' && enc.decode) {
    return enc.decode(value)
  } else if (enc === 'json') {
    return JSON.parse(value.toString())
  }
  return value
}
