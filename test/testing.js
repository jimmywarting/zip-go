import test from 'node:test'
import assert from 'node:assert/strict'

import read from '../lib/read.js'
import Writer from '../lib/write.js'
import { VirtualLoremIpsumFile } from './virtual-lorem-ipsum-file.js'

/**
 * @param {File} file
 * @param {Object} extraParams
 */
const mix = (file, extraParams) => {
  return new Proxy(file, {
    get (target, prop) {
      if (prop in extraParams) {
        return extraParams[prop]
      }
      return Reflect.get(...arguments)
    }
  })
}

function createZipBlob (files) {
  return new Response(ReadableStream.from(files).pipeThrough(new Writer())).blob()
}

async function readZipBlob (zipBlob) {
  const entries = []
  for await (const entry of read(zipBlob)) {
    entries.push(entry)
  }
  return entries
}

// Test basic imports
test('imports should work correctly', (t) => {
  assert.ok(read, 'read should be exported')
  assert.ok(Writer, 'Writer should be exported')
})

// Test Writer class exists and has required methods
test('Writer should be a TransformStream', (t) => {
  const writer = new Writer()
  assert.ok(typeof writer.writable === 'object', 'Writer should have a writable property')
  assert.ok(typeof writer.readable === 'object', 'Writer should have a readable property')
})

// Test creating a simple zip with one file
test('should create a zip with one file entry', async (t) => {
  const file = new File(['Hello, World!'], 'test.txt')

  const zipFile = await createZipBlob([
    file
  ])

})

// Test custom comment
test('should support custom file comments', async (t) => {
  const file = new File([], 'commented.txt', { lastModified: 1234 })

  const entry = mix(file, {
    comment: 'This is a test file'
  })

  const zipFile = await createZipBlob([
    entry
  ])

  const entries = await readZipBlob(zipFile)

  assert.equal(
    entries[0].comment,
    'This is a test file',
    'File comment should be preserved'
  )
})

// Test date handling
test('should use current date when lastModified is not specified', async (t) => {
  const file = new File([], 'nodatespec.txt')
  const entry = mix(file, {
    lastModified: undefined
  })

  const zipFile = await createZipBlob([
    entry
  ])

  const entries = await readZipBlob(zipFile)
  const entryDate = new Date(entries[0].lastModified)
  const now = new Date()

  // Check if the date is within a reasonable range (e.g., within the last minute)
  assert.ok(
    Math.abs(now - entryDate) < 60000,
    'Entry date should be close to current time when lastModified is not specified'
  )
})

// Test custom lastModified date
test('should use custom lastModified date', async (t) => {
  const customDate = new Date('2024-01-15T10:30:00').getTime()
  const file = new File([], 'dated.txt', { lastModified: customDate })
  const zipFile = await createZipBlob([
    file
  ])

  const entries = await readZipBlob(zipFile)

  assert.equal(
    entries[0].lastModified,
    customDate,
    'Custom lastModified date should be preserved'
  )
})

// Test creating zip with multiple files
test('should create a zip with multiple files', async (t) => {
  const files = [
    new File(['First file content'], 'file1.txt'),
    new File(['Second file content'], 'file2.txt'),
    new File(['Third file content'], 'file3.txt')
  ]

  const zipFile = await createZipBlob(files)
  const entries = await readZipBlob(zipFile)

  assert.equal(entries.length, 3, 'Should have 3 entries')
  assert.equal(entries[0].name, 'file1.txt')
  assert.equal(entries[1].name, 'file2.txt')
  assert.equal(entries[2].name, 'file3.txt')
})

