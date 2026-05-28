/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

jest.mock("lucide-react", () => ({
  Send: () => "S",
  Save: () => "Sv",
}));

import {
  DISPATCH_MODES,
  dispatchSubmitLabel,
  MissionComposerActions,
} from "@/components/missions/MissionCreateForm";
import type { MissionFormState } from "@/components/missions/MissionCreateForm";

const baseFormState: MissionFormState = {
  newName: "Test",
  newInstruction: "Do work",
  newContext: "",
  newGoals: "",
  newDispatch: "save",
  newSchedule: "every 5m",
  scheduleType: "interval",
  scheduleStartTime: "00:00",
  newMissionTime: 15,
  newTimeout: 10,
  newProfile: "",
  newModel: "",
  newProvider: "",
  newLocalDirs: [],
  localDirDraft: { path: "", branch: null },
  newReferences: [],
  referenceInput: "",
  newSkills: [],
};

describe("dispatch modes", () => {
  it("orders Save, Queue, Run now, Schedule", () => {
    expect(DISPATCH_MODES.map((m) => m.id)).toEqual([
      "save",
      "queue",
      "now",
      "cron",
    ]);
  });

  it("maps footer labels per mode", () => {
    expect(dispatchSubmitLabel("save")).toBe("Save draft");
    expect(dispatchSubmitLabel("queue")).toBe("Queue mission");
    expect(dispatchSubmitLabel("now")).toBe("Dispatch now");
    expect(dispatchSubmitLabel("cron")).toBe("Schedule mission");
  });

  it("maps draft edit labels from dispatch choice", () => {
    expect(
      dispatchSubmitLabel("now", { isDraftEdit: true }),
    ).toBe("Dispatch now");
    expect(
      dispatchSubmitLabel("queue", { isDraftEdit: true }),
    ).toBe("Queue mission");
  });

  it("maps running edit to Update Mission", () => {
    expect(
      dispatchSubmitLabel("now", { isRunningEdit: true }),
    ).toBe("Update Mission");
  });

  it("maps queued-waiting edit labels", () => {
    expect(
      dispatchSubmitLabel("save", { isQueuedEdit: true }),
    ).toBe("Move to drafts");
    expect(
      dispatchSubmitLabel("now", { isQueuedEdit: true }),
    ).toBe("Dispatch now");
  });
});

describe("MissionComposerActions", () => {
  it("shows Save draft when dispatch mode is save", () => {
    render(
      <MissionComposerActions
        editingId={null}
        missions={[]}
        formState={{ ...baseFormState, newDispatch: "save" }}
        onSubmit={jest.fn()}
        onSaveAsTemplate={jest.fn()}
        onClose={jest.fn()}
        dispatching={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Save draft/i }),
    ).toBeInTheDocument();
  });
});
