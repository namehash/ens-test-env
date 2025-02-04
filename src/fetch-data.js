#!/usr/bin/env node

import cliProgress from 'cli-progress'
/* eslint-disable */
import colors from 'picocolors'
import 'dotenv/config'
import fs from 'node:fs'
import { pipeline as streamPipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { createProgressStream } from 'dunai/progress'
import tar from 'tar-fs'

const createProgressBar = (name, hasSpeed) =>
  new cliProgress.SingleBar({
    format: `${name} Progress |${colors.cyan('{bar}')}| {percentage}% || {value}/{total} GB${hasSpeed ? ' || Speed: {speed} MB/s' : ''}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    fps: 5,
    formatValue: (value, _, type) => {
      switch (type) {
        case 'value':
          return bytesToGb(value).toFixed(2)
        case 'total':
          return bytesToGb(value).toFixed(2)
        default:
          return value
      }
    },
  })

const extractProgressBar = createProgressBar('Extract', true)
const compressProgressBar = createProgressBar('Compress', false)

let localPath
let dataPath

const streamOpts = {
  highWaterMark: 67108864, // 64MB
}

const bytesToGb = (bytes) => bytes * 9.3132257461548e-10
const bytesToMb = (bytes) => bytes * 9.5367431640625e-7

async function compressToArchive() {
  // biome-ignore lint/suspicious/noAsyncPromiseExecutor: idk how to fix yet
  return new Promise(async (resolve, reject) => {
    let initial = true
    const encoder = createGzip()
    const output = fs.createWriteStream(`${localPath}.tar.gz`, streamOpts)
    const archive = tar.pack(dataPath)
    const progressStream = createProgressStream({})

    progressStream.on('progress', (progress) => {
      if (initial) {
        compressProgressBar.start(progress.length, 0, {
          speed: 'N/A',
        })
        initial = false
      } else {
        compressProgressBar.update(progress.transferred, {
          speed: bytesToMb(progress.speed).toFixed(2),
        })
      }
    })

    compressProgressBar.start()
    await streamPipeline(archive, encoder, output)
      .then(() => {
        compressProgressBar.stop()
        resolve()
      })
      .catch((err) => {
        compressProgressBar.stop()
        reject(err.message)
      })
  })
}

async function decompressToOutput() {
  // biome-ignore lint/suspicious/noAsyncPromiseExecutor: idk how to fix it yet
  return new Promise(async (resolve, reject) => {
    if (fs.existsSync(dataPath))
      await fs.promises.rm(dataPath, { recursive: true, force: true })

    const archiveSize = fs.statSync(`${localPath}.tar.gz`).size
    const unarchiver = tar.extract(dataPath)
    const decoder = createGunzip()
    const input = fs.createReadStream(`${localPath}.tar.gz`, streamOpts)
    const progressStream = createProgressStream({})

    extractProgressBar.start(archiveSize, 0, {
      speed: 'N/A',
    })

    progressStream.on('progress', (progress) => {
      extractProgressBar.update(progress.transferred, {
        speed: bytesToMb(progress.speed).toFixed(2),
      })
    })

    await streamPipeline(input, progressStream, decoder, unarchiver)
      .then(() => {
        extractProgressBar.stop()
        resolve()
      })
      .catch((err) => {
        extractProgressBar.stop()
        reject(err.message)
      })

    const readMePath = `${dataPath}/ipfs/blocks/_README`
    if (fs.existsSync(readMePath)) {
      await fs.promises.rm(readMePath, { force: true })
    }
  })
}

export const main = async (arg, config) => {
  const time = Date.now()

  localPath = config.paths.archive
  dataPath = config.paths.data

  const logTime = (message) =>
    console.log(`${message} ${(Date.now() - time) / 1000}s`)

  switch (arg) {
    case 'load': {
      await decompressToOutput().then(() =>
        logTime('Decompressed and copied in'),
      )
      return
    }
    case 'compress': {
      console.log('Compressing /data to archive.tar.gz...')
      await compressToArchive().then(() => logTime('Compressed archive in'))
      return
    }
    case 'clean': {
      console.log('Cleaning data directory...')
      await fs.promises.rm(dataPath, { force: true, recursive: true })
      await fs.promises.mkdir(dataPath)
      return
    }
  }
}
