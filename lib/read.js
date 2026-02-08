/*! zip64. MIT License. Jimmy Wärting <https://jimmy.warting.se/opensource> */

const ERR_BAD_FORMAT = 'File format is not recognized.'
const ZIP_COMMENT_MAX = 65536
const EOCDR_MIN = 22
const EOCDR_MAX = EOCDR_MIN + ZIP_COMMENT_MAX
const MAX_VALUE_32BITS = 0xffffffff

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const uint16e = (b, n) => b[n] | (b[n + 1] << 8)

const GZIP_HEADER = Uint8Array.from([
  31, 139, // gzip magic
  8, // deflate
  0, // no extra fields
  0, 0, 0, 0, // mtime (n/a)
  0, 0, // extra flags, OS
])

/**
 * @extends {File}
 */
class Entry {
  #dataView
  #fileLike
  /** @type {Object<string, DataView>} */
  #extraFields = {}
  #name
  /** @type {number} */
  #localFileOffset
  type = ''
  
  // Private fields for write mode
  #writeMode = false
  #crc32Value
  #compressionMethodValue
  #compressedSizeValue
  #uncompressedSizeValue
  #lastModifiedValue

  /**
   * @param {File|Object|DataView} fileLikeOrDataView - For write mode: File or Object with stream method. For read mode: DataView
   * @param {DataView|File} [dataViewOrFileLike] - For write mode: undefined. For read mode: File
   */
  constructor (fileLikeOrDataView, dataViewOrFileLike = undefined) {
    // Determine if this is read mode (backward compatible) or write mode (new)
    if (fileLikeOrDataView instanceof DataView && dataViewOrFileLike !== undefined) {
      // Read mode: constructor(dataView, fileLike)
      const dataView = fileLikeOrDataView
      const fileLike = dataViewOrFileLike
      
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
    } else {
      // Write mode: constructor(fileLike, dataView?) - new mode for generating zips
      this.#writeMode = true
      this.#fileLike = fileLikeOrDataView
      this.#dataView = dataViewOrFileLike
      
      // Initialize default values for write mode
      this.#compressionMethodValue = 0 // No compression by default
      this.#lastModifiedValue = Date.now()
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
    if (this.#writeMode) return this.#compressionMethodValue
    return this.#dataView.getUint16(10, true)
  }
  
  set compressionMethod (v) {
    if (typeof v !== 'number') throw new TypeError('compressionMethod must be a number')
    if (this.#writeMode) {
      this.#compressionMethodValue = v
    } else {
      this.#dataView.setUint16(10, v, true)
    }
  }

  get crc32 () {
    if (this.#writeMode) return this.#crc32Value ?? 0
    return this.#dataView.getUint32(16, true)
  }
  
  set crc32 (v) {
    if (typeof v !== 'number') throw new TypeError('crc32 must be a number')
    if (this.#writeMode) {
      this.#crc32Value = v
    } else {
      this.#dataView.setUint32(16, v, true)
    }
  }

  get compressedSize () {
    if (this.#writeMode) return this.#compressedSizeValue ?? 0
    return this.#dataView.getUint32(20, true)
  }
  
  set compressedSize (v) {
    if (typeof v !== 'number' && typeof v !== 'bigint') {
      throw new TypeError('compressedSize must be a number or bigint')
    }
    if (this.#writeMode) {
      this.#compressedSizeValue = typeof v === 'bigint' ? Number(v) : v
    } else {
      this.#dataView.setUint32(20, Number(v), true)
    }
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
    if (this.#writeMode) return this.#lastModifiedValue
    
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
    
    if (this.#writeMode) {
      this.#lastModifiedValue = v
    } else {
      const date = new Date(v)
      const val = ((date.getFullYear() - 1980) << 25) |
        ((date.getMonth() + 1) << 21) |
        (date.getDate() << 16) |
        (date.getHours() << 11) |
        (date.getMinutes() << 5) |
        (date.getSeconds() >> 1)
      this.#dataView.setUint32(12, val, true)
    }
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
    if (this.#writeMode) return this.#uncompressedSizeValue ?? 0
    
    const size = this.#dataView.getUint32(24, true)
    return size === MAX_VALUE_32BITS ? this.#extraFields[1].getUint8(0) : size
  }

  set size (size) {
    if (this.#writeMode) {
      this.#uncompressedSizeValue = typeof size === 'bigint' ? Number(size) : size
    } else {
      // set to zip64 if larger than 4GB
      if (size > MAX_VALUE_32BITS) {
        this.#extraFields[1] = new DataView(new ArrayBuffer(1))
        this.#extraFields[1].setUint8(0, size)
      }
    }
  }

  async #getRawChunk () {
    this.#localFileOffset ??= await this.#fileLike
      .slice(this.offset + 26, this.offset + 30)
      .bytes()
      .then(bytes => uint16e(bytes, 0) + uint16e(bytes, 2) + 30)

    const start = this.offset + this.#localFileOffset
    const end = start + this.compressedSize

    return this.#fileLike.slice(start, end)
  }

  rawBytes () {
    return this.#getRawChunk()
  }

  async bytes () {
    if (!this.compressionMethod) {
      return this.#getRawChunk().then(c => c.bytes())
    }

    // const out = new Uint8Array(this.size)
    // let offset = 0
    // for await (const chunk of this.stream()) {
    //   out.set(chunk, offset)
    //   offset += chunk.byteLength
    // }
    const out = new Uint8Array(this.size)
    const reader = this.stream().getReader({ mode: 'byob' })
    await reader.read(out, { min: this.size })
    reader.cancel()

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
      return this.#getRawChunk().then(c => c.text())
    }

    let text = ''
    const decoder = new TextDecoderStream()
    for await (const chunk of this.stream().pipeThrough(decoder)) {
      text += chunk
    }
    return text
  }

  async file () {
    /** @type {Blob[]} */
    const blobParts = []

    if (!this.compressionMethod && this.#fileLike instanceof Blob) {
      blobParts.push(await this.rawBytes())
    } else {
      // converting each chunk to a blob to avoid large memory consumption when
      // creating a single File from all chunks.
      //
      // This is especially important for large files. using this.bytes() or
      // this.arrayBuffer() would require loading the entire file into memory,
      // which can lead to out-of-memory errors for large files. Creating blobs
      // allows the runtime to manage memory more efficiently, as blobs can be
      // offloaded from memory.
      for await (const chunk of this.stream()) {
        blobParts.push(new Blob(chunk))
      }
    }

    return new File(
      blobParts,
      this.name,
      { lastModified: this.lastModified }
    )
  }
  
  /**
   * Generate a local file header for writing ZIP files
   * @returns {Uint8Array} The local file header bytes
   */
  generateLocalHeader () {
    if (!this.#writeMode) {
      throw new Error('generateLocalHeader() can only be called on Entry instances created for writing')
    }
    
    const name = this.#name || ''
    const nameBuf = encoder.encode(name)
    const date = new Date(this.#lastModifiedValue)
    
    // Local file header structure:
    // 4 bytes: signature (0x04034b50)
    // 2 bytes: version needed to extract
    // 2 bytes: general purpose bit flag
    // 2 bytes: compression method
    // 2 bytes: last mod file time
    // 2 bytes: last mod file date
    // 4 bytes: crc-32
    // 4 bytes: compressed size
    // 4 bytes: uncompressed size
    // 2 bytes: file name length
    // 2 bytes: extra field length
    // n bytes: file name
    // m bytes: extra field
    
    const headerSize = 30 + nameBuf.length
    const data = new Uint8Array(headerSize)
    const dv = new DataView(data.buffer)
    
    // Signature
    dv.setUint32(0, 0x04034b50, true)
    
    // Version needed to extract (2.0)
    dv.setUint16(4, 0x0014, true)
    
    // General purpose bit flag
    // Bit 3: if set, crc-32, compressed size and uncompressed size are in data descriptor after file data
    const bitFlag = (this.#crc32Value === undefined) ? 0x0008 : 0x0000
    dv.setUint16(6, bitFlag, true)
    
    // Compression method
    dv.setUint16(8, this.#compressionMethodValue, true)
    
    // Last mod file time
    dv.setUint16(
      10,
      (((date.getHours() << 6) | date.getMinutes()) << 5) |
      (date.getSeconds() / 2),
      true
    )
    
    // Last mod file date
    dv.setUint16(
      12,
      ((((date.getFullYear() - 1980) << 4) | (date.getMonth() + 1)) << 5) |
      date.getDate(),
      true
    )
    
    // CRC-32 (may be 0 if using data descriptor)
    dv.setUint32(14, this.#crc32Value ?? 0, true)
    
    // Compressed size (may be 0 if using data descriptor)
    dv.setUint32(18, this.#compressedSizeValue ?? 0, true)
    
    // Uncompressed size (may be 0 if using data descriptor)
    dv.setUint32(22, this.#uncompressedSizeValue ?? 0, true)
    
    // File name length
    dv.setUint16(26, nameBuf.length, true)
    
    // Extra field length (0 for now)
    dv.setUint16(28, 0, true)
    
    // File name
    data.set(nameBuf, 30)
    
    return data
  }
  
  /**
   * Generate a data descriptor (used when CRC is unknown at header write time)
   * @returns {Uint8Array} The data descriptor bytes
   */
  generateDataDescriptor () {
    if (!this.#writeMode) {
      throw new Error('generateDataDescriptor() can only be called on Entry instances created for writing')
    }
    
    // Data descriptor structure:
    // 4 bytes: signature (0x08074b50) - optional but recommended
    // 4 bytes: crc-32
    // 4 bytes: compressed size (or 8 bytes for ZIP64)
    // 4 bytes: uncompressed size (or 8 bytes for ZIP64)
    
    const data = new Uint8Array(16)
    const dv = new DataView(data.buffer)
    
    // Signature
    dv.setUint32(0, 0x08074b50, true)
    
    // CRC-32
    dv.setUint32(4, this.#crc32Value ?? 0, true)
    
    // Compressed size
    dv.setUint32(8, this.#compressedSizeValue ?? 0, true)
    
    // Uncompressed size
    dv.setUint32(12, this.#uncompressedSizeValue ?? 0, true)
    
    return data
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
  // Seek EOCDR - "End of central directory record" is the last part of a zip
  // archive, and is at least 22 bytes long. Zip file comment is the last part
  // of EOCDR and has max length of 64KB, so we only have to search the last 64K
  // + 22 bytes of a archive for EOCDR signature (0x06054b50).
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
