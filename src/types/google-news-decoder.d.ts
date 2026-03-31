declare module 'google-news-decoder' {
  class GoogleNewsDecoder {
    decodeGoogleNewsUrl(url: string): Promise<{ status: boolean; decodedUrl?: string }>
  }
  export default GoogleNewsDecoder
}
