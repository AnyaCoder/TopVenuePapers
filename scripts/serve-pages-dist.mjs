#!/usr/bin/env node
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const host = args.host ?? '127.0.0.1'
const port = Number(args.port ?? 4176)
const distDir = resolve(args.dist ?? 'dist')
const basePath = (args.base ?? '/TopVenuePapers/').replace(/\/+$/, '') || '/'

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', `http://${host}:${port}`)
    let pathname = decodeURIComponent(requestUrl.pathname)

    if (pathname === '/') {
      response.writeHead(302, { Location: `${basePath}/` })
      response.end()
      return
    }

    if (!pathname.startsWith(basePath)) {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    pathname = pathname.slice(basePath.length) || '/index.html'
    const relativePath = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html'
    const filePath = resolve(join(distDir, relativePath))

    if (!filePath.startsWith(distDir)) {
      response.writeHead(403)
      response.end('Forbidden')
      return
    }

    try {
      const body = await readFile(filePath)
      response.writeHead(200, {
        'Content-Type': getContentType(filePath),
        'Content-Length': body.length,
      })
      response.end(body)
    } catch {
      const indexPath = join(distDir, 'index.html')
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      createReadStream(indexPath).pipe(response)
    }
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end(error instanceof Error ? error.message : String(error))
  }
})

server.listen(port, host, () => {
  console.log(`Pages dist server listening on http://${host}:${port}${basePath}/`)
})

function getContentType(filePath) {
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.bin': 'application/octet-stream',
  }

  return types[extname(filePath)] ?? 'application/octet-stream'
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--host') {
      parsed.host = argv[++index]
    } else if (arg === '--port') {
      parsed.port = argv[++index]
    } else if (arg === '--dist') {
      parsed.dist = argv[++index]
    } else if (arg === '--base') {
      parsed.base = argv[++index]
    } else if (arg === '--help') {
      printHelpAndExit()
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

function printHelpAndExit() {
  console.log(`
Usage:
  node scripts/serve-pages-dist.mjs [options]

Options:
  --host <host>   Default: 127.0.0.1.
  --port <port>   Default: 4176.
  --dist <dir>    Default: dist.
  --base <path>   Default: /TopVenuePapers/.
`)
  process.exit(0)
}
