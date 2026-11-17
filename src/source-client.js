export class SourceClient {
  constructor(baseUrl) {
    const address = new URL(baseUrl);
    if (address.hostname !== '127.0.0.1') throw new Error('local source required');
    this.baseUrl = address;
  }

  async read(path, headers = {}) {
    const address = new URL(path, this.baseUrl);
    if (address.origin !== this.baseUrl.origin) throw new Error('source origin changed');
    const response = await fetch(address, { signal: AbortSignal.timeout(2000), headers });
    if (response.status === 304) {
      return { status: 304, text: '', contentType: response.headers.get('content-type'), etag: response.headers.get('etag') };
    }
    if (!response.ok) throw new Error(`source ${response.status}: ${path}`);
    return {
      status: response.status,
      text: await response.text(),
      contentType: response.headers.get('content-type'),
      etag: response.headers.get('etag'),
    };
  }
}
