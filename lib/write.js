/*! zip64. MIT License. Jimmy Wärting <https://jimmy.warting.se/opensource> */
import Crc32 from './crc.js'

const encoder = new TextEncoder()
const MAX_VALUE_32BITS = 0xffffffff

class ZipTransformer {
  offset = BigInt(0);
  files = Object.create(null);
  filenames = [];

  /**
   * @param {Object} entry [description]
   * @param {ReadableStreamDefaultController}  ctrl
   */
  async transform (entry, ctrl) {
    let name = entry.name.trim()
    const date = new Date(
      typeof entry.lastModified === 'undefined'
        ? Date.now()
        : entry.lastModified
    )

    if (entry.directory && !name.endsWith('/')) name += '/'
    if (this.files[name]) ctrl.abort(new Error('File already exists.'))

    const nameBuf = encoder.encode(name)
    this.filenames.push(name)

    this.files[name] = {
      directory: !!entry.directory,
      nameBuf,
      offset: this.offset,
      comment: encoder.encode(entry.comment || ''),
      compressedLength: BigInt(0),
      uncompressedLength: BigInt(0),
      header: new Uint8Array(26),
      zip64: false
    }

    const zipObject = this.files[name]

    const { header } = zipObject
    const hdv = new DataView(header.buffer)
    
    // Check if we need ZIP64 for offset (will be determined later)
    // For now, we'll prepare the local file header without extra field
    // and add it after we know the sizes
    const data = new Uint8Array(30 + nameBuf.length)

    hdv.setUint32(0, 0x14000808)
    hdv.setUint16(
      6,
      (((date.getHours() << 6) | date.getMinutes()) << 5) |
      (date.getSeconds() / 2),
      true,
    )
    hdv.setUint16(
      8,
      ((((date.getFullYear() - 1980) << 4) | (date.getMonth() + 1)) << 5) |
      date.getDate(),
      true,
    )
    hdv.setUint16(22, nameBuf.length, true)
    data.set([80, 75, 3, 4])
    data.set(header, 4)
    data.set(nameBuf, 30)

    this.offset += BigInt(data.length)
    ctrl.enqueue(data)

    const footer = new Uint8Array(16)
    footer.set([80, 75, 7, 8])

    if (entry.stream) {
      zipObject.crc = new Crc32()
      const reader = entry.stream().getReader()

      while (true) {
        const it = await reader.read()
        if (it.done) break
        const chunk = it.value
        zipObject.crc.append(chunk)
        zipObject.uncompressedLength += BigInt(chunk.length)
        zipObject.compressedLength += BigInt(chunk.length)
        ctrl.enqueue(chunk)
      }

      // Check if we need ZIP64
      zipObject.zip64 = zipObject.compressedLength > MAX_VALUE_32BITS ||
                        zipObject.uncompressedLength > MAX_VALUE_32BITS ||
                        zipObject.offset > MAX_VALUE_32BITS

      hdv.setUint32(10, zipObject.crc.get(), true)
      
      if (zipObject.zip64) {
        // Set sizes to 0xffffffff to indicate ZIP64
        hdv.setUint32(14, MAX_VALUE_32BITS, true)
        hdv.setUint32(18, MAX_VALUE_32BITS, true)
      } else {
        hdv.setUint32(14, Number(zipObject.compressedLength), true)
        hdv.setUint32(18, Number(zipObject.uncompressedLength), true)
      }
      
      footer.set(header.subarray(10, 22), 4)
    }

    hdv.setUint16(22, nameBuf.length, true)

    this.offset += zipObject.compressedLength + BigInt(16)

    ctrl.enqueue(footer)
  }

