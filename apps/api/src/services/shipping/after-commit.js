/**
 * Work that follows a commit (logging, notices) can never fail the operation it
 * follows: it is awaited, but nothing it throws (nor onError) escapes.
 */
export async function afterCommit(fn, onError) {
  try {
    await fn();
  } catch (err) {
    try {
      onError?.(err);
    } catch {
      // a broken log sink must not reject after the state is saved
    }
  }
}
