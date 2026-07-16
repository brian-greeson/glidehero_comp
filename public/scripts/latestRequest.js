export function createLatestRequest(
  task,
  { AbortControllerImpl = globalThis.AbortController } = {},
) {
  let sequence = 0;
  let abortController;

  return {
    cancel() {
      sequence += 1;
      abortController?.abort();
      abortController = undefined;
    },

    async run(...args) {
      abortController?.abort();
      const requestSequence = ++sequence;
      const controller = AbortControllerImpl ? new AbortControllerImpl() : undefined;
      abortController = controller;

      try {
        return await task({
          signal: controller?.signal,
          isCurrent: () => requestSequence === sequence,
        }, ...args);
      } finally {
        if (requestSequence === sequence) abortController = undefined;
      }
    },
  };
}
