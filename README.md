# ZIP-go <img src="https://user-images.githubusercontent.com/1148376/183421896-8fea5bef-6d32-4f49-ab6c-f2fe7e6ac4ab.svg" width="20px" height="20px" title="This package contains built-in JSDoc declarations (...works as equally well as d.ts)" alt="JSDoc icon, indicating that this package has built-in type declarations">

`zip-go` was designed with the goal of saving multiple large files generated by
the browsers without holding any of the data in memory by streaming/piping data
to a destination. While the zip format isn't technically built for streaming and
each file entry needs some pre-header information that tells how large a file is
and what the crc checksum is... all of this can be stored in the central
directory header also at the end of a zip file...

## Install

`zip-go` is an ESM-only module - you are not able to import it with `require`. If you are unable to use ESM in your project you can use the async `import('zip-go')` from CommonJS to load `zip-go` asynchronously.<br>
`npm install zip-go`

## Requirements

- `BigInt` support
- `ReadableStream`
- `WritableStream`
- Reading compressed file entries requires [DecompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream#browser_compatibility)
- Reading a zip file entries is done with `Blob`-like objects. NodeJS users can
use [fs.openAsBlob](https://nodejs.org/dist/latest/docs/api/fs.html#fsopenasblobpath-options) or [fetch-blob](https://github.com/node-fetch/fetch-blob/)

It can't as of yet write zip files larger than 4 GiB as it has no zip64 support
but it can read those.

## Creating a ZIP

```js
import Writer from 'zip-go/lib/write.js'

const s3 = 'https://s3-us-west-2.amazonaws.com/bencmbrook/'
const files = ['NYT.txt', 'water.png', 'Earth.jpg'].values()

// Creates a regular ReadableStream that will pull file like objects
const myReadable = new ReadableStream({
  async pull(controller) {

    const { done, value } = files.next()
    if (done) return controller.close()
    const { body } = await fetch(s3 + value)

    return controller.enqueue({
      name: `/${value}`,
      stream: () => body,
    })

  },
})

myReadable
  .pipeThrough(new Writer())
```

if you would like to work it more manually you can do that as well.

```js
import Writer from 'zip-go/lib/write.js';

// Set up conflux
const { readable, writable } = new Writer();
const writer = writable.getWriter();

// Set up streamsaver
const fileStream = streamSaver.createWriteStream('conflux.zip');

// Add a WebIDL File like object that at least have name and a stream method
// that returns a whatwg ReadableStream
writer.write({
  name: '/cat.txt',
  lastModified: new Date(123),
  stream: () => new Response('mjau').body
})

readable.pipeTo(destination)

writer.close()
```

## Reading a zip

This read method only read the central directory (end of the file)
to figure out all about each entry. Each `Entry` returns a WebIDL `File` like
object with added properties that are more zip specific

```js
import read from 'zip-go/lib/reader.js'

for await (const entry of read(blob)) {
  console.log(entry)
  console.log(entry.name)
  console.log(entry.size)
  console.log(entry.type)
  console.log(entry.directory)

  const ab = await entry.arrayBuffer()
  const text = await entry.text()
  const readableStream = entry.stream()

  // returns a real web File Object, if the entry is uncompressed
  // it will just slice the zip with it's start/end position
  const file = await entry.file()
}
```
