import {
  EpistemicRole,
  SpeakerRoleProfile,
} from "../types";
import { SpeakerRoleProfileFactory } from "./SpeakerRoleProfileFactory";

interface RoleProfileCarrier {
  roleProfile?: SpeakerRoleProfile;
}

/** Resolves a speaker's epistemic role for the current episode, defaulting to
 * audience-guide when DirectorAgent.assignSpeakerRoles has not yet run. */
export class SpeakerRoleProfileResolver {
  constructor(
    private readonly roleProfileFactory = new SpeakerRoleProfileFactory()
  ) {}

  resolve(speaker: RoleProfileCarrier): SpeakerRoleProfile {
    if (speaker.roleProfile) {
      return { ...speaker.roleProfile };
    }

    return this.roleProfileFactory.create(EpistemicRole.AudienceGuide);
  }
}
