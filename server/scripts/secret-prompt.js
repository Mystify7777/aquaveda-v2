/**
 * Hidden terminal input for secrets (#110).
 *
 * Reads one line from a TTY in raw mode and never writes the typed characters
 * (not even a mask) to the output stream. Raw mode is restored on every exit
 * path: submit, Ctrl+C, Ctrl+D on empty input, stream error/end, SIGINT/SIGTERM/
 * SIGHUP, and (synchronously) process `exit`.
 *
 * Streams and the process object are injectable so behaviour is testable
 * without a real terminal.
 */
import { StringDecoder } from "node:string_decoder";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";

/** Fixed operator-facing texts. PromptAborted never carries caller- or stream-supplied text. */
const ABORT_MESSAGES = Object.freeze({
  not_tty: "hidden input requires an interactive terminal (TTY)",
  no_echo_control: "could not disable terminal echo; refusing to read secret",
  interrupted: "interrupted",
  eof: "end of input",
  closed: "input closed before a line was entered",
  input_error: "input failed",
  SIGINT: "terminated by SIGINT",
  SIGTERM: "terminated by SIGTERM",
  SIGHUP: "terminated by SIGHUP",
});

export class PromptAborted extends Error {
  /** @param {keyof typeof ABORT_MESSAGES} reason */
  constructor(reason) {
    super(ABORT_MESSAGES[reason] ?? "input aborted");
    this.name = "PromptAborted";
    this.reason = Object.hasOwn(ABORT_MESSAGES, reason) ? reason : "unknown";
  }
}

const ABORT_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

/**
 * @param {string} query Prompt text (must not contain secrets).
 * @param {{ input?: any, output?: any, proc?: NodeJS.EventEmitter }} [io]
 * @returns {Promise<string>} The line typed, without the terminating newline and
 *   without any trimming.
 */
export function promptHidden(
  query,
  { input = defaultInput, output = defaultOutput, proc = process } = {},
) {
  if (!input?.isTTY || typeof input.setRawMode !== "function") {
    // Never fall back to an echoing read.
    return Promise.reject(
      new PromptAborted("not_tty"),
    );
  }

  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw === true;
    const decoder = new StringDecoder("utf8");
    /** @type {string[]} */
    let chars = [];
    let escState = 0; // 0 none, 1 after ESC, 2 inside CSI sequence
    let settled = false;
    let rawEnabled = false;
    const signalHandlers = new Map();

    const restoreRawSync = () => {
      if (!rawEnabled) return;
      try {
        input.setRawMode(wasRaw);
      } catch {
        // best effort; nothing safe left to do
      }
      rawEnabled = false;
    };

    const cleanup = () => {
      input.off("data", onData);
      input.off("error", onError);
      input.off("end", onEnd);
      input.off("close", onEnd);
      proc.off("exit", restoreRawSync);
      for (const [sig, handler] of signalHandlers) proc.off(sig, handler);
      signalHandlers.clear();
      restoreRawSync();
      try {
        input.pause();
      } catch {
        // ignore
      }
      chars = [];
    };

    const write = (text) => {
      try {
        output.write(text);
      } catch {
        // output failure must not strand the terminal in raw mode
      }
    };

    const finish = (fn, value, { newline = true } = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (newline) write("\n");
      fn(value);
    };

    const abort = (reason) => finish(reject, new PromptAborted(reason));

    // Stream error details are intentionally discarded: fixed message only.
    function onError() {
      finish(reject, new PromptAborted("input_error"), { newline: false });
    }
    function onEnd() {
      abort("closed");
    }

    function onData(chunk) {
      const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
      for (const ch of text) {
        if (settled) return;

        if (escState === 1) {
          escState = ch === "[" ? 2 : 0;
          continue;
        }
        if (escState === 2) {
          // CSI ends on a final byte in 0x40-0x7e
          if (ch >= "@" && ch <= "~") escState = 0;
          continue;
        }

        switch (ch) {
          case "\r":
          case "\n":
            finish(resolve, chars.join(""));
            return;
          case "\u0003":
            abort("interrupted");
            return;
          case "\u0004":
            if (chars.length === 0) {
              abort("eof");
              return;
            }
            break;
          case "\u007f":
          case "\b":
            chars.pop();
            break;
          case "\u0015":
            chars = [];
            break;
          case "\u001b":
            escState = 1;
            break;
          default:
            if (ch >= " ") chars.push(ch);
        }
      }
    }

    try {
      input.setRawMode(true);
      rawEnabled = true;
    } catch {
      reject(new PromptAborted("no_echo_control"));
      return;
    }

    proc.once("exit", restoreRawSync);
    for (const sig of ABORT_SIGNALS) {
      const handler = () => {
        abort(sig);
        // Signal contract: restore the terminal first (done by abort), then
        // re-raise so the process keeps its normal termination semantics. Our
        // listener is already removed, so with no other listener the default
        // action (terminate) applies. Deferred so the rejection is delivered
        // to the caller before the process goes down.
        setImmediate(() => proc.kill(proc.pid, sig));
      };
      signalHandlers.set(sig, handler);
      proc.once(sig, handler);
    }
    input.on("data", onData);
    input.on("error", onError);
    input.on("end", onEnd);
    input.on("close", onEnd);
    write(query);
    input.resume();
  });
}
