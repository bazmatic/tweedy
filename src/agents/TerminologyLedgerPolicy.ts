import {
  PodcastScript,
  ReviewedTechnicalTerm,
  Speech,
  TerminologyLedger,
} from "../types";

const TERM_BOUNDARY = /[^a-z0-9]+/g;

/** Records validated first-use explanations after a turn has been accepted. */
export class TerminologyLedgerPolicy {
  createLedger(): TerminologyLedger {
    return { explainedTerms: [] };
  }

  recordAcceptedTurn(script: PodcastScript, speech: Speech): void {
    if (speech.review && !speech.review.accepted) return;

    const ledger = script.terminologyLedger ?? this.createLedger();
    script.terminologyLedger = ledger;

    for (const reviewedTerm of speech.review?.introducedTerms ?? []) {
      if (!this.isValidExplanation(speech.message, reviewedTerm, ledger)) {
        continue;
      }
      ledger.explainedTerms.push({
        term: reviewedTerm.term.trim(),
        plainLanguageMeaning: reviewedTerm.plainLanguageMeaning.trim(),
        explainedBySpeakerId: speech.speaker.id,
        explainedAtTurn: script.speeches.length + 1,
      });
    }
  }

  private isValidExplanation(
    message: string,
    reviewedTerm: ReviewedTechnicalTerm,
    ledger: TerminologyLedger
  ): boolean {
    const normalisedTerm = this.normalise(reviewedTerm.term);
    if (
      normalisedTerm.length === 0 ||
      reviewedTerm.plainLanguageMeaning.trim().length === 0
    ) {
      return false;
    }

    const normalisedMessage = ` ${this.normalise(message)} `;
    const termWords = normalisedTerm.split(" ").filter(Boolean);
    const allWordsPresent = termWords.every((word) =>
      normalisedMessage.includes(` ${word} `) ||
      normalisedMessage.includes(` ${word}s `) ||
      normalisedMessage.includes(` ${word.replace(/s$/, "")} `)
    );
    if (!allWordsPresent) return false;

    return !ledger.explainedTerms.some(
      (entry) => this.normalise(entry.term) === normalisedTerm
    );
  }

  private normalise(value: string): string {
    return value.toLowerCase().replace(TERM_BOUNDARY, " ").trim();
  }
}
