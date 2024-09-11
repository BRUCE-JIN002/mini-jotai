import { Getter, ReadableAtom, Setter, WritableAtom } from "./atom";

type AnyReadableAtom = ReadableAtom<unknown>;
type AnyWritableAtom = WritableAtom<unknown, unknown[], unknown>;

type Dependencies = Map<AnyReadableAtom, AtomState>;
type NextDependencies = Map<AnyReadableAtom, AtomState | undefined>;
type AtomState<Value = unknown> = {
  d: Dependencies;
  v: Value;
};

type Listeners = Set<() => void>;
type Dependents = Set<AnyReadableAtom>;
type Mounted = {
  l: Listeners;
  t: Dependents;
};

const isEqualAtomValue = <Value>(a: AtomState<Value>, b: AtomState<Value>) => {
  return "v" in a && "v" in b && Object.is(a.v, b.v);
};

const hasInitialValue = <T extends ReadableAtom<unknown>>(
  atom: T
): atom is T &
  (T extends ReadableAtom<infer Value> ? { init: Value } : never) =>
  "init" in atom;

const returnAtomValue = <Value>(atomState: AtomState<Value>): Value => {
  return atomState.v;
};

export const createStore = () => {
  const atomStateMap = new WeakMap<AnyReadableAtom, AtomState>();
  const mountedMap = new WeakMap<AnyReadableAtom, Mounted>();
  const pendingMap = new Map<AnyReadableAtom, AtomState | undefined>();

  const getAtomState = <Value>(atom: ReadableAtom<Value>) => {
    return atomStateMap.get(atom) as AtomState<Value> | undefined;
  };

  const setAtomState = <Value>(
    atom: ReadableAtom<Value>,
    atomState: AtomState<Value>
  ) => {
    const prevAtomState = atomStateMap.get(atom);
    atomStateMap.set(atom, atomState);
    if (!pendingMap.has(atom)) {
      pendingMap.set(atom, prevAtomState);
    }
  };

  const readAtomState = <Value>(
    atom: ReadableAtom<Value>,
    force?: boolean
  ): AtomState<Value> => {
    const atomState = getAtomState(atom);
    // 这里会判断缓存，如果不是强制重新读状态(force = true)，否则直接返回缓存的状态
    if (!force && atomState) {
      return atomState;
    }
    const nextDependencies: NextDependencies = new Map();
    const getter: Getter = <V>(a: ReadableAtom<V>) => {
      // 这里需要判断是读当前的atom还是读的其他atom
      if ((a as AnyReadableAtom) === atom) {
        const aState = getAtomState(a);
        if (aState) {
          // 记录atom依赖了哪些其他atom，也就是说get了哪个就将哪个atom加入到nextDependencies
          nextDependencies.set(a, aState);
          return returnAtomValue(aState);
        }
        if (hasInitialValue(a)) {
          nextDependencies.set(a, undefined);
          return a.init;
        }
        throw new Error("no atom init");
      }
      // 如果不是读的自己，则递归调用readAtomState去读，并加入到依赖项nextDependencies中
      const aState = readAtomState(a);
      nextDependencies.set(a, aState);
      return returnAtomValue(aState);
    };
    // 这里其实就是构造了一个getter函数，并传入到read函数中来得到value
    const value = atom.read(getter);
    // 然后将最新的值更新到atomStateMap中
    return setAtomValue(atom, value, nextDependencies);
  };

  const setAtomValue = <Value>(
    atom: ReadableAtom<Value>,
    value: Value,
    nextDependencies?: NextDependencies
  ): AtomState<Value> => {
    const prevAtomState = getAtomState(atom);
    const nextAtomState: AtomState<Value> = {
      d: nextDependencies || new Map(),
      v: value
    };
    if (prevAtomState && isEqualAtomValue(prevAtomState, nextAtomState)) {
      return prevAtomState;
    }
    setAtomState(atom, nextAtomState);
    return nextAtomState;
  };

  const readAtom = <Value>(atom: ReadableAtom<Value>): Value => {
    return returnAtomValue(readAtomState(atom));
  };
  const writeAtom = <Value, Args extends unknown[], Result>(
    atom: WritableAtom<Value, Args, Result>,
    ...args: Args
  ): Result => {
    //更新atom状态
    const result = writeAtomState(atom, ...args);
    // 触发重新渲染
    flushPending();
    return result;
  };

  const writeAtomState = <Value, Args extends unknown[], Result>(
    atom: WritableAtom<Value, Args, Result>,
    ...args: Args
  ): Result => {
    const getter: Getter = <V>(a: ReadableAtom<V>) =>
      returnAtomValue(readAtomState(a));
    const setter: Setter = <V, As extends unknown[], R>(
      a: WritableAtom<V, As, R>,
      ...args: As
    ) => {
      let r: R | undefined;
      if ((a as AnyWritableAtom) === atom) {
        const prevAtomState = getAtomState(a);
        const nextAtomState = setAtomValue(a, args[0] as V);
        if (!prevAtomState || !isEqualAtomValue(prevAtomState, nextAtomState)) {
          // 这里判断状态是否真的发生了变化，如果改变则需要重新去计算依赖的atom的状态
          recomputeDependents(a);
        }
      } else {
        // 如果不是set当前的atom，则需要递归来完成状态更新
        r = writeAtomState(a as AnyWritableAtom, ...args) as R;
      }
      return r as R;
    };
    // 这里其实就是创建了getter和setter函数，并传入到atom.write而已
    const result = atom.write(getter, setter, ...args);
    return result;
  };

  const recomputeDependents = (atom: AnyReadableAtom): void => {
    // t上记录了哪些其他atom依赖了这个atom
    const dependents = new Set(mountedMap.get(atom)?.t);
    dependents.forEach((dependent) => {
      if (dependent !== atom) {
        // 因为要重新计算状态，所以这里第二个参数force = true，并且这个过程会将变化的atom加入到pendingMap中
        readAtomState(dependent, true);
      }
      recomputeDependents(dependent);
    });
  };

  const flushPending = (): void | Set<AnyReadableAtom> => {
    while (pendingMap.size) {
      const pending = Array.from(pendingMap);
      pendingMap.clear();
      pending.forEach(([atom, prevAtomState]) => {
        const atomState = getAtomState(atom);
        const mounted = mountedMap.get(atom);
        if (
          mounted &&
          atomState &&
          !(prevAtomState && isEqualAtomValue(prevAtomState, atomState))
        ) {
          mounted.l.forEach((listener) => {
            listener();
          });
        }
      });
    }
  };

  const subscribeAtom = (
    atom: AnyReadableAtom,
    listener: () => void
  ): (() => void) => {
    // 将当前atom加入到mountedMap中
    const mounted = addAtom(atom);
    // 注册订阅者
    mounted.l.add(listener);
    //返回unsub函数，当组件卸载时调用
    return () => {
      unmountAtom(atom);
    };
  };

  const mountAtom = <Value>(
    atom: ReadableAtom<Value>,
    initialDependent?: AnyReadableAtom
  ): Mounted => {
    // 分析atom依赖了哪些其他atom，然后逐个加入到mountedMap中
    getAtomState(atom)?.d.forEach((_, a) => {
      // 寻找依赖的方式是通过getAtomState(atom)，上面的d参数就是atom依赖的其他atom。
      //这个过程是记录atom的依赖项，这样当状态变化时就知道要去重新计算哪些atom的状态。
      const aMounted = mountedMap.get(a);
      if (aMounted) {
        aMounted.t.add(atom);
      } else {
        if (a !== atom) {
          // 递归，确保直接或间接依赖都加入到mountedMap中
          mountAtom(a, atom);
        }
      }
    });
    const mounted: Mounted = {
      t: new Set(initialDependent && [initialDependent]),
      l: new Set()
    };
    // 将atom加入到mountedMap中
    mountedMap.set(atom, mounted);
    return mounted;
  };

  const addAtom = (atom: AnyReadableAtom): Mounted => {
    let mounted = mountedMap.get(atom);
    if (!mounted) {
      mounted = mountAtom(atom);
    }
    return mounted;
  };

  const unmountAtom = <Value>(atom: ReadableAtom<Value>): void => {
    //卸载atom
    mountedMap.delete(atom);
    // 将atom从mountedMap中剔除
    const atomState = getAtomState(atom);
    if (atomState) {
      // 这里的作用是分析mountedMap中的所有atom中有哪些依赖了atom，也就是说把atom从t上删除
      atomState.d.forEach((_, a) => {
        if (a !== atom) {
          const aMounted = mountedMap.get(a);
          if (aMounted?.t.has(atom)) {
            aMounted.t.delete(atom);
          }
        }
      });
    }
  };

  return {
    get: readAtom,
    set: writeAtom,
    sub: subscribeAtom
  };
};
