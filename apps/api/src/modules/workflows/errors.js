/** Codes: INVALID | NOT_FOUND | CONFLICT. */
export class WorkflowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
  }
}