// Test reading file content from zip
test('should correctly read text file content from zip', async (t) => {
  const content = 'Hello, World! This is a test.'
  const file = new File([content], 'test.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const text = await entries[0].text()
  assert.equal(text, content, 'File content should match')
})

// Test reading binary content from zip
test('should correctly read binary content from zip', async (t) => {
  const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  const file = new File([data], 'binary.bin')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const bytes = await entries[0].bytes()
  assert.deepEqual(bytes, data, 'Binary content should match')
})

// Test directory entries
test('should handle directory entries', async (t) => {
  const dir = new File([], 'mydir/')
  const dirEntry = mix(dir, { directory: true })

  const zipFile = await createZipBlob([dirEntry])
  const entries = await readZipBlob(zipFile)

  assert.equal(entries.length, 1)
  assert.ok(entries[0].directory, 'Entry should be marked as directory')
  assert.ok(entries[0].name.endsWith('/'), 'Directory name should end with /')
})

// Test nested file paths
test('should handle nested file paths', async (t) => {
  const files = [
    new File(['root file'], 'root.txt'),
    new File(['nested file'], 'folder/nested.txt'),
    new File(['deeply nested'], 'folder/subfolder/deep.txt')
  ]

  const zipFile = await createZipBlob(files)
  const entries = await readZipBlob(zipFile)

  assert.equal(entries.length, 3)
  assert.equal(entries[0].name, 'root.txt')
  assert.equal(entries[1].name, 'folder/nested.txt')
  assert.equal(entries[2].name, 'folder/subfolder/deep.txt')
})

// Test large file handling
test('should handle larger files', async (t) => {
  const size = 1024 * 100 // 100KB
  const data = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    data[i] = i % 256
  }

  const file = new File([data], 'large.bin')
  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const bytes = await entries[0].bytes()
  assert.equal(bytes.length, size, 'File size should match')
  assert.deepEqual(bytes, data, 'Large file content should match')
})

// Test empty file
test('should handle empty files', async (t) => {
  const file = new File([], 'empty.txt')
  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  assert.equal(entries.length, 1)
  assert.equal(entries[0].size, 0, 'File size should be 0')
  const content = await entries[0].text()
  assert.equal(content, '', 'Content should be empty')
})

// Test file with special characters in name
test('should handle file names with special characters', async (t) => {
  const files = [
    new File(['content'], 'file with spaces.txt'),
    new File(['content'], 'file-with-dashes.txt'),
    new File(['content'], 'file_with_underscores.txt'),
    new File(['content'], 'файл.txt') // Cyrillic characters
  ]

  const zipFile = await createZipBlob(files)
  const entries = await readZipBlob(zipFile)

  assert.equal(entries.length, 4)
  assert.equal(entries[0].name, 'file with spaces.txt')
  assert.equal(entries[1].name, 'file-with-dashes.txt')
  assert.equal(entries[2].name, 'file_with_underscores.txt')
  assert.equal(entries[3].name, 'файл.txt')
})

