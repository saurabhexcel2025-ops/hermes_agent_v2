/** @jest-environment node */

describe("gateway-client", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("gatewayUrl respects HERMES_GATEWAY_URL", async () => {
    process.env.HERMES_GATEWAY_URL = "http://192.168.1.50:9000";
    const { gatewayUrl } = await import("@/lib/gateway-client");
    expect(gatewayUrl("/v1/models")).toBe("http://192.168.1.50:9000/v1/models");
  });

  it("getAgentLlmEndpoints uses CONTROL_HUB_LLM_API for chat URL", async () => {
    process.env.CONTROL_HUB_LLM_API = "http://10.0.0.5:8642/v1/chat/completions";
    const { getAgentLlmEndpoints } = await import("@/lib/hermes-agent-runtime");
    const { apiUrl, gatewayBase } = getAgentLlmEndpoints();
    expect(apiUrl).toBe("http://10.0.0.5:8642/v1/chat/completions");
    expect(gatewayBase).toBe("http://10.0.0.5:8642");
  });
});
