/**
 * Request signing for the 米游社 / miHoYo APIs.
 *
 * Two schemes are needed:
 *  - `ds`     (web/community):  "{t},{r},{md5('salt=..&t=..&r=..')}"
 *  - `dsX4`   (passport):       "{t},{r},{md5('salt=..&t=..&r=..&b=<body>&q=<query>')}"
 *
 * Salts are bound to the client version the API accepts; when miHoYo ships a
 * client update the old salt starts failing with retcode -500001/-3006 and
 * the constants in api.js must be refreshed.
 */
import { createHash, randomInt } from 'node:crypto'

export function md5(input) {
  return createHash('md5').update(input, 'utf8').digest('hex')
}

function randomToken(length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(0, alphabet.length)]
  return out
}

export function webDs(salt, now = Math.floor(Date.now() / 1000)) {
  const r = randomToken(6)
  return `${now},${r},${md5(`salt=${salt}&t=${now}&r=${r}`)}`
}

export function passportDs(salt, query = '', body = '', now = Math.floor(Date.now() / 1000)) {
  const r = String(randomInt(100000, 200001))
  return `${now},${r},${md5(`salt=${salt}&t=${now}&r=${r}&b=${body}&q=${query}`)}`
}

/** 13 hex chars, the shape the device-fp endpoint issues. */
export function deviceFp() {
  let out = ''
  for (let i = 0; i < 13; i += 1) out += '0123456789abcdef'[randomInt(0, 16)]
  return out
}

export function deviceId() {
  const hex = () => randomInt(0, 0x10000).toString(16).padStart(4, '0')
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${'89ab'[randomInt(0, 4)]}${hex().slice(1)}-${hex()}${hex()}${hex()}`
}
