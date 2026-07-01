import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { net } from 'electron'

export interface S3Config {
  bucket: string
  region: string
  accessKey: string
  secretKey: string
  endpoint?: string    // custom endpoint for S3-compatible (MinIO, Wasabi, B2)
  cdnUrl?: string      // optional CDN prefix
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function getSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate    = hmacSha256(`AWS4${secretKey}`, dateStamp)
  const kRegion  = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  return hmacSha256(kService, 'aws4_request')
}

function getEndpointUrl(config: S3Config): string {
  if (config.endpoint) {
    const ep = config.endpoint.replace(/\/$/, '')
    return `${ep}/${config.bucket}`
  }
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com`
}

function buildSignedHeaders(
  method: string,
  objectKey: string,
  payloadHash: string,
  config: S3Config,
  extraHeaders?: Record<string, string>
): { headers: Record<string, string>; datetime: string } {
  const now = new Date()
  const datetime = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const dateStamp = datetime.slice(0, 8)

  const host = config.endpoint
    ? new URL(getEndpointUrl(config)).host
    : `${config.bucket}.s3.${config.region}.amazonaws.com`

  const allHeaders: Record<string, string> = {
    'host': host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': datetime,
    ...extraHeaders,
  }

  const sortedKeys = Object.keys(allHeaders).sort()
  const canonicalHeaders = sortedKeys.map(k => `${k}:${allHeaders[k]}`).join('\n') + '\n'
  const signedHeaders = sortedKeys.join(';')

  const canonicalURI = '/' + objectKey.replace(/^\//, '')
  const canonicalRequest = [
    method,
    canonicalURI,
    '',   // no query params for PUT/DELETE
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = getSigningKey(config.secretKey, dateStamp, config.region, 's3')
  const signature = hmacSha256(signingKey, stringToSign).toString('hex')

  const authHeader = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    headers: { ...allHeaders, 'Authorization': authHeader },
    datetime,
  }
}

function netRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: Buffer
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = net.request({ method, url, redirect: 'follow' })
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() !== 'host') req.setHeader(k, v)
    }
    let resBody = ''
    req.on('response', (res) => {
      res.on('data', (d) => resBody += d.toString())
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: resBody }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

export async function uploadFile(
  localPath: string,
  key: string,
  config: S3Config,
  mimeType = 'application/octet-stream'
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const body = fs.readFileSync(localPath)
    const payloadHash = sha256Hex(body)
    const { headers } = buildSignedHeaders('PUT', key, payloadHash, config, {
      'content-type': mimeType,
      'content-length': String(body.length),
    })
    const baseUrl = getEndpointUrl(config)
    const url = `${baseUrl}/${key.replace(/^\//, '')}`
    const res = await netRequest('PUT', url, headers, body)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const publicUrl = config.cdnUrl
        ? `${config.cdnUrl.replace(/\/$/, '')}/${key}`
        : url
      return { success: true, url: publicUrl }
    }
    return { success: false, error: `S3 error ${res.statusCode}: ${res.body}` }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function deleteFile(
  key: string,
  config: S3Config
): Promise<{ success: boolean; error?: string }> {
  try {
    const payloadHash = sha256Hex('')
    const { headers } = buildSignedHeaders('DELETE', key, payloadHash, config)
    const baseUrl = getEndpointUrl(config)
    const url = `${baseUrl}/${key.replace(/^\//, '')}`
    const res = await netRequest('DELETE', url, headers)
    if (res.statusCode >= 200 && res.statusCode < 300) return { success: true }
    return { success: false, error: `S3 error ${res.statusCode}: ${res.body}` }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function testConnection(config: S3Config): Promise<{ success: boolean; error?: string }> {
  // HEAD request to test bucket access
  try {
    const payloadHash = sha256Hex('')
    const testKey = '.pos-erp-connection-test'
    const { headers } = buildSignedHeaders('HEAD', testKey, payloadHash, config)
    const baseUrl = getEndpointUrl(config)
    const url = `${baseUrl}/${testKey}`
    const res = await netRequest('HEAD', url, headers)
    // 200 or 404 means we can reach the bucket
    if (res.statusCode === 200 || res.statusCode === 404) return { success: true }
    if (res.statusCode === 403) return { success: false, error: 'Access denied — check your access key and bucket permissions' }
    return { success: false, error: `S3 error ${res.statusCode}: ${res.body}` }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export function getPublicUrl(key: string, config: S3Config): string {
  if (config.cdnUrl) return `${config.cdnUrl.replace(/\/$/, '')}/${key}`
  return `${getEndpointUrl(config)}/${key.replace(/^\//, '')}`
}

export function getS3KeyFromPath(filePath: string): string {
  return `pos-uploads/${path.basename(filePath)}`
}
