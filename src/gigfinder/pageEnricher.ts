// Generic page enricher — given an HTTP URL, fetch it and extract Open Graph
// metadata + venue/event/contact hints. Site-agnostic. Used to turn shallow
// DDG snippets into deeper Candidate data.

export interface EnrichedPage {
  url: string
  finalUrl: string           // after redirects
  ogTitle?: string
  ogDescription?: string
  ogImage?: string
  ogSiteName?: string
  ogType?: string            // "website", "article", "event", "profile"
  pageTitle?: string
  emails: string[]
  phones: string[]
  instagramHandles: string[]
  facebookPages: string[]
  externalLinks: string[]    // other domains linked from the page (potential leads)
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function extractMeta(html: string, property: string): string | undefined {
  // Handle either `property="og:title"` or `name="description"` variants
  const re = new RegExp(`<meta[^>]+(?:property|name)="${property}"[^>]+content="([^"]+)"`, 'i')
  const alt = new RegExp(`<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="${property}"`, 'i')
  const m = re.exec(html) ?? alt.exec(html)
  return m ? decodeEntities(m[1]) : undefined
}

function unique<T>(arr: T[]): T[] { return [...new Set(arr)] }

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const PHONE_RE = /(?:\+972|0)[\s\-]?(?:\d[\s\-]?){8,9}/g
const IG_HANDLE_RE = /instagram\.com\/([a-zA-Z0-9._]{2,30})(?:[/"?]|$)/gi
const FB_PAGE_RE = /facebook\.com\/(?:p\/[^/"]+|pg\/[a-zA-Z0-9.]{2,60}|[a-zA-Z0-9.]{2,60})(?:[/"?]|$)/gi

const IG_HANDLE_SKIP = new Set(['p', 'tv', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct', 'about', 'developer'])

function extractContacts(html: string) {
  const emails = unique(html.match(EMAIL_RE) ?? [])
    .filter(e => !/example|yourname|sentry|wixpress|w\.org|@2x|\.png|\.jpg|\.svg/i.test(e))
    .slice(0, 5)

  const phones = unique(html.match(PHONE_RE) ?? [])
    .map(p => p.replace(/\s+/g, ' ').trim())
    .slice(0, 3)

  const instagramHandles = unique(
    [...html.matchAll(IG_HANDLE_RE)]
      .map(m => m[1].toLowerCase())
      .filter(h => !IG_HANDLE_SKIP.has(h))
  ).slice(0, 6)

  const facebookPages = unique(
    [...html.matchAll(FB_PAGE_RE)]
      .map(m => m[0].replace(/[/"?]$/, ''))
  ).slice(0, 4)

  return { emails, phones, instagramHandles, facebookPages }
}

function extractExternalLinks(html: string, currentHost: string): string[] {
  const hosts = new Set<string>()
  const re = /href="(https?:\/\/([^/"]+)[^"]*)"/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const host = m[2].toLowerCase()
    if (host === currentHost) continue
    if (host.includes('google.com') || host.includes('cloudflare.com') || host.includes('gstatic') || host.includes('googleapis')) continue
    if (host.includes('doubleclick') || host.includes('facebook.com/tr') || host.includes('analytics')) continue
    hosts.add(host)
    if (hosts.size >= 15) break
  }
  return [...hosts]
}

/**
 * Fetch a URL and pull structured metadata out of the HTML.
 * Returns null if the fetch fails or returns non-HTML content.
 */
export async function enrichPage(url: string, timeoutMs = 12000): Promise<EnrichedPage | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const resp = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!resp.ok) return null
    const contentType = resp.headers.get('content-type') ?? ''
    if (!contentType.includes('html')) return null
    const html = await resp.text()
    if (!html || html.length < 200) return null

    const titleMatch = /<title[^>]*>([^<]{2,300})<\/title>/i.exec(html)
    const contacts = extractContacts(html)
    let currentHost = ''
    try { currentHost = new URL(resp.url).hostname.replace(/^www\./, '') } catch { /* ignore */ }

    return {
      url,
      finalUrl: resp.url,
      ogTitle: extractMeta(html, 'og:title'),
      ogDescription: extractMeta(html, 'og:description') ?? extractMeta(html, 'description'),
      ogImage: extractMeta(html, 'og:image'),
      ogSiteName: extractMeta(html, 'og:site_name'),
      ogType: extractMeta(html, 'og:type'),
      pageTitle: titleMatch ? decodeEntities(titleMatch[1]).trim() : undefined,
      ...contacts,
      externalLinks: extractExternalLinks(html, currentHost),
    }
  } catch {
    return null
  }
}

/**
 * Given an OG title like "Bomboclaat @ Kuli Alma" or "Party Name – Venue Name",
 * try to split into (party, venue). Returns { venue: title } if no separator found.
 *
 * Separator conventions:
 *  - "Event @ Venue"  → venue is on the RIGHT (@ is a location marker)
 *  - "Event at Venue" → venue is on the RIGHT
 *  - "Venue | Tagline" → venue is on the LEFT (| separates name from site tagline)
 *  - "Venue - Tagline" → venue is on the LEFT
 *  - "Venue – Tagline" → venue is on the LEFT (em-dash used as subtitle separator)
 *
 * For |, - and – separators: if the LEFT segment is shorter and looks like a name
 * (not a description), take the left side as venue name.
 */
export function splitTitleForVenue(title: string): { party?: string; venue: string } {
  // @ and "at" reliably mean "event AT venue" — venue is on the right
  const atSeparators: RegExp[] = [/\s+@\s+/, /\s+at\s+/i]
  for (const sep of atSeparators) {
    const parts = title.split(sep)
    if (parts.length === 2 && parts[1].length >= 3 && parts[1].length <= 80) {
      return { party: parts[0].trim(), venue: parts[1].trim() }
    }
  }

  // |, – and - are website title separators: "Venue Name | Site tagline"
  // Take the LEFT segment as the venue name (usually shorter and more specific)
  const titleSeparators: RegExp[] = [/\s+\|\s+/, /\s+[—–]\s+/, /\s+-\s+/]
  for (const sep of titleSeparators) {
    const parts = title.split(sep)
    if (parts.length >= 2) {
      const left = parts[0].trim()
      if (left.length >= 3 && left.length <= 60) {
        return { venue: left }
      }
    }
  }

  return { venue: title.trim() }
}
