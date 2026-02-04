/*! zip64. MIT License. Jimmy Wärting <https://jimmy.warting.se/opensource> */

const ERR_BAD_FORMAT = 'File format is not recognized.'
const ZIP_COMMENT_MAX = 65536
const EOCDR_MIN = 22
const EOCDR_MAX = EOCDR_MIN + ZIP_COMMENT_MAX
const MAX_VALUE_32BITS = 0xffffffff

const decoder = new TextDecoder()
const uint16e = (b, n) => b[n] | (b[n + 1] << 8)

const GZIP_HEADER = Uint8Array.from([
  31, 139, // gzip magic
  8, // deflate
  0, // no extra fields
  0, 0, 0, 0, // mtime (n/a)
  0, 0, // extra flags, OS
])

/**
 * @param {File} file
 * @param {Entry} entry
 */
function getRawChunk (file, entry) {
  return file
    .slice(entry.offset + 26, entry.offset + 30)
    .bytes()
    .then(bytes => {
      const localFileOffset = uint16e(bytes, 0) + uint16e(bytes, 2) + 30
      const start = entry.offset + localFileOffset
      const end = start + entry.compressedSize
      return file.slice(start, end)
    })
}

/**
 * @extends {File}
 */
class Entry {
  #dataView
  #fileLike
  /** @type {Object<string, DataView>} */
  #extraFields = {}
  #name
  type = ''

  /**
   * @param {DataView} dataView
   * @param {File} fileLike
   */
  constructor (dataView, fileLike) {
    if (dataView.getUint32(0) !== 0x504b0102) {
      throw new Error('ERR_BAD_FORMAT')
    }

    const dv = dataView

    this.#dataView = dv
    this.#fileLike = fileLike

    for (let i = 46 + this.filenameLength; i < dv.byteLength;) {
      const id = dv.getUint16(i, true)
      const len = dv.getUint16(i + 2, true)
      const start = dv.byteOffset + i + 4
      this.#extraFields[id] = new DataView(dv.buffer.slice(start, start + len))
      i += len + 4
    }
  }

  get versionMadeBy () {
    return this.#dataView.getUint16(4, true)
  }

  get versionNeeded () {
    return this.#dataView.getUint16(6, true)
  }

  get bitFlag () {
    return this.#dataView.getUint16(8, true)
  }

  get encrypted () {
    return (this.bitFlag & 0x0001) === 0x0001
  }

  get compressionMethod () {
    return this.#dataView.getUint16(10, true)
  }

  get crc32 () {
    return this.#dataView.getUint32(16, true)
  }

  get compressedSize () {
    return this.#dataView.getUint32(20, true)
  }

  get filenameLength () {
    return this.#dataView.getUint16(28, true)
  }

  get extraFieldLength () {
    return this.#dataView.getUint16(30, true)
  }

  get commentLength () {
    return this.#dataView.getUint16(32, true)
  }

  get diskNumberStart () {
    return this.#dataView.getUint16(34, true)
  }

  get internalFileAttributes () {
    return this.#dataView.getUint16(36, true)
  }

  get externalFileAttributes () {
    return this.#dataView.getUint32(38, true)
  }

  get directory () {
    return !!(this.#dataView.getUint8(38) & 16) ||
      (this.size === 0 && this.name.endsWith('/'))
  }

  get offset () {
    return this.#dataView.getUint32(42, true)
  }

  get zip64 () {
    return this.#dataView.getUint32(24, true) === MAX_VALUE_32BITS
  }

  get comment () {
    const dv = this.#dataView
    const uint8 = new Uint8Array(
      dv.buffer,
      dv.byteOffset + this.filenameLength + this.extraFieldLength + 46,
      this.commentLength
    )
    return decoder.decode(uint8)
  }

  get lastModified () {
    const t = this.#dataView.getUint32(12, true)

    return new Date(
      ((t >> 25) & 0x7f) + 1980, // year
      ((t >> 21) & 0x0f) - 1, // month
      (t >> 16) & 0x1f, // day
      (t >> 11) & 0x1f, // hour
      (t >> 5) & 0x3f, // minute
      (t & 0x1f) << 1 // second
    ).getTime()
  }

  /** @param {number} v timestamp in ms */
  set lastModified (v) {
    if (typeof v !== 'number') throw new TypeError('lastModified must be a number')
    const date = new Date(v)
    const val = ((date.getFullYear() - 1980) << 25) |
      ((date.getMonth() + 1) << 21) |
      (date.getDate() << 16) |
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1)
    this.#dataView.setUint32(12, val, true)
  }

