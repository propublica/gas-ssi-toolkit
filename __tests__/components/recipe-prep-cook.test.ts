/**
 * @jest-environment jsdom
 */
import { RecipePrepCook } from "../../src/client/components/recipe-prep-cook";

function mount(config: ConstructorParameters<typeof RecipePrepCook>[1]) {
  const container = document.createElement("div");
  const component = new RecipePrepCook(container, config);
  return { container, component };
}

describe("idle state", () => {
  it("renders Prep enabled and Cook disabled", () => {
    const { container } = mount({ onPrep: jest.fn(), onCook: jest.fn() });
    const prep = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    const cook = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    expect(prep.disabled).toBe(false);
    expect(prep.textContent).toBe("Prep Recipe");
    expect(cook.disabled).toBe(true);
  });
});

describe("prepping state", () => {
  it("disables Prep and shows Prepping... while onPrep is pending", async () => {
    let resolvePrep!: () => void;
    const onPrep = jest.fn(
      () =>
        new Promise<void>((res) => {
          resolvePrep = res;
        }),
    );
    const { container } = mount({ onPrep, onCook: jest.fn() });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    const prep = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    expect(prep.disabled).toBe(true);
    expect(prep.textContent).toBe("Prepping...");
    resolvePrep();
  });
});

describe("prep-complete state", () => {
  async function mountPrepped(onCook = jest.fn()) {
    const onPrep = jest.fn().mockResolvedValue(undefined);
    const { container, component } = mount({ onPrep, onCook });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await Promise.resolve();
    await Promise.resolve();
    return { container, component, onCook };
  }

  it("enables Cook and shows Re-prep after onPrep resolves", async () => {
    const { container } = await mountPrepped();
    const prep = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    const cook = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    expect(prep.disabled).toBe(false);
    expect(prep.textContent).toBe("Re-prep");
    expect(cook.disabled).toBe(false);
  });

  it("isPrepComplete returns true", async () => {
    const { component } = await mountPrepped();
    expect(component.isPrepComplete()).toBe(true);
  });

  it("calls onCook when Cook is clicked (sync)", async () => {
    const { container, onCook } = await mountPrepped();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(onCook).toHaveBeenCalledTimes(1);
  });

  it("does not enter cooking state when onCook is synchronous", async () => {
    const { container } = await mountPrepped(jest.fn(() => undefined));
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    const cook = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    // remains in prep-complete (cook is still enabled)
    expect(cook.disabled).toBe(false);
  });
});

describe("cooking state", () => {
  it("disables both buttons when onCook returns a Promise", async () => {
    const onPrep = jest.fn().mockResolvedValue(undefined);
    let resolveCook!: () => void;
    const onCook = jest.fn(
      () =>
        new Promise<void>((res) => {
          resolveCook = res;
        }),
    );
    const { container } = mount({ onPrep, onCook });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await Promise.resolve();
    await Promise.resolve();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    const prep = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    const cook = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    expect(prep.disabled).toBe(true);
    expect(cook.disabled).toBe(true);
    expect(cook.textContent).toBe("Cooking...");
    resolveCook();
  });
});

describe("error handling", () => {
  it("returns to idle and shows alert when onPrep rejects", async () => {
    const alertMock = jest.fn();
    globalThis.alert = alertMock;
    const onPrep = jest.fn().mockRejectedValue(new Error("prep failed"));
    const { container, component } = mount({ onPrep, onCook: jest.fn() });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(alertMock).toHaveBeenCalledWith("Error: prep failed");
    expect(component.isPrepComplete()).toBe(false);
    const prep = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    expect(prep.disabled).toBe(false);
    expect(prep.textContent).toBe("Prep Recipe");
  });
});

describe("reset()", () => {
  it("returns to idle and disables Cook", async () => {
    const onPrep = jest.fn().mockResolvedValue(undefined);
    const { container, component } = mount({ onPrep, onCook: jest.fn() });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await Promise.resolve();
    await Promise.resolve();
    component.reset();
    const prep = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    const cook = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    expect(prep.textContent).toBe("Prep Recipe");
    expect(cook.disabled).toBe(true);
    expect(component.isPrepComplete()).toBe(false);
  });
});

describe("initialState restoration", () => {
  it("mounts in prep-complete state when prepComplete: true", () => {
    const { container, component } = mount({
      onPrep: jest.fn(),
      onCook: jest.fn(),
      prepComplete: true,
    });
    const cook = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    expect(cook.disabled).toBe(false);
    expect(component.isPrepComplete()).toBe(true);
  });
});
