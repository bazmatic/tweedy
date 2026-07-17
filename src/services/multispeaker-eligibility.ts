import { Speech, VocalProviderName } from "../types";
import { isMultispeakerCapable } from "../providers/MultispeakerVocalProviderFactory";

export interface MultispeakerEligibility {
  eligible: boolean;
  provider?: VocalProviderName;
  warning?: string;
}

export function checkMultispeakerEligibility(speeches: Speech[]): MultispeakerEligibility {
  const speakerIds = new Set(speeches.map((s) => s.speaker.id));
  if (speakerIds.size !== 2) {
    return { eligible: false };
  }

  const providers = new Set(speeches.map((s) => s.voice.provider));

  if (providers.size === 1) {
    const [onlyProvider] = providers;
    if (isMultispeakerCapable(onlyProvider)) {
      return { eligible: true, provider: onlyProvider };
    }
    return { eligible: false };
  }

  const multispeakerProviderUsed = [...providers].some(isMultispeakerCapable);
  if (!multispeakerProviderUsed) {
    return { eligible: false };
  }

  const offender = speeches.find((s) => !isMultispeakerCapable(s.voice.provider));
  return {
    eligible: false,
    warning: offender
      ? `Speaker "${offender.speaker.name}" uses voice provider "${offender.voice.provider}", which isn't multispeaker-capable — falling back to per-clip audio generation.`
      : "Speakers use different multispeaker-capable providers — falling back to per-clip audio generation.",
  };
}
