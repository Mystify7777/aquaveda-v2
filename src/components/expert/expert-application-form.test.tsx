import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExpertApplicationForm } from "@/components/expert/expert-application-form";
import { ACKNOWLEDGEMENT_TEXTS, CURRENT_ACKNOWLEDGEMENT_VERSION } from "@/lib/expert/submission-contract";
import { emptyDraft, type SubmissionDraft } from "@/lib/expert/submission-form";

const EXPERIENCE = "Ten years of borewell recharge monitoring across three districts, with community training.";

function setup(props: Partial<React.ComponentProps<typeof ExpertApplicationForm>> = {}) {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  render(<ExpertApplicationForm pending={false} failure={null} submitLabel="Submit application" onSubmit={onSubmit} {...props} />);
  return { user, onSubmit };
}
const submit = () => screen.getByRole("button", { name: /^(submit application|submitting|apply again)/i });

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("checkbox", { name: /groundwater and wells/i }));
  await user.type(screen.getByLabelText(/what have you worked on/i), EXPERIENCE);
  await user.click(screen.getByRole("checkbox", { name: /i confirm that the information/i }));
}

describe("ExpertApplicationForm", () => {
  it("shows the acknowledgement VERBATIM from the contract, beside its checkbox, under the agreement lead-in; unchecked by default", () => {
    setup();
    expect(screen.getByText("By submitting this application you agree to:")).toBeInTheDocument();
    const box = screen.getByRole("checkbox", { name: ACKNOWLEDGEMENT_TEXTS[CURRENT_ACKNOWLEDGEMENT_VERSION as 1] });
    expect(box).not.toBeChecked();
  });

  it("submitting an empty form shows field errors, an alert summary, and moves focus to the first invalid control; nothing is sent", async () => {
    const { user, onSubmit } = setup();
    await user.click(submit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/3 highlighted fields/);
    expect(screen.getByText(/select between 1 and 3 areas/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 80 characters/i, { selector: "p.text-destructive" })).toBeInTheDocument();
    expect(screen.getByText(/acknowledgement must be accepted/i)).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")[0]).toHaveFocus(); // first area checkbox
  });

  it("errors stay truthful as the user fixes fields after a failed attempt", async () => {
    const { user } = setup();
    await user.click(submit());
    await user.click(screen.getByRole("checkbox", { name: /groundwater and wells/i }));
    expect(screen.queryByText(/select between 1 and 3 areas/i)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/2 highlighted fields/);
  });

  it("a valid form sends the normalized request with only the acknowledgement VERSION", async () => {
    const { user, onSubmit } = setup();
    await fillValid(user);
    await user.type(screen.getByLabelText(/organisation or affiliation/i), "  River Trust  ");
    await user.click(submit());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      expertiseAreas: ["groundwater_wells"],
      experience: EXPERIENCE,
      affiliation: "River Trust",
      references: [],
      acknowledgement: { version: CURRENT_ACKNOWLEDGEMENT_VERSION },
    });
  });

  it("at most 3 areas: the others become disabled, and unticking re-enables them; a live count is shown", async () => {
    const { user } = setup();
    for (const name of [/groundwater and wells/i, /supply and distribution/i, /wastewater and sanitation/i]) {
      await user.click(screen.getByRole("checkbox", { name }));
    }
    expect(screen.getByText("3/3 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /policy and governance/i })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /wastewater and sanitation/i }));
    expect(screen.getByRole("checkbox", { name: /policy and governance/i })).toBeEnabled();
    expect(screen.getByText("2/3 selected")).toBeInTheDocument();
  });

  it("shows the experience counter against the contract's limits", async () => {
    const { user } = setup();
    expect(screen.getByText(/0\/1000 characters, at least 80/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/what have you worked on/i), "  hello  ");
    expect(screen.getByText(/5\/1000 characters/)).toBeInTheDocument(); // trimmed length
  });

  it("references: add/remove rows, capped at 3, blank rows are not sent", async () => {
    const { user, onSubmit } = setup();
    const add = screen.getByRole("button", { name: /add a reference/i });
    await user.click(add);
    await user.click(add);
    await user.click(add);
    expect(add).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /remove reference/i })).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Remove reference 2" }));
    expect(add).toBeEnabled();
    await user.type(screen.getByLabelText("Reference 1"), "https://example.org/a");
    await fillValid(user);
    await user.click(submit());
    expect(onSubmit.mock.calls[0][0].references).toEqual(["https://example.org/a"]);
  });

  it("a non-https reference is reported on ITS row and focus goes there", async () => {
    const { user, onSubmit } = setup();
    await user.click(screen.getByRole("button", { name: /add a reference/i }));
    await user.type(screen.getByLabelText("Reference 1"), "http://insecure.org");
    await fillValid(user);
    await user.click(submit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/reference 1 must use https/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Reference 1")).toHaveFocus();
    expect(screen.getByLabelText("Reference 1")).toHaveAttribute("aria-invalid", "true");
  });

  it("prefilled drafts show the previous answers but the acknowledgement must be accepted again", async () => {
    const initial: SubmissionDraft = {
      ...emptyDraft(),
      expertiseAreas: ["groundwater_wells"],
      experience: EXPERIENCE,
      references: ["https://example.org/a"],
    };
    const { user, onSubmit } = setup({ initial, submitLabel: "Apply again" });
    expect(screen.getByRole("checkbox", { name: /groundwater and wells/i })).toBeChecked();
    expect(screen.getByLabelText(/what have you worked on/i)).toHaveValue(EXPERIENCE);
    expect(screen.getByLabelText("Reference 1")).toHaveValue("https://example.org/a");
    await user.click(submit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/acknowledgement must be accepted/i)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /i confirm that the information/i }));
    await user.click(submit());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("while pending: controls are disabled, submit is busy and cannot be re-triggered", async () => {
    const { user, onSubmit } = setup({ pending: true });
    expect(submit()).toBeDisabled();
    expect(submit()).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText(/what have you worked on/i)).toBeDisabled();
    await user.click(submit());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders a failure as an alert, with a sign-in link for session failures", () => {
    setup({ failure: { kind: "session", message: "Your session has ended." } });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Your session has ended.");
    expect(within(alert).getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/auth/login");
  });

  it("form markup carries no hidden client-controlled authority (no role/status inputs)", () => {
    const { container } = render(
      <ExpertApplicationForm pending={false} failure={null} submitLabel="Submit application" onSubmit={() => {}} />,
    );
    expect(container.querySelector('[name="role"], [name="status"], input[type="hidden"]')).toBeNull();
  });
});
