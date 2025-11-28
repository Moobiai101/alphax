import type { State } from "./state/types";
import type { Actions } from "./state/actions";

interface EngineInternals {
  getState: () => State;
  getActions: () => any;
  controllers: any;
}

let internals: EngineInternals | null = null;

export const registerEngineInternals = (impl: EngineInternals) => {
  internals = impl;
};

export const omnislate = {
  context: {
    get state() {
      if (internals) return internals.getState();
      console.warn("Accessing omnislate state before initialization");
      return {} as State;
    },
    get actions() {
      if (internals) return internals.getActions();
      return {} as Actions;
    },
    get controllers() {
      if (internals) return internals.controllers;
      return {} as any;
    }
  }
} as any;

