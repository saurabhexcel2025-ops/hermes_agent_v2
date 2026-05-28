/** @jest-environment node */

jest.mock("@/lib/models-repository", () => ({
  findModelByModelId: jest.fn(),
  getDefaultModel: jest.fn(),
}));

jest.mock("@/lib/credentials-repository", () => ({
  getCredentialWithKey: jest.fn(),
}));

jest.mock("@/lib/api-logger", () => ({
  logApiError: jest.fn(),
}));

import { findModelByModelId, getDefaultModel } from "@/lib/models-repository";
import { resolveMissionModel } from "@/lib/backends/hermes";

const mockFindByModelId = findModelByModelId as jest.Mock;
const mockGetDefault = getDefaultModel as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("resolveMissionModel", () => {
  it("returns explicit modelId and provider when both are set", async () => {
    const result = await resolveMissionModel({
      modelId: "openai/gpt-5.5-medium",
      provider: "openai",
    });
    expect(result).toEqual({
      modelId: "openai/gpt-5.5-medium",
      provider: "openai",
      apiKey: null,
    });
    expect(mockFindByModelId).not.toHaveBeenCalled();
    expect(mockGetDefault).not.toHaveBeenCalled();
  });

  it("resolves provider from registry when only modelId is set", async () => {
    mockFindByModelId.mockReturnValue({
      modelId: "anthropic/claude-sonnet-4",
      provider: "anthropic",
      credentialsId: null,
    });

    const result = await resolveMissionModel({
      modelId: "anthropic/claude-sonnet-4",
    });

    expect(mockFindByModelId).toHaveBeenCalledWith("anthropic/claude-sonnet-4");
    expect(result).toEqual({
      modelId: "anthropic/claude-sonnet-4",
      provider: "anthropic",
      apiKey: null,
    });
    expect(mockGetDefault).not.toHaveBeenCalled();
  });

  it("falls back to agent default when modelId is empty", async () => {
    mockGetDefault.mockReturnValue({
      modelId: "default/model",
      provider: "default-provider",
      credentialsId: null,
    });

    const result = await resolveMissionModel({});

    expect(mockGetDefault).toHaveBeenCalledWith("agent");
    expect(result.modelId).toBe("default/model");
    expect(result.provider).toBe("default-provider");
  });

  it("falls back to agent default when modelId is not in registry", async () => {
    mockFindByModelId.mockReturnValue(null);
    mockGetDefault.mockReturnValue({
      modelId: "fallback/model",
      provider: "fallback",
      credentialsId: null,
    });

    const result = await resolveMissionModel({ modelId: "unknown/model" });

    expect(mockFindByModelId).toHaveBeenCalledWith("unknown/model");
    expect(mockGetDefault).toHaveBeenCalledWith("agent");
    expect(result.modelId).toBe("fallback/model");
  });
});
