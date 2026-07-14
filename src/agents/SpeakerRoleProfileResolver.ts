import {
  EpistemicRole,
  SpeakerRoleProfile,
} from "../types";
import { SpeakerRoleProfileFactory } from "./SpeakerRoleProfileFactory";

interface LegacyExpertiseCarrier {
  isExpert: boolean;
  roleProfile?: SpeakerRoleProfile;
}

/** Resolves new role profiles while keeping legacy `isExpert` records valid. */
export class SpeakerRoleProfileResolver {
  constructor(
    private readonly roleProfileFactory = new SpeakerRoleProfileFactory()
  ) {}

  resolve(
    speaker: LegacyExpertiseCarrier
  ): SpeakerRoleProfile {
    if (speaker.roleProfile) {
      return { ...speaker.roleProfile };
    }

    return this.roleProfileFactory.create(
      speaker.isExpert ? EpistemicRole.Expert : EpistemicRole.AudienceGuide
    );
  }
}
