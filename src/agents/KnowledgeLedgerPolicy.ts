import {
  EditorialCard,
  KnowledgeLedger,
  KnowledgeSource,
  PodcastScript,
  SourceAccess,
  Speaker,
  Speech,
} from "../types";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";

/** Controls which prepared facts each speaker can use and records accepted introductions. */
export class KnowledgeLedgerPolicy {
  constructor(
    private readonly roleProfileResolver = new SpeakerRoleProfileResolver()
  ) {}

  createLedger(): KnowledgeLedger {
    return { introducedCards: [] };
  }

  getAccessibleCards(
    speaker: Speaker,
    cards: EditorialCard[],
    ledger: KnowledgeLedger,
    assignedCardIds: string[]
  ): EditorialCard[] {
    return cards.filter((card) =>
      this.canAccessCard(speaker, card.id, ledger, assignedCardIds)
    );
  }

  canAccessCard(
    speaker: Speaker,
    cardId: string,
    ledger: KnowledgeLedger,
    assignedCardIds: string[]
  ): boolean {
    const profile = this.roleProfileResolver.resolve(speaker);
    if (profile.sourceAccess === SourceAccess.Full) return true;

    const introduced = ledger.introducedCards.some(
      (entry) => entry.cardId === cardId
    );
    if (introduced) return true;

    return (
      profile.sourceAccess === SourceAccess.PreparedCards &&
      assignedCardIds.includes(cardId)
    );
  }

  recordAcceptedTurn(script: PodcastScript, speech: Speech): void {
    if (speech.review && !speech.review.accepted) return;

    const assignedCardIds = new Set(speech.turnBrief?.cardIds ?? []);
    const knownCardIds = new Set(
      (script.editorialCards ?? []).map((card) => card.id)
    );
    const ledger = script.knowledgeLedger ?? this.createLedger();
    script.knowledgeLedger = ledger;
    const cardIds = (speech.review?.introducedCardIds ?? []).filter(
      (cardId) =>
        assignedCardIds.has(cardId) &&
        knownCardIds.has(cardId) &&
        this.canAccessCard(
          speech.speaker,
          cardId,
          ledger,
          speech.turnBrief?.cardIds ?? []
        )
    );
    if (cardIds.length === 0) return;

    const profile = this.roleProfileResolver.resolve(speech.speaker);
    const source =
      speech.turnBrief?.knowledgeSource ??
      (profile.sourceAccess === SourceAccess.Full
        ? KnowledgeSource.SourceMaterial
        : KnowledgeSource.PreparedCard);

    for (const cardId of cardIds) {
      if (ledger.introducedCards.some((entry) => entry.cardId === cardId)) {
        continue;
      }
      ledger.introducedCards.push({
        cardId,
        introducedBySpeakerId: speech.speaker.id,
        introducedAtTurn: script.speeches.length + 1,
        source,
      });
    }
  }
}
