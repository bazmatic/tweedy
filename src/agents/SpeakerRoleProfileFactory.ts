import {
  EpistemicRole,
  SourceAccess,
  SpeakerRoleProfile,
  UncertaintyStyle,
} from "../types";

const ROLE_PROFILE_DEFAULTS: Readonly<
  Record<EpistemicRole, Readonly<SpeakerRoleProfile>>
> = Object.freeze({
  [EpistemicRole.Expert]: Object.freeze({
    epistemicRole: EpistemicRole.Expert,
    sourceAccess: SourceAccess.Full,
    uncertaintyStyle: UncertaintyStyle.Precise,
  }),
  [EpistemicRole.InformedHost]: Object.freeze({
    epistemicRole: EpistemicRole.InformedHost,
    sourceAccess: SourceAccess.PreparedCards,
    uncertaintyStyle: UncertaintyStyle.Exploratory,
  }),
  [EpistemicRole.AudienceGuide]: Object.freeze({
    epistemicRole: EpistemicRole.AudienceGuide,
    sourceAccess: SourceAccess.HeardOnly,
    uncertaintyStyle: UncertaintyStyle.ListenerSurrogate,
  }),
});

export class SpeakerRoleProfileFactory {
  create(epistemicRole: EpistemicRole): SpeakerRoleProfile {
    return { ...ROLE_PROFILE_DEFAULTS[epistemicRole] };
  }
}
