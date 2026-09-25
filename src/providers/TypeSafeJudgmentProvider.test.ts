import { describe, expect, it, vi, beforeEach } from "vitest";
import axios from "axios";
import { TypeSafeJudgmentProvider } from "./TypeSafeJudgmentProvider";
import { choice, noul, score } from "./judgment-questions";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const questions = {
  team: choice("Which team?", { billing: "Payments", technical: "Bugs" }),
  urgent: noul("Is it urgent?"),
  anger: score("How angry?", ["Calm", "Frustrated", "Very angry"]),
};

const okResponse = {
  data: {
    answers: {
      team: {
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.9, technical: 0.1 },
        confidence: 0.81,
      },
      urgent: { type: "noul", noul: 0.95 },
      anger: { type: "score", score: 1.05, confidence: 0.7 },
    },
  },
};

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status },
  });
}

describe("TypeSafeJudgmentProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.isAxiosError.mockImplementation(
      (e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError)
    );
  });

  const make = (overrides = {}) =>
    new TypeSafeJudgmentProvider({
      apiKey: "test-key",
      retryDelayMs: 0,
      ...overrides,
    });

  it("returns typed answers for choice, noul and score in one request", async () => {
    mockedAxios.post.mockResolvedValueOnce(okResponse);

    const result = await make().judge({ text: "hi" }, questions);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.answers.team.choice).toBe("billing");
    expect(result.answers.team.probabilities.billing).toBe(0.9);
    expect(result.answers.urgent.probability).toBe(0.95);
    expect(result.answers.anger.score).toBe(1.05);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockedAxios.post.mock.calls[0] as any[];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(body).toEqual({
      state: { text: "hi" },
      model: "jev-latest",
      questions,
    });
    expect(config.headers.Authorization).toBe("Bearer test-key");
  });

  it("is unavailable without an API key and never calls the network", async () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      const provider = new TypeSafeJudgmentProvider();
      expect(provider.isConfigured).toBe(false);
      const result = await provider.judge({}, questions);
      expect(result).toMatchObject({ status: "unavailable" });
      expect(mockedAxios.post).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });

  it("retries once on 429 then succeeds", async () => {
    mockedAxios.post
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce(okResponse);

    const result = await make().judge({}, questions);

    expect(result.status).toBe("ok");
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it("is unavailable after retries are exhausted on 529", async () => {
    mockedAxios.post.mockRejectedValue(httpError(529));

    const result = await make({ maxRetries: 1 }).judge({}, questions);

    expect(result).toEqual({ status: "unavailable", reason: "HTTP 529" });
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable statuses (401, 422)", async () => {
    mockedAxios.post.mockRejectedValue(httpError(401));

    const result = await make().judge({}, questions);

    expect(result).toEqual({ status: "unavailable", reason: "HTTP 401" });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it("reports timeouts as unavailable", async () => {
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error("timeout of 5000ms exceeded"), {
        isAxiosError: true,
        code: "ECONNABORTED",
      })
    );

    const result = await make({ maxRetries: 0 }).judge({}, questions);

    expect(result).toEqual({
      status: "unavailable",
      reason: "request timed out",
    });
  });

  it("passes the configured timeout to the request", async () => {
    mockedAxios.post.mockResolvedValueOnce(okResponse);

    await make({ timeoutMs: 1234 }).judge({}, questions);

    expect((mockedAxios.post.mock.calls[0] as any[])[2].timeout).toBe(1234);
  });

  it("is unavailable when an answer is missing", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { answers: { team: okResponse.data.answers.team } },
    });

    const result = await make().judge({}, questions);

    expect(result).toMatchObject({
      status: "unavailable",
      reason: 'response is missing an answer for "urgent"',
    });
  });

  it("is unavailable when a choice answer is not one of the criteria", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        answers: {
          ...okResponse.data.answers,
          team: { type: "choice", choice: "sales", confidence: 0.5 },
        },
      },
    });

    const result = await make().judge({}, questions);

    expect(result).toMatchObject({
      status: "unavailable",
      reason: 'malformed choice answer for "team"',
    });
  });
});