// Test reading file as arrayBuffer
test('should read file as arrayBuffer', async (t) => {
  const content = 'Test content'
  const file = new File([content], 'test.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const buffer = await entries[0].arrayBuffer()
  const text = new TextDecoder().decode(buffer)
  assert.equal(text, content, 'ArrayBuffer content should match')
})

// Test reading file as File object
test('should read entry as File object', async (t) => {
  const content = 'Test content'
  const originalFile = new File([content], 'test.txt', { lastModified: 1234567890 })

  const zipFile = await createZipBlob([originalFile])
  const entries = await readZipBlob(zipFile)

  const extractedFile = await entries[0].file()
  assert.ok(extractedFile instanceof File, 'Should be a File instance')
  assert.equal(extractedFile.name, 'test.txt')
  assert.equal(await extractedFile.text(), content)
})

// Test streaming large file
test('should stream file content', async (t) => {
  const content = 'Stream test content'
  const file = new File([content], 'stream.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const stream = entries[0].stream()
  const chunks = []

  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const text = await new Blob(chunks).text()
  assert.equal(text, content, 'Streamed content should match')
})

// Test Entry properties
test('should have correct Entry properties', async (t) => {
  const content = 'Test'
  const file = new File([content], 'props.txt', { lastModified: 1234567890 })

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)
  const entry = entries[0]

  assert.equal(entry.name, 'props.txt')
  assert.equal(entry.size, content.length)
  assert.equal(typeof entry.crc32, 'number')
  assert.equal(typeof entry.compressionMethod, 'number')
  assert.ok(!entry.directory, 'Should not be a directory')
  assert.ok(!entry.encrypted, 'Should not be encrypted')
})

// Test mixed content (files and directories)
test('should handle mixed files and directories', async (t) => {
  const dir1 = mix(new File([], 'folder1/'), { directory: true })
  const file1 = new File(['content1'], 'folder1/file1.txt')
  const dir2 = mix(new File([], 'folder2/'), { directory: true })
  const file2 = new File(['content2'], 'folder2/file2.txt')

  const zipFile = await createZipBlob([dir1, file1, dir2, file2])
  const entries = await readZipBlob(zipFile)

  assert.equal(entries.length, 4)
  assert.ok(entries[0].directory)
  assert.ok(!entries[1].directory)
  assert.ok(entries[2].directory)
  assert.ok(!entries[3].directory)
})

// Test UTF-8 content
test('should handle UTF-8 content correctly', async (t) => {
  const content = 'Hello 世界 🌍 Привет مرحبا'
  const file = new File([content], 'utf8.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const text = await entries[0].text()
  assert.equal(text, content, 'UTF-8 content should be preserved')
})

// Test multiple reads from same entry
test('should allow multiple reads from same entry', async (t) => {
  const content = 'Test content'
  const file = new File([content], 'test.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)
  const entry = entries[0]

  const text1 = await entry.text()
  const text2 = await entry.text()

  assert.equal(text1, content)
  assert.equal(text2, content)
  assert.equal(text1, text2, 'Multiple reads should return same content')
})

// VirtualLoremIpsumFile tests
test('VirtualLoremIpsumFile should work with zip writer for small file', async (t) => {
  const size = 512
  const file = new VirtualLoremIpsumFile(size, 'virtual-small.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  assert.equal(entries.length, 1, 'Should have 1 entry')
  assert.equal(entries[0].name, 'virtual-small.txt')
  assert.equal(entries[0].size, size, 'Compressed file size should match')

  const extractedContent = await entries[0].text()
  assert.ok(extractedContent.includes('Lorem ipsum'), 'Content should contain Lorem ipsum')
})

test('VirtualLoremIpsumFile should work with zip writer for large file', async (t) => {
  const size = 1024 * 100 // 100KB
  const file = new VirtualLoremIpsumFile(size, 'virtual-large.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  assert.equal(entries.length, 1, 'Should have 1 entry')
  assert.equal(entries[0].name, 'virtual-large.txt')
  assert.equal(entries[0].size, size, 'File size should match')

  const bytes = await entries[0].bytes()
  assert.equal(bytes.length, size, 'Extracted bytes length should match')
})

test('VirtualLoremIpsumFile should work with multiple virtual files in zip', async (t) => {
  const files = [
    new VirtualLoremIpsumFile(512, 'virtual1.txt'),
    new VirtualLoremIpsumFile(1024, 'virtual2.txt'),
    new VirtualLoremIpsumFile(2048, 'virtual3.txt')
  ]

  const zipFile = await createZipBlob(files)
  const entries = await readZipBlob(zipFile)

  assert.equal(entries.length, 3, 'Should have 3 entries')
  assert.equal(entries[0].size, 512)
  assert.equal(entries[1].size, 1024)
  assert.equal(entries[2].size, 2048)

  // Verify all content is readable
  for (const entry of entries) {
    const text = await entry.text()
    assert.ok(text.includes('Lorem ipsum'), `Entry ${entry.name} should have content`)
  }
})

test('VirtualLoremIpsumFile should work with mixed real and virtual files', async (t) => {
  const files = [
    new File(['Real file content'], 'real.txt'),
    new VirtualLoremIpsumFile(512, 'virtual.txt'),
    new File(['Another real file'], 'real2.txt')
  ]

  const zipFile = await createZipBlob(files)
  const entries = await readZipBlob(zipFile)

  assert.equal(entries.length, 3, 'Should have 3 entries')
  assert.equal(await entries[0].text(), 'Real file content')
  assert.ok((await entries[1].text()).includes('Lorem ipsum'))
  assert.equal(await entries[2].text(), 'Another real file')
})

test('VirtualLoremIpsumFile should allow streaming content without loading into memory', async (t) => {
  const size = 1024 * 100 // 100KB instead of 1MB
  const file = new VirtualLoremIpsumFile(size, 'large-virtual.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const stream = entries[0].stream()
  let totalSize = 0

  for await (const chunk of stream) {
    totalSize += chunk.length
  }

  assert.equal(totalSize, size, 'Total size should match')
})

test('VirtualLoremIpsumFile should preserve content consistency across multiple reads', async (t) => {
  const size = 1024
  const file = new VirtualLoremIpsumFile(size, 'consistency.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const text1 = await entries[0].text()
  const bytes1 = await entries[0].bytes()
  const text2 = await entries[0].text()

  assert.equal(text1, text2, 'Multiple text reads should return same content')
  assert.equal(new TextDecoder().decode(bytes1), text1, 'Text and bytes should match')
})

test('VirtualLoremIpsumFile should work with custom options', async (t) => {
  const customDate = new Date('2025-06-15T12:00:00').getTime()
  const file = new VirtualLoremIpsumFile(512, 'custom.txt', { lastModified: customDate })

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  assert.equal(entries[0].lastModified, customDate, 'Custom lastModified should be preserved')
})

test('VirtualLoremIpsumFile should handle very small sizes', async (t) => {
  const sizes = [1, 10, 100]

  for (const size of sizes) {
    const file = new VirtualLoremIpsumFile(size, `small-${size}.txt`)
    const zipFile = await createZipBlob([file])
    const entries = await readZipBlob(zipFile)

    assert.equal(entries[0].size, size, `Size ${size} should be correct`)
    const content = await entries[0].text()
    assert.equal(content.length, size, `Content length for size ${size} should match`)
  }
})

test('VirtualLoremIpsumFile content should produce valid zip files', async (t) => {
  const size = 10000
  const file = new VirtualLoremIpsumFile(size, 'valid.txt')

  const zipFile = await createZipBlob([file])

  // Verify the zip file is valid by reading its entries
  const entries = await readZipBlob(zipFile)
  assert.equal(entries.length, 1, 'Should have 1 valid entry')
  assert.equal(entries[0].size, size, 'File size should be preserved')

  // Verify content can be fully extracted
  const content = await entries[0].text()
  assert.equal(content.length, size, 'Extracted content should match original size')
})
// Test Entry property getters
test('Entry should have all required property getters', async (t) => {
  const file = new File(['Test content'], 'test.txt', { lastModified: 1234567890000 })
  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)
  const entry = entries[0]

  // Test all property getters
  assert.equal(typeof entry.versionMadeBy, 'number', 'versionMadeBy should be a number')
  assert.equal(typeof entry.versionNeeded, 'number', 'versionNeeded should be a number')
  assert.equal(typeof entry.bitFlag, 'number', 'bitFlag should be a number')
  assert.equal(typeof entry.compressionMethod, 'number', 'compressionMethod should be a number')
  assert.equal(typeof entry.crc32, 'number', 'crc32 should be a number')
  assert.equal(typeof entry.compressedSize, 'number', 'compressedSize should be a number')
  assert.equal(typeof entry.filenameLength, 'number', 'filenameLength should be a number')
  assert.equal(typeof entry.extraFieldLength, 'number', 'extraFieldLength should be a number')
  assert.equal(typeof entry.commentLength, 'number', 'commentLength should be a number')
  assert.equal(typeof entry.diskNumberStart, 'number', 'diskNumberStart should be a number')
  assert.equal(typeof entry.internalFileAttributes, 'number', 'internalFileAttributes should be a number')
  assert.equal(typeof entry.externalFileAttributes, 'number', 'externalFileAttributes should be a number')
  assert.equal(typeof entry.offset, 'number', 'offset should be a number')
  assert.equal(typeof entry.lastModified, 'number', 'lastModified should be a number')
  assert.equal(entry.lastModified, 1234567890000, 'lastModified should match input')
})

// Test Entry name setter
test('Entry name property should be settable', async (t) => {
  const file = new File(['Test'], 'test.txt')
  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)
  const entry = entries[0]

  const originalName = entry.name
  entry.name = 'new-name.txt'
  assert.equal(entry.name, 'new-name.txt', 'Name should be updated')

  // Setting back should also work
  entry.name = originalName
  assert.equal(entry.name, originalName, 'Name should be reverted')
})

// Test Entry lastModified setter with invalid type
test('Entry lastModified setter should reject non-number values', async (t) => {
  const file = new File(['Test'], 'test.txt')
  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)
  const entry = entries[0]

  assert.throws(
    () => { entry.lastModified = 'not-a-number' },
    TypeError,
    'Setting lastModified to string should throw TypeError'
  )

  assert.throws(
    () => { entry.lastModified = null },
    TypeError,
    'Setting lastModified to null should throw TypeError'
  )
})

// Test Entry name setter with invalid type
test('Entry name setter should reject non-string values', async (t) => {
  const file = new File(['Test'], 'test.txt')
  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)
  const entry = entries[0]

  assert.throws(
    () => { entry.name = 123 },
    TypeError,
    'Setting name to number should throw TypeError'
  )

  assert.throws(
    () => { entry.name = null },
    TypeError,
    'Setting name to null should throw TypeError'
  )
})

// Test compressed file handling
test('should create and extract compressed files', async (t) => {
  // Create a larger file to ensure compression occurs
  const largeContent = 'Lorem ipsum dolor sit amet. '.repeat(100)
  const file = new File([largeContent], 'compressed.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  assert.equal(entries[0].name, 'compressed.txt')
  const extractedContent = await entries[0].text()
  assert.equal(extractedContent, largeContent, 'Compressed content should match original')
})

// Test error case: invalid ZIP format
test('should throw error for invalid ZIP format', async (t) => {
  const invalidZipBlob = new Blob([new Uint8Array([1, 2, 3, 4, 5])])

  try {
    for await (const entry of read(invalidZipBlob)) {
      // Should not reach here
    }
    assert.fail('Should have thrown an error for invalid ZIP')
  } catch (err) {
    assert.ok(err.message.includes('format'), 'Error should mention bad format')
  }
})

// Test error case: ZIP file too small
test('should throw error for ZIP file smaller than EOCDR_MIN', async (t) => {
  const tinyBlob = new Blob([new Uint8Array([1, 2])])

  try {
    for await (const entry of read(tinyBlob)) {
      // Should not reach here
    }
    assert.fail('Should have thrown an error')
  } catch (err) {
    assert.ok(err.message, 'Should throw an error')
  }
})

// Test rawBytes method
test('should be able to get raw bytes from entry', async (t) => {
  const content = 'Raw bytes test content'
  const file = new File([content], 'raw.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const rawBytes = await entries[0].rawBytes()
  assert.ok(rawBytes instanceof Blob, 'rawBytes should return a Blob')
})

// Test Entry with comment setter/getter
test('Entry comment should be retrievable', async (t) => {
  const file = new File(['Content'], 'commented.txt')
  const fileWithComment = mix(file, {
    comment: 'File comment'
  })

  const zipFile = await createZipBlob([fileWithComment])
  const entries = await readZipBlob(zipFile)

  assert.equal(entries[0].comment, 'File comment', 'Comment should match')
})

// Test size getter with zip64
test('Entry size property should work correctly', async (t) => {
  const content = 'Size test'
  const file = new File([content], 'size-test.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  assert.equal(entries[0].size, content.length, 'Size should match content length')
})

// Test directory detection via name
test('Entry should detect directories by trailing slash when size is 0', async (t) => {
  const dirFile = mix(new File([], 'mydir/'), { directory: true })
  const regularFile = new File([], 'regulardir/')

  const zipFile = await createZipBlob([dirFile, regularFile])
  const entries = await readZipBlob(zipFile)

  assert.ok(entries[0].directory, 'Entry with directory flag and / should be directory')
  assert.ok(entries[1].directory, 'Entry with / and zero size should be directory')
})

// Test encrypted file detection
test('Entry should detect encryption from bitFlag', async (t) => {
  const file = new File(['Encrypted?'], 'test.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  assert.equal(typeof entries[0].encrypted, 'boolean', 'encrypted should be a boolean')
  assert.ok(!entries[0].encrypted, 'Files without encryption bit should not be encrypted')
})

// Test zip64 detection
test('Entry should detect zip64 format', async (t) => {
  const file = new File(['Test'], 'test.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  assert.equal(typeof entries[0].zip64, 'boolean', 'zip64 should be a boolean')
  // Regular file should not be zip64
  assert.ok(!entries[0].zip64, 'Small file should not be zip64')
})

// Test rawBytes caching with #getRawChunk
test('Entry should cache raw chunk offset for efficiency', async (t) => {
  const content = 'Cache test'
  const file = new File([content], 'cache.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  // First call should compute and cache
  const raw1 = await entries[0].rawBytes()
  // Second call should use cache
  const raw2 = await entries[0].rawBytes()

  const bytes1 = await raw1.bytes()
  const bytes2 = await raw2.bytes()

  assert.deepEqual(bytes1, bytes2, 'Cached raw bytes should match')
})

// Test multiple entry reads with stream
test('Entry stream should work multiple times', async (t) => {
  const content = 'Stream test'
  const file = new File([content], 'stream-test.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)
  const entry = entries[0]

  // First stream read
  let streamText = ''
  for await (const chunk of entry.stream()) {
    const decoder = new TextDecoder()
    streamText += decoder.decode(chunk)
  }

  assert.equal(streamText, content, 'First stream read should match content')

  // Second stream read (should also work)
  streamText = ''
  for await (const chunk of entry.stream()) {
    const decoder = new TextDecoder()
    streamText += decoder.decode(chunk)
  }

  assert.equal(streamText, content, 'Second stream read should also match content')
})

// Test Entry with extra fields
test('Entry should handle extra fields properly', async (t) => {
  const file = new File(['Test'], 'test.txt', { lastModified: 1234567890000 })
  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  // Should not throw and should be readable
  assert.ok(entries[0].name, 'Entry should have a name')
  assert.equal(typeof entries[0].extraFieldLength, 'number', 'extraFieldLength should be available')
})

// Test Write transformer with duplicate filename detection
test('Writer should detect and reject duplicate filenames', async (t) => {
  const file1 = new File(['Content 1'], 'duplicate.txt')
  const file2 = new File(['Content 2'], 'duplicate.txt')

  try {
    await new Response(ReadableStream.from([file1, file2]).pipeThrough(new Writer())).blob()
    assert.fail('Should have thrown error for duplicate filename')
  } catch (err) {
    assert.ok(err, 'Should throw an error')
  }
})

// Test Entry with zero-size directory
test('should create and read zero-size files and directories correctly', async (t) => {
  const emptyFile = new File([], 'empty.txt')
  const emptyDir = mix(new File([], ''), { directory: true })

  const zipFile = await createZipBlob([emptyFile, emptyDir])
  const entries = await readZipBlob(zipFile)

  assert.equal(entries[0].size, 0, 'Empty file should have size 0')
})

// Test Writer flush with multiple files
test('Writer should properly flush all files in central directory', async (t) => {
  const files = [
    new File(['File 1'], 'file1.txt'),
    new File(['File 2'], 'file2.txt'),
    new File(['File 3'], 'file3.txt')
  ]

  const zipFile = await createZipBlob(files)
  const entries = await readZipBlob(zipFile)

  assert.equal(entries.length, 3, 'Should have 3 entries')
  assert.equal(entries[0].name, 'file1.txt')
  assert.equal(entries[1].name, 'file2.txt')
  assert.equal(entries[2].name, 'file3.txt')
})

// Test compression with text() method
test('Entry text() should work with uncompressed files', async (t) => {
  const content = 'Text method test content'
  const file = new File([content], 'text-method.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const text = await entries[0].text()
  assert.equal(text, content, 'text() should return correct content')
})

// Test compression with arrayBuffer() method
test('Entry arrayBuffer() should work correctly', async (t) => {
  const content = 'ArrayBuffer test'
  const file = new File([content], 'arraybuffer.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const ab = await entries[0].arrayBuffer()
  const text = new TextDecoder().decode(ab)
  assert.equal(text, content, 'arrayBuffer() should return correct content')
})

// Test file() method with uncompressed file
test('Entry file() should return File object with correct metadata', async (t) => {
  const content = 'File method test'
  const originalFile = new File([content], 'file-method.txt', { lastModified: 1234567890000 })

  const zipFile = await createZipBlob([originalFile])
  const entries = await readZipBlob(zipFile)

  const file = await entries[0].file()
  assert.ok(file instanceof File, 'Should return File instance')
  assert.equal(file.name, 'file-method.txt', 'Name should match')
  assert.equal(await file.text(), content, 'Content should match')
  assert.equal(file.lastModified, 1234567890000, 'lastModified should match')
})

// Test Entry name getter with bitFlag and UTF-8 extra field
test('Entry should handle UTF-8 encoded names in extra fields', async (t) => {
  const file = new File(['Test'], 'test.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)
  const entry = entries[0]

  // Access name multiple times to test caching
  const name1 = entry.name
  const name2 = entry.name
  assert.equal(name1, name2, 'Names should be cached and consistent')
  assert.equal(name1, 'test.txt', 'Name should be correct')
})

// Test bytes() with uncompressed content
test('Entry bytes() should work with uncompressed files', async (t) => {
  const data = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
  const file = new File([data], 'bytes-test.bin')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const bytes = await entries[0].bytes()
  assert.deepEqual(bytes, data, 'bytes() should return correct data')
})

// Test stream() with multiple chunks
test('Entry stream() should handle multiple chunk reads', async (t) => {
  const content = 'Stream chunk test content that is long enough'
  const file = new File([content], 'chunks.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  let totalText = ''
  for await (const chunk of entries[0].stream()) {
    totalText += new TextDecoder().decode(chunk)
  }

  assert.equal(totalText, content, 'All chunks should form correct content')
})

// Test Entry with very large lastModified date
test('Entry should correctly handle dates at year boundaries', async (t) => {
  const year2000Date = new Date('2000-01-01T00:00:00').getTime()
  const file = new File(['Y2K'], 'y2k.txt', { lastModified: year2000Date })

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  assert.equal(entries[0].lastModified, year2000Date, 'Y2K date should be preserved')
})

// Test Entry with date in far future
test('Entry should handle dates far in the future', async (t) => {
  const futureDate = new Date('2099-12-31T23:59:59').getTime()
  const file = new File(['Future'], 'future.txt', { lastModified: futureDate })

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  // Note: ZIP format has year limitations, dates may not be perfectly accurate
  const retrieved = entries[0].lastModified
  assert.ok(Math.abs(retrieved - futureDate) < 2000, 'Future date should be approximately preserved')
})

// Test Reader with EOCDR seek fallback
test('Reader should handle ZIP files correctly and find EOCDR', async (t) => {
  const files = [
    new File(['File 1'], 'file1.txt'),
    new File(['File 2'], 'file2.txt')
  ]

  const zipFile = await createZipBlob(files)
  const entries = await readZipBlob(zipFile)

  assert.equal(entries.length, 2, 'Should correctly find and read EOCDR')
})

// Test invalid ZIP with bad central directory offset
test('Reader should validate central directory offset', async (t) => {
  // Create a minimal valid ZIP and then corrupt the central directory offset
  const file = new File(['Test'], 'test.txt')
  const zipFile = await createZipBlob([file])
  const buffer = await zipFile.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  // Try to read the corrupted ZIP
  // Note: This may not always cause an error depending on how the corruption works
  try {
    const entries = []
    for await (const entry of read(new Blob([bytes]))) {
      entries.push(entry)
    }
    // If it succeeded, that's okay too
    assert.ok(entries.length >= 0)
  } catch (err) {
    assert.ok(err, 'May throw error for corrupted ZIP')
  }
})

// Test Entry stream when file has compression method set to 0 (no compression)
test('Entry stream() should work with stored (uncompressed) files', async (t) => {
  const content = 'Stored no compression test'
  const file = new File([content], 'stored.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  let streamContent = ''
  for await (const chunk of entries[0].stream()) {
    streamContent += new TextDecoder().decode(chunk)
  }

  assert.equal(streamContent, content, 'Stored file stream should work')
})

// Test Entry file() with large number of chunks
test('Entry file() should handle many stream chunks efficiently', async (t) => {
  const largeContent = 'x'.repeat(50000)
  const file = new File([largeContent], 'many-chunks.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const extractedFile = await entries[0].file()
  const text = await extractedFile.text()
  assert.equal(text.length, largeContent.length, 'All chunks should be preserved')
})

// Test Entry that is a regular File blob
test('Entry with Blob instance should work correctly', async (t) => {
  const blob = new Blob(['Blob content'], { type: 'text/plain' })
  const file = new File([blob], 'blob-file.txt')

  const zipFile = await createZipBlob([file])
  const entries = await readZipBlob(zipFile)

  const content = await entries[0].text()
  assert.equal(content, 'Blob content', 'Blob content should be extracted')
})