  get name () {
    if (this.#name !== undefined) return this.#name

    if (!this.bitFlag && this.#extraFields[0x7075]) {
      return this.#name = decoder.decode(this.#extraFields[0x7075].buffer.slice(5))
    }

    const dv = this.#dataView
    const uint8 = new Uint8Array(
      dv.buffer,
      dv.byteOffset + 46,
      this.filenameLength
    )
    return this.#name = decoder.decode(uint8)
  }

  /** @param {string} v */
  set name (v) {
    if (typeof v !== 'string') throw new TypeError('name must be a string')
    this.#name = v
  }

  get size () {
    const size = this.#dataView.getUint32(24, true)
    return size === MAX_VALUE_32BITS ? this.#extraFields[1].getUint8(0) : size
  }

  set size (size) {
    // set to zip64 if larger than 4GB
    if (size > MAX_VALUE_32BITS) {
      this.#extraFields[1] = new DataView(new ArrayBuffer(1))
      this.#extraFields[1].setUint8(0, size)
    } else { }
  }

  rawBytes () {
    return getRawChunk(this.#fileLike, this)
  }

  async bytes () {
    if (!this.compressionMethod) {
      return getRawChunk(this.#fileLike, this).then(c => c.bytes())
    }

    const out = new Uint8Array(this.size)
    let offset = 0
    for await (const chunk of this.stream()) {
      out.set(chunk, offset)
      offset += chunk.byteLength
    }
    return out
  }

  stream () {
    const ts = new TransformStream()
    const crc = this.crc32
    const uncompressedSize = this.size
    this.rawBytes().then(chunk => {
      const stream = chunk.stream()

      if (this.compressionMethod) {
        const transformer = new TransformStream({
          start (controller) {
            controller.enqueue(GZIP_HEADER)
          },
          flush (controller) {
            const tmp = new DataView(new ArrayBuffer(8))
            tmp.setUint32(0, crc, true)
            tmp.setUint32(4, uncompressedSize, true)
            controller.enqueue(new Uint8Array(tmp.buffer))
          }
        })

        stream
          .pipeThrough(transformer)
          .pipeThrough(new DecompressionStream('gzip'))
          .pipeTo(ts.writable)
      } else {
        stream.pipeTo(ts.writable)
      }
    })

    return ts.readable
  }

  async arrayBuffer () {
    return (await this.bytes()).buffer
  }

  async text () {
    if (!this.compressionMethod) {
      return getRawChunk(this.#fileLike, this).then(c => c.text())
    }
    return new Response(this.stream()).text().catch((e) => {
      throw new Error(`Failed to read Entry\n${e}`)
    })
  }

  async file () {
    const reader = this.compressionMethod
      ? this.arrayBuffer()
      : getRawChunk(this.#fileLike, this)

    return reader
      .then(chunk => new File([chunk], this.name, { lastModified: this.lastModified }))
      .catch((err) => {
        throw new Error(`Failed to read Entry\n${err}`)
      })
  }
}

/**
 * Get a BigInt 64 from a DataView
 *
 * @param {DataView} view a dataview
 * @param {number} position the position
 * @param {boolean} littleEndian whether this uses littleEndian encoding
 */
function getBigInt64 (view, position, littleEndian = false) {
  return view.getBigInt64(position, littleEndian)
}

/**
 * @param {Blob} file
 */
async function* Reader (file) {
  // Seek EOCDR - "End of central directory record" is the last part of a zip archive, and is at least 22 bytes long.
  // Zip file comment is the last part of EOCDR and has max length of 64KB,
  // so we only have to search the last 64K + 22 bytes of a archive for EOCDR signature (0x06054b50).
  if (file.size < EOCDR_MIN) throw new Error(ERR_BAD_FORMAT)

  // seek last length bytes of file for EOCDR
  async function doSeek (length) {
    const ab = await file.slice(file.size - length).arrayBuffer()
    const bytes = new Uint8Array(ab)
    for (let i = bytes.length - EOCDR_MIN; i >= 0; i--) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x05 &&
        bytes[i + 3] === 0x06
      ) {
        return new DataView(bytes.buffer, i, EOCDR_MIN)
      }
    }

    return null
  }

  // In most cases, the EOCDR is EOCDR_MIN bytes long
  let dv =
    (await doSeek(EOCDR_MIN)) || (await doSeek(Math.min(EOCDR_MAX, file.size)))

  if (!dv) throw new Error(ERR_BAD_FORMAT)

  let fileslength = dv.getUint16(8, true)
  let centralDirSize = dv.getUint32(12, true)
  let centralDirOffset = dv.getUint32(16, true)
  // const fileCommentLength = dv.getUint16(20, true);

  const isZip64 = centralDirOffset === MAX_VALUE_32BITS

  if (isZip64) {
    const l = -dv.byteLength - 20
    dv = new DataView(await file.slice(l, -dv.byteLength).arrayBuffer())

    const signature = dv.getUint32(0, true) // 4 bytes
    const diskWithZip64CentralDirStart = dv.getUint32(4, true) // 4 bytes
    const relativeOffsetEndOfZip64CentralDir = Number(
      getBigInt64(dv, 8, true)
    ) // 8 bytes
    const numberOfDisks = dv.getUint32(16, true) // 4 bytes

    const zip64centralBlob = file.slice(relativeOffsetEndOfZip64CentralDir, l)
    dv = new DataView(await zip64centralBlob.arrayBuffer())
    // const zip64EndOfCentralSize = dv.getBigInt64(4, true)
    // const diskNumber = dv.getUint32(16, true)
    // const diskWithCentralDirStart = dv.getUint32(20, true)
    // const centralDirRecordsOnThisDisk = dv.getBigInt64(24, true)
    fileslength = Number(getBigInt64(dv, 32, true))
    centralDirSize = Number(getBigInt64(dv, 40, true))
    centralDirOffset = Number(getBigInt64(dv, 48, true))
  }

  if (centralDirOffset < 0 || centralDirOffset >= file.size) {
    throw new Error(ERR_BAD_FORMAT)
  }

  const start = centralDirOffset
  const end = centralDirOffset + centralDirSize
  const blob = file.slice(start, end)
  const bytes = new Uint8Array(await blob.arrayBuffer())

  for (let i = 0, index = 0; i < fileslength; i++) {
    const size =
      uint16e(bytes, index + 28) + // filenameLength
      uint16e(bytes, index + 30) + // extraFieldLength
      uint16e(bytes, index + 32) + // commentLength
      46

    if (index + size > bytes.length) {
      throw new Error('Invalid ZIP file.')
    }

    yield new Entry(new DataView(bytes.buffer, index, size), file)

    index += size
  }
}

export default Reader
export { Entry }
