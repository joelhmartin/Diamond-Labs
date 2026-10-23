/**
 * A piece-5 import guard refused to run: wrong or unconfirmed target, Cloud Run,
 * a PHI key mismatch, an unapproved request count, a bad flag. CLIs print the
 * message (never a stack) and exit 2. Messages never carry record contents.
 */
export class ImportRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportRefusal";
  }
}
