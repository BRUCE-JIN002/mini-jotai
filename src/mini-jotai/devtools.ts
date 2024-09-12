import { useDebugValue, useEffect, useState } from "react";
import { ReadableAtom } from "./atom";
import { Store, useStore } from "./hooks";

const stateToPrintable = ([state, atoms]: [Store, ReadableAtom<unknown>[]]) => {
  atoms.reduce((res, atom) => {
    const atomState = state.get(atom);
    res[atom.debugLabel] = { value: atomState };
    return res;
  }, {} as Record<string, unknown>);
};

export function useAtomsDebugValue() {
  const store = useStore();

  const [atoms, setAtoms] = useState<ReadableAtom<unknown>[]>([]);
  useEffect(() => {
    setAtoms(Array.from(store.get_mounted_atoms()));
  }, [store]);

  useDebugValue([store, atoms], stateToPrintable);
}
