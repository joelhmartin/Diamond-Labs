/** Codes: NO_OPEN_DAYS | INVALID | NOT_FOUND | CONFLICT. */
export class CalendarError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CalendarError";
    this.code = code;
  }
}
