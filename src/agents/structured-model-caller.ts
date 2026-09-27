import { ModelTask } from "../providers/ModelRoutingPolicy";

/** A structured-output model call, parameterized by its parsed response shape. */
export type StructuredModelCaller<T> = (
  task: ModelTask,
  messages: { role: "user"; content: string }[],
  schema: unknown,
  maxTokens: number
) => Promise<T>;
