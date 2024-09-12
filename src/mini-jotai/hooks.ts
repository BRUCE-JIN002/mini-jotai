import { useCallback, useEffect, useReducer } from "react";
import { ReadableAtom, WritableAtom } from "./atom";
import { createStore } from "./store";

export type Store = ReturnType<typeof createStore>;

let defaultStore: Store | null = null;
export const useStore = () => {
  if (!defaultStore) {
    defaultStore = createStore();
  }

  return defaultStore;
};

export const useSetAtom = <Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>
) => {
  //获取store
  const store = useStore();
  // 用useCallback包裹一层的目的是保持返回的setAtom引用不变
  const setAtom = useCallback(
    (...args: Args) => {
      return store.set(atom, ...args);
    },
    [atom, store]
  );
  return setAtom;
};

export const useAtomValue = <Value>(atom: ReadableAtom<Value>) => {
  const store = useStore();
  const [value, rerender] = useReducer((prev) => {
    const nextValue = store.get(atom);
    if (Object.is(prev, nextValue)) {
      return prev;
    }
  }, store.get(atom));

  useEffect(() => {
    //订阅组件
    const unsubscribe = store.sub(atom, rerender);

    //取消订阅
    return unsubscribe;
  }, [store, atom]);

  return value;
};

export const useAtom = <Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>
) => {
  return [useAtomValue(atom), useSetAtom(atom)];
};
