/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("lucide-react", () => ({
  ChevronDown: () => "▼",
  Plus: () => "+",
  FolderOpen: () => "F",
  Loader2: () => "…",
}));

import CategoryCombobox from "@/components/missions/CategoryCombobox";

const categories = [
  { id: "general", name: "General", color: "cyan" },
  { id: "engineering", name: "Engineering", color: "purple" },
];

describe("CategoryCombobox", () => {
  it("renders portaled menu when opened", () => {
    render(
      <CategoryCombobox
        categories={categories}
        value="general"
        onChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("category-combobox-trigger"));
    expect(screen.getByTestId("category-combobox-menu")).toBeInTheDocument();
  });

  it("shows create row when query has no exact match and onCreateCategory is set", () => {
    render(
      <CategoryCombobox
        categories={categories}
        value={null}
        onChange={jest.fn()}
        onCreateCategory={jest.fn().mockResolvedValue("new-id")}
      />,
    );

    fireEvent.click(screen.getByTestId("category-combobox-trigger"));
    const input = screen.getByPlaceholderText("Search or create…");
    fireEvent.change(input, { target: { value: "Operations" } });

    expect(screen.getByTestId("category-combobox-create")).toHaveTextContent(
      'Create category "Operations"',
    );
  });

  it("does not show create placeholder when onCreateCategory is omitted", () => {
    render(
      <CategoryCombobox
        categories={categories}
        value={null}
        onChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("category-combobox-trigger"));
    expect(
      screen.getByPlaceholderText("Search categories"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("category-combobox-create"),
    ).not.toBeInTheDocument();
  });

  it("calls onCreateCategory on Enter when canCreate", async () => {
    const onCreateCategory = jest.fn().mockResolvedValue("ops-id");
    const onChange = jest.fn();

    render(
      <CategoryCombobox
        categories={categories}
        value={null}
        onChange={onChange}
        onCreateCategory={onCreateCategory}
      />,
    );

    fireEvent.click(screen.getByTestId("category-combobox-trigger"));
    const input = screen.getByPlaceholderText("Search or create…");
    fireEvent.change(input, { target: { value: "Operations" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onCreateCategory).toHaveBeenCalledWith("Operations");
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("ops-id");
    });
  });
});