  /**
   * @param  {ReadableStreamDefaultController} ctrl
   */
  flush (ctrl) {
    let length = 0
    let index = 0
    let file
    let needsZip64 = false

    // Calculate central directory size and check if we need ZIP64
    this.filenames.forEach((fileName) => {
      file = this.files[fileName]
      let extraFieldLen = 0
      
      // Add ZIP64 extra field length if needed
      if (file.zip64) {
        needsZip64 = true
        extraFieldLen = 20 // ZIP64 extra field: 2 (id) + 2 (size) + 8 (uncompressed) + 8 (compressed)
      }
      
      length += 46 + file.nameBuf.length + file.comment.length + extraFieldLen
    })

    // Also check if offset or size exceeds 32-bit
    if (this.offset > MAX_VALUE_32BITS || length > MAX_VALUE_32BITS || this.filenames.length > 0xffff) {
      needsZip64 = true
    }

    const data = new Uint8Array(length + (needsZip64 ? 98 : 22))
    const dv = new DataView(data.buffer)

    // Write central directory entries
    this.filenames.forEach((fileName) => {
      file = this.files[fileName]
      dv.setUint32(index, 0x504b0102)
      dv.setUint16(index + 4, file.zip64 ? 0x2d00 : 0x1400) // version made by (45 for ZIP64)
      dv.setUint16(index + 32, file.comment.length, true)
      dv.setUint8(index + 38, file.directory ? 16 : 0)
      
      // Set offset - use 0xffffffff if ZIP64
      if (file.zip64 || file.offset > MAX_VALUE_32BITS) {
        dv.setUint32(index + 42, MAX_VALUE_32BITS, true)
      } else {
        dv.setUint32(index + 42, Number(file.offset), true)
      }
      
      data.set(file.header, index + 6)
      data.set(file.nameBuf, index + 46)
      
      // Write ZIP64 extra field if needed
      let extraIndex = index + 46 + file.nameBuf.length
      if (file.zip64) {
        // ZIP64 extra field
        dv.setUint16(extraIndex, 0x0001, true) // ZIP64 extra field tag
        dv.setUint16(extraIndex + 2, 16, true) // size of extra field data
        dv.setBigUint64(extraIndex + 4, file.uncompressedLength, true)
        dv.setBigUint64(extraIndex + 12, file.compressedLength, true)
        
        // Update extra field length in header
        dv.setUint16(index + 30, 20, true)
        extraIndex += 20
      }
      
      data.set(file.comment, extraIndex)
      index += 46 + file.nameBuf.length + file.comment.length + (file.zip64 ? 20 : 0)
    })

    const centralDirStart = this.offset
    const centralDirSize = BigInt(length)

    if (needsZip64) {
      // Write ZIP64 End of Central Directory Record
      dv.setUint32(index, 0x504b0606, true) // ZIP64 EOCD signature
      dv.setBigUint64(index + 4, BigInt(44), true) // size of zip64 end of central directory record
      dv.setUint16(index + 12, 0x2d, true) // version made by
      dv.setUint16(index + 14, 0x2d, true) // version needed to extract
      dv.setUint32(index + 16, 0, true) // number of this disk
      dv.setUint32(index + 20, 0, true) // disk where central directory starts
      dv.setBigUint64(index + 24, BigInt(this.filenames.length), true) // number of central directory records on this disk
      dv.setBigUint64(index + 32, BigInt(this.filenames.length), true) // total number of central directory records
      dv.setBigUint64(index + 40, centralDirSize, true) // size of central directory
      dv.setBigUint64(index + 48, centralDirStart, true) // offset of start of central directory
      index += 56

      // Write ZIP64 End of Central Directory Locator
      dv.setUint32(index, 0x504b0607, true) // ZIP64 EOCD Locator signature
      dv.setUint32(index + 4, 0, true) // number of disk with ZIP64 EOCD
      dv.setBigUint64(index + 8, centralDirStart + centralDirSize, true) // offset of ZIP64 EOCD
      dv.setUint32(index + 16, 1, true) // total number of disks
      index += 20
    }

    // Write End of Central Directory Record
    dv.setUint32(index, 0x504b0506)
    dv.setUint16(index + 8, needsZip64 ? 0xffff : this.filenames.length, true)
    dv.setUint16(index + 10, needsZip64 ? 0xffff : this.filenames.length, true)
    dv.setUint32(index + 12, needsZip64 ? MAX_VALUE_32BITS : Number(centralDirSize), true)
    dv.setUint32(index + 16, needsZip64 ? MAX_VALUE_32BITS : Number(centralDirStart), true)
    
    ctrl.enqueue(data)

    // cleanup
    this.files = Object.create(null)
    this.filenames = []
    this.offset = BigInt(0)
  }
}

class Writer extends TransformStream {
  constructor () {
    super(new ZipTransformer())
  }
}

export default Writer
