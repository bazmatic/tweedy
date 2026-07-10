import { describe, expect, it, vi } from "vitest";
import { MaterialService } from "./MaterialService";

function makeService(overrides: { materialRepository?: any; ragService?: any }) {
  return new MaterialService(
    overrides.materialRepository ?? ({} as any),
    overrides.ragService ?? ({} as any)
  );
}

describe("MaterialService.clearAllMaterials", () => {
  it("delegates to materialRepository.deleteAll and returns its count", async () => {
    const deleteAll = vi.fn().mockResolvedValue(3);
    const service = makeService({ materialRepository: { deleteAll } });

    const count = await service.clearAllMaterials();

    expect(count).toBe(3);
    expect(deleteAll).toHaveBeenCalledTimes(1);
  });
});
