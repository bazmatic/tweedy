const INLINE_TAG_TO_SSML: Record<string, string> = {
  pause: '<break time="300ms"/>',
  'long-pause': '<break time="900ms"/>',
};

const WRAPPING_TAG_TO_SSML: Record<string, { open: string; close: string }> = {
  slow: { open: '<prosody rate="slow">', close: '</prosody>' },
  fast: { open: '<prosody rate="fast">', close: '</prosody>' },
  'higher-pitch': { open: '<prosody pitch="+2st">', close: '</prosody>' },
  'lower-pitch': { open: '<prosody pitch="-2st">', close: '</prosody>' },
  soft: { open: '<prosody volume="soft">', close: '</prosody>' },
  loud: { open: '<prosody volume="loud">', close: '</prosody>' },
};

export const VALID_INLINE_TAGS = Object.keys(INLINE_TAG_TO_SSML);
export const VALID_WRAPPING_TAGS = Object.keys(WRAPPING_TAG_TO_SSML);

export const VALID_TAG_PATTERN = new RegExp(
  `\\[(?:${VALID_INLINE_TAGS.join('|')})\\]|</?(?:${VALID_WRAPPING_TAGS.join('|')})>`,
  'g'
);

const SPLIT_PATTERN = new RegExp(`(${VALID_TAG_PATTERN.source})`, 'g');

const INLINE_TAG_RE = new RegExp(`^\\[(${VALID_INLINE_TAGS.join('|')})\\]$`);
const WRAPPING_OPEN_RE = new RegExp(`^<(${VALID_WRAPPING_TAGS.join('|')})>$`);
const WRAPPING_CLOSE_RE = new RegExp(`^</(${VALID_WRAPPING_TAGS.join('|')})>$`);

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toSsml(tagged: string): string {
  const parts = tagged.split(SPLIT_PATTERN);
  const body = parts
    .map((part) => {
      if (!part) return '';

      const inlineMatch = part.match(INLINE_TAG_RE);
      if (inlineMatch) return INLINE_TAG_TO_SSML[inlineMatch[1]];

      const openMatch = part.match(WRAPPING_OPEN_RE);
      if (openMatch) return WRAPPING_TAG_TO_SSML[openMatch[1]].open;

      const closeMatch = part.match(WRAPPING_CLOSE_RE);
      if (closeMatch) return WRAPPING_TAG_TO_SSML[closeMatch[1]].close;

      return escapeXml(part);
    })
    .join('');

  return `<speak>${body}</speak>`;
}
