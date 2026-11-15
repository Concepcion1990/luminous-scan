/**
 * The optimistic stepper queue (Nov 14, 2026 — owner live report:
 * the Products ▲▼ steppers "take a second to think" before the
 * number moves, because every tap waited for its movement round
 * trip). One queue per product+location:
 *
 *  - tap() moves the DISPLAY number immediately and enqueues the
 *    real ledger send behind the taps before it — sends run
 *    strictly in tap order, one honest movement per tap, exactly
 *    as the old single-flight stepper wrote them.
 *  - A send receives (delta, confirmed): the quantity the server
 *    had confirmed when this send's turn came. Relative sends
 *    (receive +1) ignore it; absolute sends (a correction to
 *    confirmed − 1) depend on it, which is why the order matters.
 *  - If a send fails, the rest of the queue is dead: later sends
 *    are skipped (their math assumed the failed one landed), the
 *    display rolls back to the last confirmed quantity, and
 *    onError fires once. When the queue drains, onDrain fires and
 *    the queue accepts taps again; a caller may also simply
 *    replace a dead queue — sends already chained against it run
 *    out as no-ops and never write state again.
 */
export function createStepQueue({ send, onDisplay, onError, onDrain }) {
  let confirmed = null;
  let display = null;
  let pending = 0;
  let dead = false;
  let chain = Promise.resolve();

  return {
    tap(delta, startValue) {
      if (dead) return false;
      if (confirmed === null) {
        confirmed = startValue;
        display = startValue;
      }
      if (display + delta < 0) return false;
      display += delta;
      pending += 1;
      onDisplay?.(display);
      chain = chain
        .then(async () => {
          if (dead) return;
          try {
            await send(delta, confirmed);
            confirmed += delta;
          } catch (err) {
            dead = true;
            display = confirmed;
            onDisplay?.(display);
            onError?.(err);
          }
        })
        .then(() => {
          pending -= 1;
          if (pending === 0) {
            dead = false;
            onDrain?.();
          }
        });
      return true;
    },
    get dead() {
      return dead;
    },
    get display() {
      return display;
    },
    get confirmed() {
      return confirmed;
    },
  };
}
