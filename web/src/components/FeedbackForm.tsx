import { useState } from "react";
import {
  FEEDBACK_FIELDS,
  FEEDBACK_FORM_ID,
  feedbackFormUrl,
  feedbackPostUrl,
} from "../lib/config";

/**
 * Five questions, posted to a Google Form by this page's own form rather than
 * an embedded one, so nothing third-party loads until someone presses Send.
 */

const CHOICES = {
  developer: ["Yes", "No", "Somewhat"],
  worked: ["Yes", "No", "Partly"],
} as const;

type Answers = {
  developer: string;
  worked: string;
  whatHappened: string;
  confusing: string;
  believed: string;
};

const EMPTY: Answers = {
  developer: "",
  worked: "",
  whatHappened: "",
  confusing: "",
  believed: "",
};

function Choice({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-note font-semibold">{legend}</legend>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected ? "" : option)}
              className={`min-h-11 rounded-full border px-4 text-note font-semibold transition-colors ${
                selected
                  ? "border-ink bg-ink text-paper"
                  : "border-hairline text-body hover:border-ink"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Written({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-note font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-lg border border-hairline bg-white px-3.5 py-2.5 text-note outline-none focus:border-ink"
      />
    </div>
  );
}

export function FeedbackForm() {
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(false);

  if (!FEEDBACK_FORM_ID) return null;

  const set = (key: keyof Answers) => (value: string) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));

  const anyAnswered = Object.values(answers).some((v) => v.trim() !== "");

  async function send() {
    if (!FEEDBACK_FORM_ID) return;
    const body = new FormData();
    for (const [key, field] of Object.entries(FEEDBACK_FIELDS)) {
      const value = answers[key as keyof Answers].trim();
      if (value !== "") body.append(field, value);
    }

    // `no-cors` because the endpoint sends no CORS headers: the post lands but
    // the response is unreadable, so there is no success to wait for. Hence the
    // thanks below being unconditional.
    try {
      await fetch(feedbackPostUrl(FEEDBACK_FORM_ID), {
        method: "POST",
        mode: "no-cors",
        body,
      });
    } catch {
      // Costs one answer. Saying so would imply the unlock was affected.
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="mt-7 border-t border-hairline pt-6">
        <p className="text-note font-semibold">Thank you, that is sent.</p>
        <p className="mt-2 text-note text-muted">
          What people find confusing here is what gets rewritten next.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="mt-7 border-t border-hairline pt-6">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center rounded-lg bg-ink px-5.5 py-3.5 text-copy font-semibold text-paper transition-colors hover:bg-public"
        >
          Tell me what you made of this
        </button>
        <p className="mt-3 text-note text-muted">
          Five short questions, right here, no account needed. I read every
          answer, and what people find confusing is what gets rewritten next.
        </p>
      </div>
    );
  }

  return (
    <form
      className="mt-7 flex flex-col gap-5 border-t border-hairline pt-6"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <p className="text-note text-muted">
        Answer as much or as little as you like. Nothing here is required, and
        the first question is the one I most need.
      </p>

      <Choice
        legend="Are you a developer?"
        options={CHOICES.developer}
        value={answers.developer}
        onChange={set("developer")}
      />
      <Choice
        legend="Did it work for you?"
        options={CHOICES.worked}
        value={answers.worked}
        onChange={set("worked")}
      />
      <Written
        id="fb-what"
        label="In your own words, what do you think it just did?"
        value={answers.whatHappened}
        onChange={set("whatHappened")}
      />
      <Written
        id="fb-confusing"
        label="Was anything confusing?"
        value={answers.confusing}
        onChange={set("confusing")}
      />
      <Written
        id="fb-believed"
        label="Did you believe a real transaction happened? What made you believe it, or doubt it?"
        value={answers.believed}
        onChange={set("believed")}
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="submit"
          disabled={!anyAnswered}
          className="inline-flex items-center justify-center rounded-lg bg-ink px-5.5 py-3.5 text-copy font-semibold text-paper transition-colors hover:bg-public disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
        <a
          href={feedbackFormUrl(FEEDBACK_FORM_ID)}
          target="_blank"
          rel="noreferrer"
          className="text-note text-muted underline hover:text-body"
        >
          or open it on Google Forms instead
        </a>
      </div>
    </form>
  );
}
