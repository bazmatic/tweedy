export const VALID_INLINE_TAGS = [
  'pause',
  'long-pause',
  'hum-tune',
  'laugh',
  'chuckle',
  'giggle',
  'cry',
  'tsk',
  'tongue-click',
  'lip-smack',
  'breath',
  'inhale',
  'exhale',
  'sigh',
];

export const VALID_WRAPPING_TAGS = [
  'soft',
  'whisper',
  'loud',
  'build-intensity',
  'decrease-intensity',
  'higher-pitch',
  'lower-pitch',
  'slow',
  'fast',
  'sing-song',
  'singing',
  'laugh-speak',
  'emphasis',
];

export const VALID_TAG_PATTERN = new RegExp(
  `\\[(?:${VALID_INLINE_TAGS.join('|')})\\]|</?(?:${VALID_WRAPPING_TAGS.join('|')})>`,
  'g'
);
